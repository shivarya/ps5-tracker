/**
 * Verified live via chrome-devtools MCP on 2026-06-30 against a real PS5 listing. Contrary to the
 * "hardest target, likely still Akamai-blocked" assumption in server/utils/storeCheckers/AmazonChecker.php's
 * docblock, a real headed browser from a residential IP hit ZERO blocking/captcha — the original ids
 * guessed in this file before verification (`#glow-ingress-block`, `#GLUXZipUpdateInput`,
 * `#GLUXZipUpdate`) turned out to be exactly correct.
 *
 * Flow: click `#glow-ingress-block` (the "Deliver to {pincode}" header widget) → opens a "Choose your
 * location" modal → fill `#GLUXZipUpdateInput` (no sign-in needed, "or enter an Indian pincode") →
 * click `#GLUXZipUpdate` (a real Playwright `.click()` dispatches proper input events; a plain JS
 * `.click()` via `evaluate()` does NOT trigger Amazon's handler — confirmed the hard way during
 * verification) → page reloads in place with delivery info for that pincode.
 * Stock signal: "Currently unavailable" = out_of_stock, "Add to Cart"/"Buy Now" = in_stock.
 *
 * CAVEAT found during verification: the pincode-update AJAX call backing `#GLUXZipUpdate` intermittently
 * fails with a "Sorry, content is not available." error inside the modal — observed after several rapid
 * repeated automated attempts in a short window (possibly Amazon-side rate-limiting on that specific
 * endpoint, not a general block — the main page itself never got blocked across ~10 navigations). The
 * try/catch already falls through gracefully when this happens: global stock state is still read
 * correctly, just not guaranteed to reflect the exact tracked pincode for that one run. At a 30-min
 * polling cadence this should be rare; if `stock_check_log.raw` shows stale/wrong-pincode header text
 * repeatedly, that's this failure mode.
 */
const { scanBodyForStockMarkers, looksBlocked } = require('../utils/pageHelpers');

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
    await page.locator('#glow-ingress-block').click({ timeout: 5000 });
    const pincodeInput = page.locator('#GLUXZipUpdateInput');
    await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
    await pincodeInput.fill(pincode);
    await page.locator('#GLUXZipUpdate').click({ timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch (err) {
    // delivery widget not found/interactable (layout changed, or a captcha/sign-in wall appeared) —
    // fall through and read whatever stock state is showing regardless.
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/currently unavailable/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }

  const result = await scanBodyForStockMarkers(page);
  return { status: result.status, http_status: httpStatus, raw: result.raw, error: result.error };
}

module.exports = { check };
