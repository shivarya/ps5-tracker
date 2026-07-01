/**
 * Verified live via chrome-devtools MCP on 2026-06-30 against a real PS5 listing.
 *
 * Flow: click the text matching /Delivery in \d+ minutes/ (the header location bar — exact minute
 * count varies, hence the regex) → opens a "Change Location" modal → fill
 * `input[placeholder="search delivery location"]` → wait for suggestions → click the first
 * `div[class*="LocationListContainer"]` (Blinkit's styled-components classes have a stable readable
 * prefix plus a build-hash suffix — match on the prefix via `[class*=...]`) → page updates
 * delivery info in place, no separate "Confirm" step needed.
 *
 * Stock signal — FALSE POSITIVE BUG hit 2026-07-01: `/\bADD\b/` matched ADD buttons from the
 * "Similar products" section (PS5 games, DualSense controllers) even when the PS5 itself showed
 * "Out of stock". Also, in a fresh Playwright session with no cookies, Blinkit's IP-geolocation
 * default could be a non-560067 location where the PS5 IS in stock, making the full-body scan
 * unreliable.
 *
 * Fixed by two measures:
 *   1. After the location interaction, verify the tracked pincode appears in the page header area
 *      (top ~300 chars). If it never does, return error rather than a wrong stock state.
 *   2. Scope OOS/ADD checks to text BEFORE "Similar products" / "Top 10 products" section headers
 *      (confirmed live: "Out of stock" for the PS5 appears at idx ~327, "Similar products" at ~674,
 *      first "ADD" for similar items at ~793 — the product section has no ADD when OOS, and has ADD
 *      when in-stock; the similar-products section always has ADD buttons regardless of PS5 state).
 *
 * In-stock "ADD" button confirmed via in-stock sibling product cards only (no PS5 in-stock run
 * available for direct verification), but the scoped-text fix is the correct signal either way.
 */
const { looksBlocked } = require('../utils/pageHelpers');

// Section headings that mark the end of the main product content on Blinkit PDPs.
const RELATED_SECTION_RE = /similar products|top \d+ products|you may also like|frequently bought/i;

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

  let pincodeConfirmed = bodyTextEarly.slice(0, 300).includes(pincode);

  if (!pincodeConfirmed) {
    try {
      await page.getByText(/Delivery in \d+ minutes?/).first().click({ timeout: 5000 });
      const pincodeInput = page.getByPlaceholder('search delivery location');
      await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
      await pincodeInput.fill(pincode);
      await page.waitForTimeout(1500);
      await page.locator('div[class*="LocationListContainer"]').first().click({ timeout: 5000 });
      // Poll until the pincode appears in the header area (top of page text).
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const t = await page.locator('body').innerText().catch(() => '');
        if (t.slice(0, 300).includes(pincode)) { pincodeConfirmed = true; break; }
        await page.waitForTimeout(300);
      }
    } catch (_) {
      // Location widget not found/interactable — pincodeConfirmed stays false.
    }
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');

  // Scope checks to the product section only — text before the "Similar products" / related
  // sections which contain ADD buttons for unrelated in-stock items.
  const relatedMatch = RELATED_SECTION_RE.exec(bodyText);
  const productSection = relatedMatch ? bodyText.slice(0, relatedMatch.index) : bodyText;

  if (/out of stock|currently unavailable|sold out/i.test(productSection)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: productSection.slice(0, 500), error: null };
  }

  if (/\bADD\b/.test(productSection) || /add to cart|buy now/i.test(productSection)) {
    if (!pincodeConfirmed) {
      return {
        status: 'error',
        http_status: httpStatus,
        raw: productSection.slice(0, 500),
        error: `"ADD" found in product section but pincode ${pincode} was not confirmed in page header — possible wrong delivery location`,
      };
    }
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: productSection.slice(0, 500),
    error: 'Could not find a known stock marker in the product section — page structure may have changed',
  };
}

module.exports = { check };
