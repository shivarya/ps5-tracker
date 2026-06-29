<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * VERIFIED HIGH DIFFICULTY (2026-06-28) — contrary to the original plan's
 * "Low difficulty" assessment. Live testing found croma.com is behind Akamai
 * Bot Manager at the edge: a bare curl GET of even the plain product page
 * (not just the `api.croma.com` JSON endpoints) returns a 403 "Access Denied"
 * from Akamai before reaching origin — same class of problem as Amazon, not
 * the "standard e-commerce stack" originally assumed. `api.croma.com`'s
 * pricing/sku endpoints are equally blocked (return Akamai's Access Denied
 * page or require a `bm_sz` sensor cookie that only a real browser can mint).
 *
 * This checker is left in place — `HttpClient::looksBlocked()` correctly
 * classifies the 403 as `blocked` rather than crashing, so it degrades
 * gracefully — but expect it to report `blocked` on effectively every poll
 * until/unless a non-shared-hosting approach (real browser, proxy with
 * cookie-jar warmup) is used. Treat as a stretch goal alongside
 * Flipkart/Amazon, not one of the "easy five".
 */
class CromaChecker implements StoreCheckerInterface
{
  public static function check(string $url, string $pincode): array
  {
    $cookieJar = sys_get_temp_dir() . '/ps5_croma_' . md5($url) . '.cookies';
    $res = HttpClient::get($url, $cookieJar, [], 'https://www.croma.com/');

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
    if (str_contains($lower, 'sold out') || str_contains($lower, 'out of stock') || str_contains($lower, 'notify me')) {
      return ['status' => 'out_of_stock', 'http_status' => 200, 'raw' => '', 'error' => null];
    }
    if (str_contains($lower, 'add to cart') || str_contains($lower, 'buy now')) {
      return ['status' => 'in_stock', 'http_status' => 200, 'raw' => '', 'error' => null];
    }

    return ['status' => 'error', 'http_status' => 200, 'raw' => substr($res['body'], 0, 500), 'error' => 'Could not find a known stock marker — page structure may have changed'];
  }
}
