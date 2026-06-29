<?php
const VALID_STORES = ['reliance_digital', 'croma', 'vijay_sales', 'sony_center', 'games_the_shop', 'flipkart', 'amazon', 'blinkit', 'instamart'];

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
            $url = (string)$input['url'];
            $pincode = (string)($input['pincode'] ?? DEFAULT_PINCODE);
            $productName = $input['product_name'] ?? null;

            $id = $db->insert(
                "INSERT INTO tracked_listings (store, url, product_name, pincode) VALUES (?, ?, ?, ?)",
                [$store, $url, $productName, $pincode]
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
            foreach (['is_active', 'pincode', 'product_name'] as $field) {
                if (array_key_exists($field, $input)) {
                    $fields[] = "$field = ?";
                    $params[] = $input[$field];
                }
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
