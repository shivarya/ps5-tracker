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
 *   5. Stock signal (verified against both an out-of-stock PS5 console and an in-stock PlayStation
 *      Portal): "Notify Me" text present = out_of_stock; "Buy now" or "ADD TO CART" text present =
 *      in_stock. This reflects general stock, not yet confirmed to change per-pincode for a genuinely
 *      undeliverable address — if that turns out to matter, look for "not deliverable"/"not serviceable"
 *      text after confirming the pincode.
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
  await page.waitForTimeout(1000);

  const bodyTextEarly = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyTextEarly)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyTextEarly.slice(0, 2000), error: null };
  }

  try {
    await page.getByText('Select delivery location', { exact: true }).click({ timeout: 5000 });
    const pincodeInput = page.getByPlaceholder('Search by area, street name, pin code');
    await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
    await pincodeInput.fill(pincode);
    await page.waitForTimeout(1500);
    await page.getByText(pincode, { exact: true }).first().click({ timeout: 5000 });
    await page.getByText('Confirm', { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch (err) {
    // Location widget not found/interactable (layout changed, or address already saved from a prior
    // run reusing a profile) — fall through and read whatever stock state is showing regardless.
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/notify me/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }
  if (/buy now|add to cart/i.test(bodyText)) {
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
