<?php
/**
 * Shared transition-detection/backoff/notify logic for a single store-check
 * result, used by both the cPanel cron worker (PHP curl checkers) and the
 * /stock/report ingestion endpoint (local Playwright crawler results). Keeps
 * tracked_listings/stock_check_log/notification behavior identical regardless
 * of which side actually performed the HTTP check.
 */

/**
 * @param array $listing Row from tracked_listings.
 * @param array $result  {status, http_status, raw, error} — status one of in_stock|out_of_stock|blocked|error.
 * @return array {transitioned: bool, log_id: int}
 */
function processCheckResult(Database $db, array $listing, array $result): array
{
    $isTransition = $result['status'] === 'in_stock' && $listing['last_status'] !== 'in_stock';

    $logId = $db->insert(
        "INSERT INTO stock_check_log (listing_id, result, http_status, response_snippet, notified, error_message)
         VALUES (?, ?, ?, ?, 0, ?)",
        [$listing['id'], $result['status'], $result['http_status'], substr((string)$result['raw'], 0, 2000), $result['error']]
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

    return ['transitioned' => $isTransition, 'log_id' => $logId];
}

/**
 * Logs to stdout on CLI (cron worker's log file is `>> worker.log` of stdout)
 * or to the PHP error log on a web request (echo here would otherwise leak
 * into /stock/report's JSON response body and corrupt it for the caller).
 */
function logPollerMessage(string $message): void
{
    if (PHP_SAPI === 'cli') {
        echo $message . "\n";
    } else {
        error_log($message);
    }
}

/**
 * @param array $transitions Array of {listing: array, log_id: int}.
 */
function notifyTransitions(Database $db, array $transitions): void
{
    $tokenRows = $db->fetchAll("SELECT expo_push_token FROM device_tokens WHERE is_active = 1");
    $tokens = array_column($tokenRows, 'expo_push_token');
    if (empty($tokens)) {
        logPollerMessage("[stock-poller] " . count($transitions) . " transition(s) detected but no active push tokens registered");
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
        logPollerMessage("[stock-poller] pushed notification for listing {$listing['id']}");
    }
}
