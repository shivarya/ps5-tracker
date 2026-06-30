<?php
/**
 * CLI helper to register a candidate product URL to track.
 *
 * Usage:
 *   php scripts/add_listing.php --store=reliance_digital --url="https://..." --edition=disc --pincode=560067 --name="PS5 Slim Disc"
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("This script runs from CLI only.\n");
}

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

$opts = getopt('', ['store:', 'url:', 'edition::', 'pincode::', 'name::']);

if (empty($opts['store']) || empty($opts['url'])) {
    fwrite(STDERR, "Usage: php scripts/add_listing.php --store=<store> --url=<url> [--edition=<edition>] [--pincode=<pincode>] [--name=<label>]\n");
    fwrite(STDERR, "Valid stores: reliance_digital, croma, vijay_sales, sony_center, games_the_shop, flipkart, amazon, blinkit, instamart\n");
    fwrite(STDERR, "Valid editions: disc, digital, pro (default: digital)\n");
    exit(1);
}

$validStores = ['reliance_digital', 'croma', 'vijay_sales', 'sony_center', 'games_the_shop', 'flipkart', 'amazon', 'blinkit', 'instamart'];
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

$db = Database::getInstance();
$id = $db->insert(
    "INSERT INTO tracked_listings (store, edition, url, product_name, pincode) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE store = VALUES(store), edition = VALUES(edition), product_name = VALUES(product_name), pincode = VALUES(pincode)",
    [$opts['store'], $edition, $opts['url'], $opts['name'] ?? null, $opts['pincode'] ?? DEFAULT_PINCODE]
);

echo "Added/updated listing for store '{$opts['store']}' ({$edition}): {$opts['url']}\n";
