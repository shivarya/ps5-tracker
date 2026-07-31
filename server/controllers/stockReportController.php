<?php
/**
 * Ingestion endpoint for the local Playwright crawler (runs on the user's
 * Windows machine, covers retailers blocked from shared hosting). Reuses the
 * same transition-detection/backoff/notify logic as the cron worker so the
 * mobile app's push notifications behave identically regardless of which
 * side actually performed the HTTP/browser check.
 */
require_once __DIR__ . '/../utils/expoPush.php';
require_once __DIR__ . '/../utils/stockResultProcessor.php';

const STOCK_REPORT_VALID_STATUSES = ['in_stock', 'out_of_stock', 'blocked', 'error'];

function handleStockReportRoutes(string $uri, string $method): void
{
    $db = getDB();

    if ($uri !== '/stock/report') {
        Response::error('Route not found', 404);
    }
    if ($method !== 'POST') {
        Response::error('Method not allowed', 405);
    }

    requireApiKey();

    $input = getJsonInput();
    $results = $input['results'] ?? null;
    if (!is_array($results) || empty($results)) {
        Response::error('Validation failed', 422, ['results' => 'results must be a non-empty array']);
    }

    $transitions = [];
    $processed = 0;

    foreach ($results as $r) {
        $listingId = (int)($r['listing_id'] ?? 0);
        $status = (string)($r['status'] ?? '');
        if ($listingId <= 0 || !in_array($status, STOCK_REPORT_VALID_STATUSES, true)) {
            continue;
        }

        $listing = $db->fetchOne("SELECT * FROM tracked_listings WHERE id = ?", [$listingId]);
        if ($listing === false) {
            continue;
        }

        $result = [
            'status' => $status,
            'http_status' => isset($r['http_status']) ? (int)$r['http_status'] : null,
            'raw' => $r['raw'] ?? '',
            'error' => $r['error'] ?? null,
            'price' => $r['price'] ?? null,
        ];

        $outcome = processCheckResult($db, $listing, $result);
        $processed++;

        if ($outcome['transitioned']) {
            $transitions[] = ['listing' => $listing, 'log_id' => $outcome['log_id'], 'price' => $outcome['price']];
        }
    }

    $notified = !empty($transitions) ? notifyTransitions($db, $transitions) : [];
    $notifiedLogIds = array_column($notified, 'log_id');

    // Every transition is reported back, each flagged with whether it actually pushed — the crawler
    // fires its Windows toast only for notified ones, so a price-suppressed transition stays silent
    // on both channels while still being visible in the crawler's run log.
    Response::success([
        'processed' => $processed,
        'transitions' => array_map(fn($t) => [
            'listing_id' => $t['listing']['id'],
            'product_name' => $t['listing']['product_name'],
            'store' => $t['listing']['store'],
            'pincode' => $t['listing']['pincode'],
            'url' => $t['listing']['url'],
            'price' => $t['price'],
            'notified' => in_array($t['log_id'], $notifiedLogIds, true),
        ], $transitions),
    ], 'Stock report processed');
}
