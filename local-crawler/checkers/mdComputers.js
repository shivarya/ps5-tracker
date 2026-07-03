/**
 * mdcomputers.in Playwright-based checker for PS5 stock.
 *
 * MD Computers is a genuine Kolkata-based PC/console retailer that ships pan-India from a
 * central warehouse — stock is NOT pincode-dependent, so no location interaction is needed.
 * If it's in stock, it ships to the tracked pincode.
 *
 * Cloudflare notes (verified live 2026-07-03):
 *   - Plain curl/HTTP is blocked outright ("Sorry, you have been blocked") — local crawler
 *     only, no server-side PHP checker possible (same tier as Croma).
 *   - A real browser loads the PDP fine on a fresh session, BUT hitting a malformed route
 *     (e.g. /search?q=...) gets the whole session flagged and then even the PDP is blocked
 *     for that session. The flag is cookie/session-scoped, not IP-scoped — a fresh Playwright
 *     context immediately works again. Never navigate anywhere but the product URL here.
 *
 * Stock signal (from page text):
 *   "Notify Me"                  → out_of_stock (verified live on the PS5 Slim PDP)
 *   "Add to Cart" / "Buy Now"    → in_stock (standard theme buttons; not yet verified on a
 *                                  purchasable PS5 — same caveat as blinkit.js)
 *   Cloudflare block text        → blocked
 *
 * Verified: "Add to Cart" does NOT appear anywhere on an OOS PDP (no related-products
 * false positive), but "Notify Me" is still checked first as belt-and-braces.
 *
 * URL format: https://mdcomputers.in/product/{slug} (old .html URLs 301-redirect here).
 */
const { looksBlocked } = require('../utils/pageHelpers');

async function check(page, url, _pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(3000);

  const bodyText = await page.locator('body').innerText().catch(() => '');

  if (looksBlocked(bodyText) || /you have been blocked|attention required/i.test(bodyText)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyText.slice(0, 2000), error: null };
  }

  if (/notify me/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }

  if (/add to cart|buy now/i.test(bodyText)) {
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: bodyText.slice(0, 500),
    error: 'Could not find a known stock marker ("Notify Me" / "Add to Cart" / "Buy Now") — page structure may have changed',
  };
}

module.exports = { check };
