<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * STRETCH GOAL — build/validate the five easy stores first.
 *
 * Flipkart's pincode-serviceability check is an AJAX call its frontend JS
 * fires (historically near `/api/3/page/dynamic` or `/api/4/page/fetch`).
 * The exact path, payload, and response shape are NOT guessed here — they
 * must be captured via DevTools (open a PS5 listing, Network → Fetch/XHR,
 * change the delivery pincode, Copy as cURL) for both an in-stock and an
 * out-of-stock listing before this checker can be implemented for real.
 *
 * Until that capture happens this always returns 'error' so it's obviously
 * a stub rather than silently reporting wrong stock data.
 */
class FlipkartChecker implements StoreCheckerInterface
{
  public static function check(string $url, string $pincode): array
  {
    return [
      'status' => 'error',
      'http_status' => null,
      'raw' => '',
      'error' => 'FlipkartChecker not yet implemented — needs a DevTools-captured pincode-check request (see class docblock).',
    ];
  }
}
