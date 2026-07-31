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
require_once __DIR__ . '/../utils/stockResultProcessor.php';
require_once __DIR__ . '/../utils/storeCheckers/StoreCheckerInterface.php';
require_once __DIR__ . '/../utils/storeCheckers/RelianceDigitalChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/VijaySalesChecker.php';
require_once __DIR__ . '/../utils/storeCheckers/SonyCenterChecker.php';

const WORKER_BUDGET_SECONDS = 45;   // stay under cPanel max_execution_time
const MAX_LISTINGS_PER_RUN = 20;

// Croma, Games The Shop, Flipkart, Amazon, Blinkit, Instamart are deliberately NOT listed here even
// though their PHP checker classes still exist (CromaChecker/GamesTheShopChecker as graceful-degrade
// fallbacks, FlipkartChecker/AmazonChecker as stubs) — the local Playwright crawler (`local-crawler/`)
// owns these exclusively now via POST /stock/report. Having both sides poll the same listing raced:
// the local crawler would correctly detect e.g. Flipkart in_stock, then this worker's always-broken
// FlipkartChecker stub would run minutes later and clobber it back to `error`. Listings for stores not
// in this map are skipped below ("no checker for store X") rather than polled.
const STORE_CHECKERS = [
    'reliance_digital' => RelianceDigitalChecker::class,
    'vijay_sales' => VijaySalesChecker::class,
    'sony_center' => SonyCenterChecker::class,
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

    $processed = processCheckResult($db, $listing, $result);

    echo "[stock-poller] listing {$listing['id']} ({$listing['store']}): {$result['status']}" . ($processed['transitioned'] ? ' <-- TRANSITION' : '') . "\n";

    if ($processed['transitioned']) {
        $transitions[] = ['listing' => $listing, 'log_id' => $processed['log_id'], 'price' => $processed['price']];
    }
}

if (!empty($transitions)) {
    notifyTransitions($db, $transitions);
}

exit(0);
