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
 */
class SonyCenterChecker implements StoreCheckerInterface
{
  public static function check(string $url, string $pincode): array
  {
    $jsonUrl = rtrim(preg_replace('/\.json$/', '', $url), '/') . '.json';
    $cookieJar = sys_get_temp_dir() . '/ps5_sc_' . md5($url) . '.cookies';

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
  }
}
