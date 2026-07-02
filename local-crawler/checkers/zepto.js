/**
 * zepto.com Playwright-based checker for PS5 stock.
 *
 * Zepto is a quick-commerce app; stock is location-specific (tied to the nearest dark
 * store). The product page uses `bff-gateway.zepto.com` (CORS-blocked from outside the
 * page) so no plain-axios approach is possible — Playwright with real browser is required.
 *
 * Flow captured via Chrome DevTools (2026-07-02) on the PS5 Slim listing:
 *   1. Product page loads; shows "Select Location" in the header if no location is set.
 *   2. Clicking "Select Location" opens a full-screen modal with a "Search a new address"
 *      text input (React-controlled, needs real Playwright fill() — JS value-set doesn't
 *      trigger the React synthetic event handler).
 *   3. Typing the pincode triggers `bff-gateway.zepto.com/api/v1/maps/place/autocomplete`
 *      and renders a suggestion list. Every row for a valid pincode includes the pincode
 *      number in its text (e.g. "Bengaluru, Karnataka 560067, India").
 *   4. Clicking a suggestion closes the modal, sets lat/lon/serviceability cookies, and
 *      reloads the PDP via `bff-gateway.zepto.com/lms/api/v2/get_page?page_type=PDP&
 *      store_id=<store>&product_variant_id=<pvid>`.
 *   5. Stock signal — unambiguous from page text:
 *        "Add to Cart"               → in_stock
 *        "Notify Me when back in stock" / "Notify Me" → out_of_stock
 *      No pincode confirmation guard needed: the location picker sets the store before
 *      the page renders stock status, so the text is always pincode-specific.
 *
 * If the location picker is already set (cookie present from a prior run in the same
 * Playwright context), step 2–4 are skipped and the page loads with the right location.
 * Because index.js creates a fresh context per run, location must be set every time.
 *
 * pvid (product_variant_id) is the UUID in the product URL path after /pvid/ — it is
 * the stable Zepto identifier for this SKU and does NOT change with location.
 */
const { looksBlocked } = require('../utils/pageHelpers');

async function check(page, url, pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(2000);

  const bodyTextEarly = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyTextEarly)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyTextEarly.slice(0, 2000), error: null };
  }

  // Set location if the picker is showing (no location cookie from this session).
  const selectLocVisible = await page.getByText('Select Location', { exact: true }).isVisible({ timeout: 2000 }).catch(() => false);
  if (selectLocVisible) {
    try {
      await page.getByText('Select Location', { exact: true }).click({ timeout: 5000 });
      const searchInput = page.getByPlaceholder('Search a new address');
      await searchInput.waitFor({ state: 'visible', timeout: 8000 });
      // Playwright fill() properly triggers React's synthetic event handlers.
      await searchInput.fill(pincode);
      await page.waitForTimeout(2000); // wait for autocomplete suggestions
      // Click first suggestion row that contains the pincode.
      const suggestionRow = page.locator('li, [role="option"], [role="listitem"]').filter({ hasText: pincode });
      await suggestionRow.first().click({ timeout: 8000 });
      // Wait for the product page to reload with the new location applied.
      await page.waitForTimeout(3000);
    } catch (locErr) {
      // Location picker failed — continue and check what the page shows anyway.
      // If it still says "Select Location", the stock check will be inconclusive.
    }
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');

  if (/notify me/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }

  if (/add to cart/i.test(bodyText)) {
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null };
  }

  // If "Select Location" is still showing, the location picker didn't complete.
  if (/select location/i.test(bodyText)) {
    return {
      status: 'error',
      http_status: httpStatus,
      raw: bodyText.slice(0, 500),
      error: `Location picker did not complete for pincode ${pincode} — could not determine stock status`,
    };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: bodyText.slice(0, 500),
    error: 'Could not find a known stock marker ("Add to Cart" / "Notify Me") — page structure may have changed',
  };
}

module.exports = { check };
