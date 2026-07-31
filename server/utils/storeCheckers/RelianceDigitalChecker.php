<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * reliancedigital.in runs on the Fynd/GoFynd commerce platform.
 *
 * Root-cause fix 2026-07-02: the previous approach called the Fynd `sizes/` endpoint
 * (`/api/service/application/catalog/v1.0/products/{slug}/sizes/`) with an
 * `x-location-detail` pincode header — but that endpoint IGNORES the pincode entirely
 * and returns global stock (confirmed by getting identical responses for 560067 Bangalore
 * and 194101 Leh). This caused false `in_stock` alarms all day.
 *
 * The real pincode-aware check is a two-step approach captured via Chrome DevTools on
 * 2026-07-02 by triggering the "Delivery Related" pincode form on the product page:
 *
 *   Step 1: GET /ext/raven-api/catalog/v1.0/products/{slug}
 *     → extract item_code (article_id) from response.item_code
 *
 *   Step 2: POST /ext/raven-api/inventory/multi/articles-v2
 *     Body: {"articles":[{"article_id":"{item_code}","quantity":0}],"phone_number":"0","pincode":"{pincode}","request_page":"pdp"}
 *     → data.success === true means deliverable in-stock to that pincode
 *     → data.success === false means OOS or not serviceable to pincode
 *       (error.message: "Not available for your pincode" | article.error.message: "Out of Stock")
 *
 * Both endpoints accept the storefront bearer token and require NO x-fp-signature
 * (the signature DevTools shows is computed by the page's Fynd SDK but is not
 * enforced server-side on these endpoints — verified by calling both without it).
 *
 * The bearer token below is a storefront-wide public token embedded in every
 * page's client JS (not a per-session secret) — safe to hardcode, but if it
 * ever starts returning 401, re-capture it from a fresh page load.
 *
 * Price (added 2026-07-29): neither raven-api call above returns one (verified live — the catalog
 * response has no price key and the inventory response is stock/logistics only). The Fynd
 * *application* API's `sizes/` endpoint does: `price.effective.max`. That's the same endpoint whose
 * STOCK signal was thrown out in the 2026-07-02 fix for ignoring the pincode — it is used here for
 * price ONLY, never for availability. Do not be tempted to read `sellable`/`is_available` from it.
 */
class RelianceDigitalChecker implements StoreCheckerInterface
{
  private const STOREFRONT_TOKEN = 'NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==';
  private const CATALOG_BASE = 'https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products/';
  private const INVENTORY_URL = 'https://www.reliancedigital.in/ext/raven-api/inventory/multi/articles-v2';
  private const SIZES_BASE = 'https://www.reliancedigital.in/api/service/application/catalog/v1.0/products/';

  public static function check(string $url, string $pincode): array
  {
    $slug = self::extractSlug($url);
    if ($slug === null) {
      return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => 'Could not extract product slug from URL: ' . $url];
    }

    // Cookie jar is per-listing but not reused across separate check() calls — a stale
    // cross-poll session caused a real, hard-to-diagnose bug in SonyCenterChecker.php (an
    // accumulating abandoned-cart quantity), so every checker using this sys_get_temp_dir()
    // pattern now cleans up its jar after each check rather than letting cron polls 30
    // minutes apart silently share state.
    $cookieJar = sys_get_temp_dir() . '/ps5_rd_' . md5($url) . '.cookies';
    $price = null;
    try {
      // Step 1: catalog call to get article_id (item_code)
      $catalogRes = HttpClient::get(self::CATALOG_BASE . $slug, $cookieJar, [
        'Authorization: Bearer ' . self::STOREFRONT_TOKEN,
        'x-currency-code: INR',
        'Accept: application/json, text/plain, */*',
      ], $url);

      if (!$catalogRes['ok']) {
        return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => 'Catalog fetch failed: ' . $catalogRes['error'], 'price' => null];
      }
      if (HttpClient::looksBlocked((int)$catalogRes['http_status'], $catalogRes['body'])) {
        return ['status' => 'blocked', 'http_status' => $catalogRes['http_status'], 'raw' => substr($catalogRes['body'], 0, 2000), 'error' => null, 'price' => null];
      }
      if ($catalogRes['http_status'] !== 200) {
        return ['status' => 'error', 'http_status' => $catalogRes['http_status'], 'raw' => substr($catalogRes['body'], 0, 500), 'error' => 'Catalog HTTP ' . $catalogRes['http_status'], 'price' => null];
      }
      $catalog = json_decode($catalogRes['body'], true);
      $articleId = $catalog['item_code'] ?? null;
      if (!$articleId) {
        return ['status' => 'error', 'http_status' => 200, 'raw' => substr($catalogRes['body'], 0, 500), 'error' => 'article_id (item_code) missing from catalog response — endpoint may have changed', 'price' => null];
      }

