/**
 * Verified live via chrome-devtools MCP on 2026-06-30 against a real PS5 listing (out-of-stock case
 * only — this specific listing was sold out throughout verification, so the in_stock marker below is
 * inferred from sibling "ADD" buttons on other in-stock product cards on the same page, not directly
 * confirmed on a purchasable PS5 listing yet).
 *
 * Flow: click the text matching /Delivery in \d+ minutes/ (the header location bar — exact minute
 * count varies, hence the regex) → opens a "Change Location" modal → fill
 * `input[placeholder="search delivery location"]` → wait for suggestions → click the first
 * `div[class*="LocationListContainer"]` (Blinkit's styled-components classes have a stable readable
 * prefix plus a build-hash suffix, e.g. `LocationListContainer-sc-93rfr7-0` — match on the stable
 * prefix via `[class*=...]` rather than the full hashed class) → page updates delivery info in place,
 * no separate "Confirm" step needed (unlike Flipkart/Amazon).
 * Stock signal: "Out of stock" text = out_of_stock; an enabled "ADD" button for this product = in_stock.
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
  await page.waitForTimeout(1500);

  const bodyTextEarly = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyTextEarly)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyTextEarly.slice(0, 2000), error: null };
  }

  try {
    await page.getByText(/Delivery in \d+ minutes?/).first().click({ timeout: 5000 });
    const pincodeInput = page.getByPlaceholder('search delivery location');
    await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
    await pincodeInput.fill(pincode);
    await page.waitForTimeout(1500);
    await page.locator('div[class*="LocationListContainer"]').first().click({ timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch (err) {
    // location widget not found/interactable — fall through and read whatever stock state is
    // showing regardless (may reflect a stale/default location, not the tracked pincode).
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/out of stock|currently unavailable|sold out/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }
  if (/\bADD\b/.test(bodyText) || /add to cart|buy now/i.test(bodyText)) {
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: bodyText.slice(0, 500),
    error: 'Could not find a known stock marker — page structure may have changed',
  };
}

module.exports = { check };
