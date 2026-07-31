<?php
/**
 * Every store checker normalizes to this result shape so the cron worker can
 * treat all stores identically regardless of how each one's pincode check works.
 * The local crawler's checkers/*.js mirror the same shape over POST /stock/report.
 *
 * `price` (added 2026-07-29) is the listed INR price when the checker can read one,
 * null when it can't — notifications are gated on it (see stockResultProcessor.php's
 * evaluateNotifyGate). Best-effort by design: a null price never blocks a check, and
 * never overwrites the last known good price.
 *
 * @phpstan-type CheckResult array{
 *   status: 'in_stock'|'out_of_stock'|'blocked'|'error',
 *   http_status: int|null,
 *   raw: string,
 *   error: string|null,
 *   price: float|null
 * }
 */
interface StoreCheckerInterface
{
  /** @return array{status:string, http_status:?int, raw:string, error:?string, price:?float} */
  public static function check(string $url, string $pincode): array;
}