      $price = self::fetchPrice($slug, $cookieJar, $url);

      // Step 2: pincode-aware inventory check
      $inventoryBody = json_encode([
        'articles' => [['article_id' => $articleId, 'quantity' => 0]],
        'phone_number' => '0',
        'pincode' => $pincode,
        'request_page' => 'pdp',
      ]);
      $invRes = HttpClient::post(self::INVENTORY_URL, $cookieJar, [
        'Authorization: Bearer ' . self::STOREFRONT_TOKEN,
        'Content-Type: application/json',
        'Accept: application/json, text/plain, */*',
      ], $url, $inventoryBody);

      if (!$invRes['ok']) {
        return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => 'Inventory fetch failed: ' . $invRes['error'], 'price' => $price];
      }
      if (HttpClient::looksBlocked((int)$invRes['http_status'], $invRes['body'])) {
        return ['status' => 'blocked', 'http_status' => $invRes['http_status'], 'raw' => substr($invRes['body'], 0, 2000), 'error' => null, 'price' => $price];
      }
      if ($invRes['http_status'] !== 200) {
        return ['status' => 'error', 'http_status' => $invRes['http_status'], 'raw' => substr($invRes['body'], 0, 500), 'error' => 'Inventory HTTP ' . $invRes['http_status'], 'price' => $price];
      }

      $inv = json_decode($invRes['body'], true);
      $data = $inv['data'] ?? null;
      if (!is_array($data) || !array_key_exists('success', $data)) {
        return ['status' => 'error', 'http_status' => 200, 'raw' => substr($invRes['body'], 0, 500), 'error' => 'Unexpected inventory response shape — endpoint may have changed', 'price' => $price];
      }

      // data.success === true: item is in stock AND deliverable to the pincode.
      // data.success === false: either globally OOS or not serviceable to this pincode.
      // Both map to out_of_stock from the user's perspective.
      $inStock = !empty($data['success']);
      return [
        'status' => $inStock ? 'in_stock' : 'out_of_stock',
        'http_status' => 200,
        'raw' => substr($invRes['body'], 0, 500),
        'error' => null,
        'price' => $price,
      ];
    } finally {
      @unlink($cookieJar);
    }
  }

  /**
   * Best-effort price from the Fynd application API's sizes endpoint
   * (`price.effective.max`). PRICE ONLY — this endpoint's stock fields ignore the pincode,
   * which is exactly the bug the 2026-07-02 rewrite fixed. Never returns a status.
   */
  private static function fetchPrice(string $slug, string $cookieJar, string $referer): ?float
  {
    $res = HttpClient::get(self::SIZES_BASE . rawurlencode($slug) . '/sizes/', $cookieJar, [
      'Authorization: Bearer ' . self::STOREFRONT_TOKEN,
      'x-currency-code: INR',
      'Accept: application/json, text/plain, */*',
    ], $referer);

    if (!$res['ok'] || $res['http_status'] !== 200) {
      return null;
    }
    $decoded = json_decode($res['body'], true);
    $effective = $decoded['price']['effective'] ?? null;
    if (!is_array($effective)) {
      return null;
    }
    $value = $effective['max'] ?? $effective['min'] ?? null;
    return is_numeric($value) && (float)$value > 0 ? (float)$value : null;
  }

  /** Extracts the trailing slug from a reliancedigital.in /product/{slug} URL. */
  private static function extractSlug(string $url): ?string
  {
    $path = parse_url($url, PHP_URL_PATH);
    if ($path === null) {
      return null;
    }
    $parts = array_values(array_filter(explode('/', $path)));
    return end($parts) ?: null;
  }
}
