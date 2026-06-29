/**
 * Verified live via chrome-devtools MCP on 2026-06-30 against a real PS5 listing. Unlike Flipkart,
 * Croma uses real semantic CSS classes (not content-hashed), and — importantly — a real headed browser
 * is NOT Akamai-blocked here at all (unlike the bare curl request server/utils/storeCheckers/CromaChecker.php's
 * docblock documents as a 403 at the edge). Croma auto-detects/defaults a pincode via geo-IP on load; we
 * always override it explicitly via the pincode-editor modal rather than trusting the default.
 *
 * Flow: click `.header-pincode-edit.pincode-s-edit.pincode-pencil-icon` (pencil icon next to the
 * pincode shown in the header) → opens a "SELECT YOUR LOCATION" modal with `input.pinElem`
 * (placeholder="Enter Pincode", pre-filled with the current/default pincode — clear it first) → click
 * the "Continue" text button → page reloads delivery info for that pincode in place.
 * Stock signal: "Sold Out"/"Out of Stock"/"Notify Me" text = out_of_stock, "Add to Cart"/"Buy Now" = in_stock.
 *
 * BUG FOUND AND FIXED 2026-07-01: on a genuinely fresh browser session (no cached location — i.e.
 * every real scheduled-task run, since the crawler launches a new context each time), Croma instead
 * auto-shows the same "SELECT YOUR LOCATION" modal immediately on page load, with NO pencil icon to
 * click (none exists yet — no location is set). The pencil-icon click was timing out, the catch block
 * swallowed it, and the checker fell through to reading stock text from BEHIND the still-open modal —
 * `innerText()` includes the underlying page's "Add to Cart" text regardless of the modal covering it
 * visually, and regardless of which pincode (if any) Croma had defaulted to. This reported `in_stock`
 * for whatever Croma's own fallback/geo-IP-guessed pincode resolved to, never the tracked one. Fixed by
 * checking whether `input.pinElem` is already visible (auto-modal case) before attempting the
 * pencil-icon click at all.
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
    const pincodeInput = page.locator('input.pinElem');
    const modalAlreadyOpen = await pincodeInput.isVisible().catch(() => false);
    if (!modalAlreadyOpen) {
      await page.locator('.header-pincode-edit.pincode-s-edit.pincode-pencil-icon').first().click({ timeout: 5000 });
      await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
    }
    await pincodeInput.fill('');
    await pincodeInput.fill(pincode);
    await page.getByText('Continue', { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(1500);
  } catch (err) {
    // pincode widget not found/interactable (layout changed) — fall through and read whatever
    // stock state is showing regardless (may reflect Croma's geo-IP-defaulted pincode, not the
    // tracked one).
  }

  const result = await scanBodyForStockMarkers(page);
  return { status: result.status, http_status: httpStatus, raw: result.raw, error: result.error };
}

module.exports = { check };
