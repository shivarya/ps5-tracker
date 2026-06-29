<?php
/**
 * Every store checker normalizes to this result shape so the cron worker can
 * treat all stores identically regardless of how each one's pincode check works.
 *
 * @phpstan-type CheckResult array{
 *   status: 'in_stock'|'out_of_stock'|'blocked'|'error',
 *   http_status: int|null,
 *   raw: string,
 *   error: string|null
 * }
 */
interface StoreCheckerInterface
{
  /** @return array{status:string, http_status:?int, raw:string, error:?string} */
  public static function check(string $url, string $pincode): array;
}
