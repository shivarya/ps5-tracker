<?php
/**
 * Shared transition-detection/backoff/notify logic for a single store-check
 * result, used by both the cPanel cron worker (PHP curl checkers) and the
 * /stock/report ingestion endpoint (local Playwright crawler results). Keeps
 * tracked_listings/stock_check_log/notification behavior identical regardless
 * of which side actually performed the HTTP check.
 */

/**
 * Normalizes whatever a checker reported as a price into a positive float or null.
 * Checkers hand back numbers, numeric strings ("54990.00") or formatted text
 * ("₹54,990") depending on where they scraped it from.
 */
function normalizePrice($price): ?float
{
    if ($price === null || $price === '' || is_bool($price)) {
        return null;
    }
    if (is_string($price)) {
        $price = preg_replace('/[^0-9.]/', '', $price);
        if ($price === '' || !is_numeric($price)) {
            return null;
        }
    }
    $value = (float)$price;
    return $value > 0 ? $value : null;
}

/**
 * @param array $listing Row from tracked_listings.
 * @param array $result  {status, http_status, raw, error, price} — status one of in_stock|out_of_stock|blocked|error.
 *                       price is optional; null means the checker couldn't read one this run.
 * @return array {transitioned: bool, log_id: int, price: ?float}
 */
function processCheckResult(Database $db, array $listing, array $result): array
{
    $isTransition = $result['status'] === 'in_stock' && $listing['last_status'] !== 'in_stock';
    $price = normalizePrice($result['price'] ?? null);

    $logId = $db->insert(
        "INSERT INTO stock_check_log (listing_id, result, http_status, price, response_snippet, notified, error_message)
         VALUES (?, ?, ?, ?, ?, 0, ?)",
        [$listing['id'], $result['status'], $result['http_status'], $price, substr((string)$result['raw'], 0, 2000), $result['error']]
    );

    // Only overwrite last_price when this run actually read one — a checker that failed to parse a
    // price shouldn't wipe the last known good value (the notify gate reads last_price as fallback).
    if ($price !== null) {
        $db->execute("UPDATE tracked_listings SET last_price = ? WHERE id = ?", [$price, $listing['id']]);
    }

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

    return ['transitioned' => $isTransition, 'log_id' => $logId, 'price' => $price];
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

/** The price cap that applies to one listing: its own override, else the global default. */
function effectiveMaxNotifyPrice(array $listing): float
{
    $listingCap = normalizePrice($listing['max_notify_price'] ?? null);
    return $listingCap ?? NOTIFY_MAX_PRICE;
}

/**
 * Decides whether an in_stock transition is worth a push.
 *
 * Price gating added 2026-07-29: the disc edition is ~Rs 69,990 at several retailers now, and an
 * alert for one of those isn't actionable. A transition is pushed only when the observed price is
 * at or below the effective cap. When no price could be read at all, the push still fires (flagged
 * as unknown in the body) — deliberately biased towards a rare noisy alert over silently missing a
 * genuine restock, since these listings are out of stock ~100% of the time.
 *
 * @return array {notify: bool, price: ?float, cap: float, reason: string}
 */
function evaluateNotifyGate(array $listing, ?float $checkPrice): array
{
    $price = $checkPrice ?? normalizePrice($listing['last_price'] ?? null);
    $cap = effectiveMaxNotifyPrice($listing);

    if ($cap <= 0) {
        return ['notify' => true, 'price' => $price, 'cap' => $cap, 'reason' => 'price gating disabled'];
    }
    if ($price === null) {
        return ['notify' => true, 'price' => null, 'cap' => $cap, 'reason' => 'price unknown'];
    }
    if ($price > $cap) {
        return ['notify' => false, 'price' => $price, 'cap' => $cap, 'reason' => 'price above cap'];
    }
    return ['notify' => true, 'price' => $price, 'cap' => $cap, 'reason' => 'price within cap'];
}

function formatInr(float $price): string
{
    return '₹' . number_format($price, 0, '.', ',');
}

/**
 * @param array $transitions Array of {listing: array, log_id: int, price: ?float}.
 * @return array The subset that was actually pushed, each with {listing, log_id, price} — the local
 *               crawler uses this to decide which Windows toasts to fire, so a price-suppressed
 *               transition stays silent on both channels.
 */
function notifyTransitions(Database $db, array $transitions): array
{
    $pushable = [];
    foreach ($transitions as $t) {
        $gate = evaluateNotifyGate($t['listing'], $t['price'] ?? null);
        if (!$gate['notify']) {
            logPollerMessage(
                "[stock-poller] listing {$t['listing']['id']} ({$t['listing']['store']}) went in_stock at "
                . formatInr($gate['price']) . " — above cap " . formatInr($gate['cap']) . ", push suppressed"
            );
            continue;
        }
        $pushable[] = $t + ['gate' => $gate];
    }

    if (empty($pushable)) {
        return [];
    }

    $tokenRows = $db->fetchAll("SELECT expo_push_token FROM device_tokens WHERE is_active = 1");
    $tokens = array_column($tokenRows, 'expo_push_token');
    if (empty($tokens)) {
        logPollerMessage("[stock-poller] " . count($pushable) . " notifiable transition(s) but no active push tokens registered");
        return [];
    }

    $notified = [];
    foreach ($pushable as $t) {
        $listing = $t['listing'];
        $gate = $t['gate'];
        $title = 'PS5 in stock!';
        $name = $listing['product_name'] ?: 'PS5 listing';
        $storeName = str_replace('_', ' ', $listing['store']);
        $priceText = $gate['price'] !== null
            ? ' for ' . formatInr($gate['price'])
            : ' (price unknown — check before buying)';
        $body = "{$name}{$priceText} is deliverable to {$listing['pincode']} on " . ucwords($storeName);

        $tickets = ExpoPush::send($tokens, $title, $body, ['url' => $listing['url'], 'price' => $gate['price']]);
        ExpoPush::deactivateStaleTokens($db, $tokens, $tickets);

        $db->execute("UPDATE stock_check_log SET notified = 1 WHERE id = ?", [$t['log_id']]);
        logPollerMessage("[stock-poller] pushed notification for listing {$listing['id']} ({$gate['reason']})");
        $notified[] = $t;
    }

    return $notified;
}
