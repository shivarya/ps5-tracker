<?php
require_once __DIR__ . '/StoreCheckerInterface.php';
require_once __DIR__ . '/../httpClient.php';

/**
 * STRETCH GOAL, hardest target — build/validate the five easy stores and
 * Flipkart first. Amazon.in's delivery-pincode widget is React-rendered and
 * likely sits behind Akamai Bot Manager; plain curl may not even be able to
 * load the serviceability check without executing JS. Needs a DevTools
 * capture (Network → Fetch/XHR, change pincode, Copy as cURL, for both an
 * in-stock and out-of-stock listing) before attempting a real implementation
 * — and even then it may not be feasible from shared hosting (see the plan's
 * risk section). Always returns 'error' until that capture happens.
 */
class AmazonChecker implements StoreCheckerInterface
{
  public static function check(string $url, string $pincode): array
  {
    return [
      'status' => 'error',
      'http_status' => null,
      'raw' => '',
      'error' => 'AmazonChecker not yet implemented — needs a DevTools-captured pincode-check request (see class docblock). May not be feasible from shared hosting at all.',
    ];
  }
}
