<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * reliancedigital.in runs on the Fynd/GoFynd commerce platform. Its storefront
 * exposes a public sizes/availability JSON endpoint that the PDP's own JS
 * calls — captured live via Chrome DevTools on a real PS5 listing (2026-06-28):
 *
 *   GET /api/service/application/catalog/v1.0/products/{slug}/sizes/
 *   Headers: authorization: Bearer <storefront-public-token>, x-location-detail: {"pincode":...}
 *
 * Verified working with plain curl — no signature, no cookies, no session
 * required (the `x-fp-signature` header DevTools showed is NOT enforced on
 * this endpoint). Response shape:
 *   {"sellable": bool, "sizes": [{"quantity": int, "is_available": bool, ...}], ...}
 *
 * `sellable` + `sizes[].is_available` is the real stock signal. The
 * x-location-detail pincode did not change the result for the listing this
 * was captured against (it was nationally out of stock at capture time) —
 * if a future listing's stock turns out NOT to vary by pincode either, that's
 * consistent with Reliance Digital's storefront treating "stores.count" (pickup
 * availability) separately from delivery; re-verify this once a genuinely
 * in-stock listing is available to confirm pincode does affect `is_available`.
 *
 * The bearer token below is a storefront-wide public token embedded in every
 * page's client JS (not a per-session secret) — safe to hardcode, but if it
 * ever starts returning 401, re-capture it from a fresh page load.
 */
class RelianceDigitalChecker implements StoreCheckerInterface
{
  private const STOREFRONT_TOKEN = 'NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==';

  public static function check(string $url, string $pincode): array
  {
    $slug = self::extractSlug($url);
    if ($slug === null) {
      return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => 'Could not extract product slug from URL: ' . $url];
    }

    $apiUrl = "https://www.reliancedigital.in/api/service/application/catalog/v1.0/products/{$slug}/sizes/";
    $locationHeader = json_encode([
      'country_iso_code' => 'IN',
      'country' => 'INDIA',
      'pincode' => $pincode,
      'city' => '',
      'state' => '',
    ]);

    $cookieJar = sys_get_temp_dir() . '/ps5_rd_' . md5($url) . '.cookies';
    $res = HttpClient::get($apiUrl, $cookieJar, [
      'Authorization: Bearer ' . self::STOREFRONT_TOKEN,
      'x-location-detail: ' . $locationHeader,
      'x-currency-code: INR',
      'Accept: application/json, text/plain, */*',
    ], $url);

    if (!$res['ok']) {
      return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => $res['error']];
    }
    if (HttpClient::looksBlocked((int)$res['http_status'], $res['body'])) {
      return ['status' => 'blocked', 'http_status' => $res['http_status'], 'raw' => substr($res['body'], 0, 2000), 'error' => null];
    }
    if ($res['http_status'] !== 200) {
      return ['status' => 'error', 'http_status' => $res['http_status'], 'raw' => substr($res['body'], 0, 2000), 'error' => 'Unexpected HTTP status'];
    }

    $decoded = json_decode($res['body'], true);
    if (!is_array($decoded) || !isset($decoded['sellable'])) {
      return ['status' => 'error', 'http_status' => 200, 'raw' => substr($res['body'], 0, 500), 'error' => 'Unexpected response shape — endpoint may have changed'];
    }

    $sizes = $decoded['sizes'] ?? [];
    $anyAvailable = false;
    foreach ($sizes as $size) {
      if (!empty($size['is_available']) && (int)($size['quantity'] ?? 0) > 0) {
        $anyAvailable = true;
        break;
      }
    }
    $inStock = !empty($decoded['sellable']) && $anyAvailable;

    return [
      'status' => $inStock ? 'in_stock' : 'out_of_stock',
      'http_status' => 200,
      'raw' => substr($res['body'], 0, 500),
      'error' => null,
    ];
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
