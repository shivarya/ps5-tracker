<?php
/**
 * CLI helper to register a candidate product URL to track.
 *
 * Usage:
 *   php scripts/add_listing.php --store=reliance_digital --url="https://..." --pincode=560067 --name="PS5 Slim Disc"
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script runs from CLI only.\n");
}

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

$opts = getopt('', ['store:', 'url:', 'pincode::', 'name::']);

if (empty($opts['store']) || empty($opts['url'])) {
    fwrite(STDERR, "Usage: php scripts/add_listing.php --store=<store> --url=<url> [--pincode=<pincode>] [--name=<label>]\n");
    fwrite(STDERR, "Valid stores: reliance_digital, croma, vijay_sales, sony_center, games_the_shop, flipkart, amazon, blinkit, instamart\n");
    exit(1);
}

$validStores = ['reliance_digital', 'croma', 'vijay_sales', 'sony_center', 'games_the_shop', 'flipkart', 'amazon', 'blinkit', 'instamart'];
if (!in_array($opts['store'], $validStores, true)) {
    fwrite(STDERR, "Invalid store '{$opts['store']}'. Valid: " . implode(', ', $validStores) . "\n");
    exit(1);
}

$db = Database::getInstance();
$id = $db->insert(
    "INSERT INTO tracked_listings (store, url, product_name, pincode) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE store = VALUES(store), product_name = VALUES(product_name), pincode = VALUES(pincode)",
    [$opts['store'], $opts['url'], $opts['name'] ?? null, $opts['pincode'] ?? DEFAULT_PINCODE]
);

echo "Added/updated listing for store '{$opts['store']}': {$opts['url']}\n";
