<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * vijaysales.com's PDP calls a separate microservice for pincode
 * serviceability — captured live via Chrome DevTools on a real PS5 listing
 * (2026-06-28):
 *
 *   GET https://oms.vijaysales.systems/v1/servicability?pincode={pincode}&vanNo={sku}&storeList=true
 *
 * Verified working with plain curl given just a `User-Agent` + `Origin`
 * header (no auth, no signature, `access-control-allow-origin: *`) — a bare
 * request with zero headers returns `{"error":"Access denied."}`, but
 * User-Agent + Origin alone is enough. Response shape:
 *   {"data": {"<sku>": {"isServiceable": bool, "maxQuantity": int, ...}}}
 *
 * `vanNo` is the numeric SKU that appears in the product URL itself
 * (.../p/{sku}/slug-text), so no separate lookup is needed.
 *
 * Price (added 2026-07-29): the servicability microservice returns stock only, no price —
 * confirmed live against SKU 259648. The PDP HTML does carry it server-rendered though
 * (`data-compare-price="69990"`), so price comes from a second, best-effort GET of the product
 * page; a failure there just yields a null price and never affects the stock verdict.
 */
class VijaySalesChecker implements StoreCheckerInterface
{
  public static function check(string $url, string $pincode): array
  {
    $sku = self::extractSku($url);
    if ($sku === null) {
      return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => 'Could not extract SKU from URL: ' . $url];
    }

    $apiUrl = "https://oms.vijaysales.systems/v1/servicability?pincode={$pincode}&vanNo={$sku}&storeList=true";

    // Cookie jar is per-listing but not reused across separate check() calls — see
    // SonyCenterChecker.php's docblock for the real bug this convention caused there
    // (an accumulating abandoned-cart quantity from cron polls silently sharing a session).
    $cookieJar = sys_get_temp_dir() . '/ps5_vs_' . md5($url) . '.cookies';
    try {
      $res = HttpClient::get($apiUrl, $cookieJar, [
        'Origin: https://www.vijaysales.com',
        'Accept: */*',
      ], 'https://www.vijaysales.com/');

      if (!$res['ok']) {
        return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => $res['error'], 'price' => null];
      }
      if (HttpClient::looksBlocked((int)$res['http_status'], $res['body'])) {
        return ['status' => 'blocked', 'http_status' => $res['http_status'], 'raw' => substr($res['body'], 0, 2000), 'error' => null, 'price' => null];
      }
      if ($res['http_status'] !== 200) {
        return ['status' => 'error', 'http_status' => $res['http_status'], 'raw' => substr($res['body'], 0, 2000), 'error' => 'Unexpected HTTP status', 'price' => null];
      }

      $decoded = json_decode($res['body'], true);
      $entry = $decoded['data'][$sku] ?? null;
      if (!is_array($entry)) {
        return ['status' => 'error', 'http_status' => 200, 'raw' => substr($res['body'], 0, 500), 'error' => 'Unexpected response shape — endpoint may have changed', 'price' => null];
      }

      $inStock = !empty($entry['isServiceable']) && (int)($entry['maxQuantity'] ?? 0) > 0;

      return [
        'status' => $inStock ? 'in_stock' : 'out_of_stock',
        'http_status' => 200,
        'raw' => substr($res['body'], 0, 500),
        'error' => null,
        'price' => self::fetchPrice($url, $cookieJar),
      ];
    } finally {
      @unlink($cookieJar);
    }
  }

  /**
   * Best-effort price read from the PDP HTML. `data-compare-price` is the cleanest anchor
   * (a bare integer, no currency/thousands formatting); the visible `₹69990` text is the
   * fallback. Returns null rather than throwing — price is never allowed to fail a check.
   */
  private static function fetchPrice(string $url, string $cookieJar): ?float
  {
    $res = HttpClient::get($url, $cookieJar, ['Accept: text/html'], 'https://www.vijaysales.com/');
    if (!$res['ok'] || $res['http_status'] !== 200) {
      return null;
    }
    if (preg_match('/data-compare-price="(\d+(?:\.\d+)?)"/', $res['body'], $m)) {
      return (float)$m[1];
    }
    if (preg_match('/₹\s?([0-9][0-9,]{3,})/u', $res['body'], $m)) {
      return (float)str_replace(',', '', $m[1]);
    }
    return null;
  }

  /** Extracts the numeric SKU from a vijaysales.com /p/{sku}/{slug} URL. */
  private static function extractSku(string $url): ?string
  {
    if (preg_match('#/p/(\d+)/#', $url, $m)) {
      return $m[1];
    }
    return null;
  }
}
