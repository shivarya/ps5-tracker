<?php
// Must stay in sync with tracked_listings.store's ENUM (schema.sql + migrations 001/003/004) —
// zepto and md_computers were added to the DB but missed here, so POST /listings (and the
// dashboard's add form, which proxies to it) rejected them as invalid until 2026-07-29.
const VALID_STORES = ['reliance_digital', 'croma', 'vijay_sales', 'sony_center', 'games_the_shop', 'flipkart', 'amazon', 'blinkit', 'instamart', 'zepto', 'md_computers'];
const VALID_EDITIONS = ['disc', 'digital', 'pro'];

function handleListingsRoutes(string $uri, string $method): void
{
    $db = getDB();

    // /listings
    if ($uri === '/listings') {
        if ($method === 'GET') {
            Response::success($db->fetchAll("SELECT * FROM tracked_listings ORDER BY created_at DESC"));
        }
        if ($method === 'POST') {
            requireApiKey();
            $input = getJsonInput();
            $errors = validateRequired($input, ['store', 'url']);
            if (!empty($errors)) {
                Response::error('Validation failed', 422, $errors);
            }
            $store = (string)$input['store'];
            if (!in_array($store, VALID_STORES, true)) {
                Response::error('Invalid store: ' . $store, 422);
            }
            $edition = (string)($input['edition'] ?? 'digital');
            if (!in_array($edition, VALID_EDITIONS, true)) {
                Response::error('Invalid edition: ' . $edition, 422);
            }
            $url = (string)$input['url'];
            $pincode = (string)($input['pincode'] ?? DEFAULT_PINCODE);
            $productName = $input['product_name'] ?? null;
            // NULL = fall back to the global NOTIFY_MAX_PRICE cap.
            $maxNotifyPrice = isset($input['max_notify_price']) && $input['max_notify_price'] !== ''
                ? (float)$input['max_notify_price']
                : null;

            $id = $db->insert(
                "INSERT INTO tracked_listings (store, edition, url, product_name, pincode, max_notify_price) VALUES (?, ?, ?, ?, ?, ?)",
                [$store, $edition, $url, $productName, $pincode, $maxNotifyPrice]
            );
            Response::success($db->fetchOne("SELECT * FROM tracked_listings WHERE id = ?", [$id]), 'Listing added', 201);
        }
        Response::error('Method not allowed', 405);
    }

    // /listings/{id}
    if (preg_match('#^/listings/(\d+)$#', $uri, $m)) {
        $id = (int)$m[1];
        if ($method === 'PUT') {
            requireApiKey();
            $input = getJsonInput();
            $fields = [];
            $params = [];
            // `url` is updatable so a relisted product (retailers reissue PS5 SKUs under new URLs
            // regularly) can be repointed in place, keeping the listing's stock_check_log history.
            foreach (['is_active', 'pincode', 'product_name', 'url'] as $field) {
                if (array_key_exists($field, $input)) {
                    $fields[] = "$field = ?";
                    $params[] = $input[$field];
                }
            }
            if (array_key_exists('max_notify_price', $input)) {
                $fields[] = "max_notify_price = ?";
                $params[] = $input['max_notify_price'] === null || $input['max_notify_price'] === ''
                    ? null
                    : (float)$input['max_notify_price'];
            }
            if (array_key_exists('edition', $input)) {
                if (!in_array($input['edition'], VALID_EDITIONS, true)) {
                    Response::error('Invalid edition: ' . $input['edition'], 422);
                }
                $fields[] = "edition = ?";
                $params[] = $input['edition'];
            }
            if (empty($fields)) {
                Response::error('No updatable fields provided', 422);
            }
            $params[] = $id;
            $db->execute("UPDATE tracked_listings SET " . implode(', ', $fields) . " WHERE id = ?", $params);
            Response::success($db->fetchOne("SELECT * FROM tracked_listings WHERE id = ?", [$id]), 'Listing updated');
        }
        if ($method === 'DELETE') {
            requireApiKey();
            $db->execute("DELETE FROM tracked_listings WHERE id = ?", [$id]);
            Response::success(null, 'Listing deleted');
        }
        Response::error('Method not allowed', 405);
    }

    Response::error('Route not found', 404);
}
