<?php
/**
 * CLI helper to register a candidate product URL to track.
 *
 * Usage:
 *   php scripts/add_listing.php --store=reliance_digital --url="https://..." --edition=disc --pincode=560067 --name="PS5 Slim Disc"
 *
 * --max-price sets a per-listing push cap (INR); omit it to use the global NOTIFY_MAX_PRICE.
 * Worth setting on editions that legitimately cost more than the global cap (e.g. the PS5 Pro,
 * which would otherwise never notify).
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script runs from CLI only.\n");
}

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

$opts = getopt('', ['store:', 'url:', 'edition::', 'pincode::', 'name::', 'max-price::']);

if (empty($opts['store']) || empty($opts['url'])) {
    fwrite(STDERR, "Usage: php scripts/add_listing.php --store=<store> --url=<url> [--edition=<edition>] [--pincode=<pincode>] [--name=<label>] [--max-price=<inr>]\n");
    fwrite(STDERR, "Valid stores: reliance_digital, croma, vijay_sales, sony_center, games_the_shop, flipkart, amazon, blinkit, instamart, zepto, md_computers\n");
    fwrite(STDERR, "Valid editions: disc, digital, pro (default: digital)\n");
    exit(1);
}

// Mirrors VALID_STORES in controllers/listingsController.php and tracked_listings.store's ENUM.
$validStores = ['reliance_digital', 'croma', 'vijay_sales', 'sony_center', 'games_the_shop', 'flipkart', 'amazon', 'blinkit', 'instamart', 'zepto', 'md_computers'];
if (!in_array($opts['store'], $validStores, true)) {
    fwrite(STDERR, "Invalid store '{$opts['store']}'. Valid: " . implode(', ', $validStores) . "\n");
    exit(1);
}

$edition = $opts['edition'] ?? 'digital';
$validEditions = ['disc', 'digital', 'pro'];
if (!in_array($edition, $validEditions, true)) {
    fwrite(STDERR, "Invalid edition '{$edition}'. Valid: " . implode(', ', $validEditions) . "\n");
    exit(1);
}

$maxPrice = isset($opts['max-price']) && $opts['max-price'] !== '' ? (float)$opts['max-price'] : null;

$db = Database::getInstance();
$id = $db->insert(
    "INSERT INTO tracked_listings (store, edition, url, product_name, pincode, max_notify_price) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE store = VALUES(store), edition = VALUES(edition), product_name = VALUES(product_name), pincode = VALUES(pincode), max_notify_price = VALUES(max_notify_price)",
    [$opts['store'], $edition, $opts['url'], $opts['name'] ?? null, $opts['pincode'] ?? DEFAULT_PINCODE, $maxPrice]
);

$capText = $maxPrice !== null ? number_format($maxPrice, 0, '.', ',') : 'global NOTIFY_MAX_PRICE (' . number_format(NOTIFY_MAX_PRICE, 0, '.', ',') . ')';
echo "Added/updated listing for store '{$opts['store']}' ({$edition}): {$opts['url']}\n";
echo "Notify cap: {$capText}\n";
