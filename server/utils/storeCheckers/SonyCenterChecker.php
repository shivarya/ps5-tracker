<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * shopatsc.com is a Shopify store (confirmed via Chrome DevTools, 2026-06-28:
 * Shopify web-pixels script tags + public products.json endpoint). However
 * this store's theme strips the standard `variants[].available` boolean from
 * the public products.json — every variant omits the field entirely — so the
 * approach in the original plan (read `available` directly) doesn't work here.
 *
 * The reliable signal turned out to be Shopify's standard AJAX cart endpoint,
 * which every Shopify storefront exposes regardless of theme customization:
 *
 *   POST /cart/add.js   body: {"items":[{"id": <variant_id>, "quantity":1}]}
 *
 * Confirmed live: a sold-out variant returns HTTP 422 with
 * `{"message": "The product '...' is already sold out."}`; an in-stock add
 * returns 200 with the cart line item. This creates an anonymous abandoned
 * cart line each poll (harmless — no payment step, nothing is purchased).
 *
 * No pincode-specific deliverability check exists for this store — it's a
 * single direct-to-consumer Shopify storefront (presumably ships nationwide
 * via courier), not a pincode-gated marketplace listing like Reliance
 * Digital/Vijay Sales. $pincode is accepted for interface consistency but
 * unused.
 *
 * REAL BUG FOUND AND FIXED 2026-06-30: the cookie jar (keyed only by
 * md5($url), a stable path) was never cleaned up after a check, so every
 * 30-min cron poll reused the SAME session/cart as all previous polls
 * instead of starting fresh — the docblock above already documented the
 * intent as "persists session cookies across the seed GET + the AJAX
 * check" (i.e. scoped to one check() call), but nothing actually enforced
 * that scope. Each successful `cart/add.js` call increments the existing
 * line item's quantity rather than creating a new one (confirmed live:
 * a manual re-check returned `"quantity":2` from a single `quantity:1`
 * request, proving a prior run's item was still in the cart), so the
 * abandoned cart's quantity grew without bound across however many polls
 * had run since the listing was added. At some accumulated quantity,
 * Shopify's response stopped being a clean 200-or-422-sold-out shape and
 * fell into the catch-all `error` branch, intermittently breaking stock
 * checks for hours at a time with no recovery path (the corrupted cart
 * persisted in /tmp until manually cleared). Fixed by deleting the cookie
 * jar in a `finally` block so every check starts a genuinely fresh session
 * — this same stale-cookie-jar pattern exists in the other checkers using
 * sys_get_temp_dir()-keyed jars (Croma, Games The Shop, Reliance Digital,
 * Vijay Sales) and was fixed there too even though only this one had a
 * visible failure mode.
 */
class SonyCenterChecker implements StoreCheckerInterface
{
  public static function check(string $url, string $pincode): array
  {
    $jsonUrl = rtrim(preg_replace('/\.json$/', '', $url), '/') . '.json';
    $cookieJar = sys_get_temp_dir() . '/ps5_sc_' . md5($url) . '.cookies';

    try {
      $jsonRes = HttpClient::get($jsonUrl, $cookieJar, ['Accept: application/json'], $url);
      if (!$jsonRes['ok']) {
        return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => $jsonRes['error']];
      }
      if (HttpClient::looksBlocked((int)$jsonRes['http_status'], $jsonRes['body'])) {
        return ['status' => 'blocked', 'http_status' => $jsonRes['http_status'], 'raw' => substr($jsonRes['body'], 0, 2000), 'error' => null];
      }
      if ($jsonRes['http_status'] !== 200) {
        return ['status' => 'error', 'http_status' => $jsonRes['http_status'], 'raw' => substr($jsonRes['body'], 0, 2000), 'error' => 'Unexpected HTTP status fetching product JSON'];
      }

      $decoded = json_decode($jsonRes['body'], true);
      $variants = $decoded['product']['variants'] ?? null;
      if (!is_array($variants) || empty($variants)) {
        return ['status' => 'error', 'http_status' => 200, 'raw' => substr($jsonRes['body'], 0, 500), 'error' => 'No variants found — endpoint may have changed'];
      }
      $variantId = $variants[0]['id'] ?? null;
      if ($variantId === null) {
        return ['status' => 'error', 'http_status' => 200, 'raw' => '', 'error' => 'Could not find a variant id'];
      }

      $cartRes = HttpClient::post(
        'https://shopatsc.com/cart/add.js',
        $cookieJar,
        ['Content-Type: application/json', 'Accept: application/json'],
        $url,
        json_encode(['items' => [['id' => $variantId, 'quantity' => 1]]])
      );
      if (!$cartRes['ok']) {
        return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => $cartRes['error']];
      }
      if (HttpClient::looksBlocked((int)$cartRes['http_status'], $cartRes['body'])) {
        return ['status' => 'blocked', 'http_status' => $cartRes['http_status'], 'raw' => substr($cartRes['body'], 0, 2000), 'error' => null];
      }

      if ($cartRes['http_status'] === 200) {
        return ['status' => 'in_stock', 'http_status' => 200, 'raw' => substr($cartRes['body'], 0, 500), 'error' => null];
      }
      if ($cartRes['http_status'] === 422 && stripos($cartRes['body'], 'sold out') !== false) {
        return ['status' => 'out_of_stock', 'http_status' => 422, 'raw' => substr($cartRes['body'], 0, 500), 'error' => null];
      }

      return ['status' => 'error', 'http_status' => $cartRes['http_status'], 'raw' => substr($cartRes['body'], 0, 500), 'error' => 'Unexpected cart/add.js response — endpoint may have changed'];
    } finally {
      @unlink($cookieJar);
    }
  }
}
