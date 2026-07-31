<?php
// For effectiveMaxNotifyPrice() — the same cap resolution the notify path uses.
require_once __DIR__ . '/../utils/stockResultProcessor.php';

function handleStatusRoutes(string $uri, string $method): void
{
    if ($uri !== '/status' || $method !== 'GET') {
        Response::error('Route not found', 404);
    }

    $db = getDB();
    $listings = $db->fetchAll(
        "SELECT id, store, edition, url, product_name, pincode, last_price, max_notify_price,
                is_active, last_status, last_checked_at, last_status_changed_at
         FROM tracked_listings
         WHERE is_active = 1
         ORDER BY store, product_name"
    );

    // Surfaced so the dashboard/mobile app can show which listings would actually push if they
    // went in_stock, without duplicating the cap-resolution rule in two more places.
    foreach ($listings as &$listing) {
        $listing['effective_max_notify_price'] = effectiveMaxNotifyPrice($listing);
    }
    unset($listing);

    Response::success($listings);
}
