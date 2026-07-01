/**
 * Verified live via chrome-devtools MCP on 2026-06-30 (see ps5-tracker memory/CLAUDE.md) against real
 * PS5 listings (console + PlayStation Portal). Flipkart's delivery-location picker:
 *   1. A fresh session shows a "Select delivery location" text prompt (no CSS test-ids; Flipkart uses
 *      content-hashed `css-xxxxx` class names that aren't stable across deploys, so every selector here
 *      is text/placeholder-based instead of class-based).
 *   2. Clicking it opens a panel with an `input[placeholder="Search by area, street name, pin code"]`.
 *   3. Typing the pincode renders a suggestion list where every row contains the typed pincode as its
 *      own text node (confirmed: "560067", "560001" each appeared verbatim in every suggestion) — so
 *      `getByText(pincode, { exact: true }).first()` reliably hits the first suggestion regardless of
 *      which city/area it resolves to.
 *   4. Clicking a suggestion goes to a "Set Delivery location"/"Select delivery address" map screen with
 *      a pin already placed at the right spot and a "Confirm" button (plain text, also a `css-xxxxx`
 *      div, no role="button") — click it to apply.
 *   5. Stock signal — checked in order:
 *        a. "Notify Me" text present → out_of_stock (global OOS, most reliable signal).
 *        b. Pincode-specific "not serviceable"/"not available"/"cannot be delivered" → out_of_stock
 *           (item exists globally but doesn't ship to this pincode). FALSE POSITIVE BUG hit 2026-07-01:
 *           Flipkart showed "Buy now" (global stock) but the pincode delivery section said the item
 *           wasn't deliverable to 560067 — we reported in_stock incorrectly. Fix: scan for
 *           pincode-specific unavailability text before accepting "Buy now" as in_stock.
 *        c. "Buy now" or "ADD TO CART" and no delivery-unavailability text → in_stock.
 *   NOTE: the pincode interaction is still wrapped in try/catch so a widget-layout change doesn't
 *   crash the run — but if the pincode can't be confirmed in the page text afterward, we return
 *   error rather than a possibly-wrong stock state (same pattern as croma.js).
 */
const { looksBlocked } = require('../utils/pageHelpers');

// Patterns Flipkart uses when an item exists but won't ship to the selected pincode.
const NOT_SERVICEABLE_RE = /not (available|serviceable|deliverable)|delivery (not available|unavailable)|cannot be delivered|don't deliver|doesn't deliver|pincode.*not.*service|service.*not.*available/i;

async function check(page, url, pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(1000);

  const bodyTextEarly = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyTextEarly)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyTextEarly.slice(0, 2000), error: null };
  }

  let pincodeConfirmed = false;
  try {
    await page.getByText('Select delivery location', { exact: true }).click({ timeout: 5000 });
    const pincodeInput = page.getByPlaceholder('Search by area, street name, pin code');
    await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
    await pincodeInput.fill(pincode);
    await page.waitForTimeout(1500);
    await page.getByText(pincode, { exact: true }).first().click({ timeout: 5000 });
    await page.getByText('Confirm', { exact: true }).click({ timeout: 5000 });
    // Poll until the pincode appears in page text (confirm the widget actually applied it).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const t = await page.locator('body').innerText().catch(() => '');
      if (t.includes(pincode)) { pincodeConfirmed = true; break; }
      await page.waitForTimeout(300);
    }
  } catch (_) {
    // Location widget not found/interactable — pincodeConfirmed stays false.
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');

  if (/notify me/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }

  if (NOT_SERVICEABLE_RE.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }

  if (/buy now|add to cart/i.test(bodyText)) {
    if (!pincodeConfirmed) {
      // "Buy now" present but we couldn't verify the pincode was applied — could be global stock
      // for a different delivery location. Return error rather than a false positive.
      return {
        status: 'error',
        http_status: httpStatus,
        raw: bodyText.slice(0, 500),
        error: `"Buy now" found but pincode ${pincode} was not confirmed in page text — possible global stock for wrong location`,
      };
    }
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: bodyText.slice(0, 500),
    error: 'Could not find a known stock marker ("Notify Me" / "Buy now" / "Add to cart") — page structure may have changed',
  };
}

module.exports = { check };
