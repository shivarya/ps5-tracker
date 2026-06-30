<?php
function handleStatusRoutes(string $uri, string $method): void
{
    if ($uri !== '/status' || $method !== 'GET') {
        Response::error('Route not found', 404);
    }

    $db = getDB();
    $listings = $db->fetchAll(
        "SELECT id, store, edition, url, product_name, pincode, is_active, last_status, last_checked_at, last_status_changed_at
         FROM tracked_listings
         WHERE is_active = 1
         ORDER BY store, product_name"
    );
    Response::success($listings);
}
