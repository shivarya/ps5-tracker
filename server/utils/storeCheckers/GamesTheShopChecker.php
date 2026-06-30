<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * gamestheshop.com turned out to be a custom Next.js storefront, NOT Shopify
 * (confirmed via curl, 2026-06-28 — homepage serves Next.js `_next/static`
 * asset paths, no Shopify markers). The original plan's assumption that this
 * store might also expose a Shopify `.json` endpoint does not hold; that
 * attempt has been removed. No specific stock/pincode API has been captured
 * for this store yet — falls back to scanning the rendered PDP HTML for a
 * stock marker, same as the original heuristic approach.
 *
 * TODO: capture this store's actual stock-check network request via
 * DevTools (it's a client-rendered Next.js app, so look for a `/api/...` or
 * `/_next/data/...` XHR/fetch call when loading a PDP) before trusting this
 * checker's accuracy. This retailer also lists grey-market stock per
 * research — verify a tracked listing is genuine retail, not an importer SKU.
 */
class GamesTheShopChecker implements StoreCheckerInterface
{
  public static function check(string $url, string $pincode): array
  {
    // Cookie jar is per-listing but not reused across separate check() calls — see
    // SonyCenterChecker.php's docblock for the real bug this convention caused there.
    $cookieJar = sys_get_temp_dir() . '/ps5_gts_' . md5($url) . '.cookies';
    try {
      $res = HttpClient::get($url, $cookieJar, [], 'https://www.gamestheshop.com/');

      if (!$res['ok']) {
        return ['status' => 'error', 'http_status' => null, 'raw' => '', 'error' => $res['error']];
      }
      if (HttpClient::looksBlocked((int)$res['http_status'], $res['body'])) {
        return ['status' => 'blocked', 'http_status' => $res['http_status'], 'raw' => substr($res['body'], 0, 2000), 'error' => null];
      }
      if ($res['http_status'] !== 200) {
        return ['status' => 'error', 'http_status' => $res['http_status'], 'raw' => substr($res['body'], 0, 2000), 'error' => 'Unexpected HTTP status'];
      }

      $lower = strtolower($res['body']);
      if (str_contains($lower, 'sold out') || str_contains($lower, 'out of stock')) {
        return ['status' => 'out_of_stock', 'http_status' => 200, 'raw' => '', 'error' => null];
      }
      if (str_contains($lower, 'add to cart') || str_contains($lower, 'buy now')) {
        return ['status' => 'in_stock', 'http_status' => 200, 'raw' => '', 'error' => null];
      }

      return ['status' => 'error', 'http_status' => 200, 'raw' => substr($res['body'], 0, 500), 'error' => 'Could not find a known stock marker — this is a client-rendered Next.js app, stock state may not be present in the initial HTML at all'];
    } finally {
      @unlink($cookieJar);
    }
  }
}
