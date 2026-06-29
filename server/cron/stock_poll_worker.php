<?php
/**
 * PS5 Stock Poll Worker (cPanel cron)
 *
 * Checks each active tracked listing's pincode-serviceability and notifies
 * via Expo push on an out_of_stock -> in_stock transition. Designed for
 * cPanel: no daemon — run from cron every 5 min, time-budgeted so it stays
 * under shared-hosting execution limits:
 *
 *   *\/5 * * * *  php /home/USER/.../server/cron/stock_poll_worker.php >> /home/USER/ps5_tracker_worker.log 2>&1
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This worker runs from CLI/cron only.\n");
}

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../utils/httpClient.php';
require_once __DIR__ . '/../utils/expoPush.php';
require_once __DIR__ . '/../utils/storeCheckers/StoreCheckerInterface.php';
require_once __DIR__ . '/../utils/storeCheckers/RelianceDigitalChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/CromaChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/VijaySalesChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/SonyCenterChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/GamesTheShopChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/FlipkartChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/AmazonChecker.php';

const WORKER_BUDGET_SECONDS = 45;   // stay under cPanel max_execution_time
const MAX_LISTINGS_PER_RUN = 20;

const STORE_CHECKERS = [
    'reliance_digital' => RelianceDigitalChecker::class,
    'croma' => CromaChecker::class,
    'vijay_sales' => VijaySalesChecker::class,
    'sony_center' => SonyCenterChecker::class,
    'games_the_shop' => GamesTheShopChecker::class,
    'flipkart' => FlipkartChecker::class,
    'amazon' => AmazonChecker::class,
];

$startTime = time();
$db = Database::getInstance();

$listings = $db->fetchAll(
    "SELECT * FROM tracked_listings
     WHERE is_active = 1 AND (next_check_after IS NULL OR next_check_after <= NOW())
     ORDER BY last_checked_at ASC
     LIMIT " . MAX_LISTINGS_PER_RUN
);

if (empty($listings)) {
    echo "[stock-poller] no listings due for a check\n";
    exit(0);
}

$transitions = []; // listings that just flipped to in_stock this run

foreach ($listings as $listing) {
    if (time() - $startTime > WORKER_BUDGET_SECONDS) {
        echo "[stock-poller] time budget reached; remaining listings left for next run\n";
        break;
    }

    HttpClient::jitter();

    $checkerClass = STORE_CHECKERS[$listing['store']] ?? null;
    if ($checkerClass === null) {
        echo "[stock-poller] no checker for store '{$listing['store']}', skipping listing {$listing['id']}\n";
        continue;
    }

    /** @var StoreCheckerInterface $checkerClass */
    $result = $checkerClass::check($listing['url'], $listing['pincode']);

    $isTransition = $result['status'] === 'in_stock' && $listing['last_status'] !== 'in_stock';

    $logId = $db->insert(
        "INSERT INTO stock_check_log (listing_id, result, http_status, response_snippet, notified, error_message)
         VALUES (?, ?, ?, ?, 0, ?)",
        [$listing['id'], $result['status'], $result['http_status'], substr($result['raw'], 0, 2000), $result['error']]
    );

    $statusChanged = $result['status'] !== $listing['last_status'];
    if ($statusChanged) {
        $db->execute(
            "UPDATE tracked_listings SET last_status = ?, last_checked_at = NOW(), last_status_changed_at = NOW() WHERE id = ?",
            [$result['status'], $listing['id']]
        );
    } else {
        $db->execute(
            "UPDATE tracked_listings SET last_checked_at = NOW() WHERE id = ?",
            [$listing['id']]
        );
    }

    if (in_array($result['status'], ['blocked', 'error'], true)) {
        $failures = (int)$listing['consecutive_failures'] + 1;
        $backoffMinutes = min($failures, 6) * 5;
        $db->execute(
            "UPDATE tracked_listings SET consecutive_failures = ?, next_check_after = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?",
            [$failures, $backoffMinutes, $listing['id']]
        );
    } else {
        $db->execute(
            "UPDATE tracked_listings SET consecutive_failures = 0, next_check_after = NULL WHERE id = ?",
            [$listing['id']]
        );
    }

    echo "[stock-poller] listing {$listing['id']} ({$listing['store']}): {$result['status']}" . ($isTransition ? ' <-- TRANSITION' : '') . "\n";

    if ($isTransition) {
        $transitions[] = ['listing' => $listing, 'log_id' => $logId];
    }
}

if (!empty($transitions)) {
    notifyTransitions($db, $transitions);
}

exit(0);

// ─────────────────────────────────────────────────────────────────────────────

function notifyTransitions(Database $db, array $transitions): void
{
    $tokenRows = $db->fetchAll("SELECT expo_push_token FROM device_tokens WHERE is_active = 1");
    $tokens = array_column($tokenRows, 'expo_push_token');
    if (empty($tokens)) {
        echo "[stock-poller] " . count($transitions) . " transition(s) detected but no active push tokens registered\n";
        return;
    }

    foreach ($transitions as $t) {
        $listing = $t['listing'];
        $title = 'PS5 in stock!';
        $name = $listing['product_name'] ?: 'PS5 listing';
        $storeName = str_replace('_', ' ', $listing['store']);
        $body = "{$name} is deliverable to {$listing['pincode']} on " . ucwords($storeName);

        $tickets = ExpoPush::send($tokens, $title, $body, ['url' => $listing['url']]);
        ExpoPush::deactivateStaleTokens($db, $tokens, $tickets);

        $db->execute("UPDATE stock_check_log SET notified = 1 WHERE id = ?", [$t['log_id']]);
        echo "[stock-poller] pushed notification for listing {$listing['id']}\n";
    }
}
