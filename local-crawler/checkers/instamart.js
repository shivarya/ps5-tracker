const { scanBodyForStockMarkers, looksBlocked } = require('../utils/pageHelpers');

/**
 * CONFIRMED BLOCKED even with a real headed browser — verified live via chrome-devtools MCP on
 * 2026-06-30. Unlike Croma/Flipkart/Amazon/Blinkit/Games The Shop (all of which loaded fine with a
 * real browser despite some being curl-blocked server-side), simply navigating to
 * `swiggy.com/instamart` returns "Request Blocked — Your request looks automated and has been
 * blocked." immediately, reproduced on a fresh reload. This is a harder anti-automation tier (likely
 * CDP/`navigator.webdriver` fingerprinting rather than just a headless-vs-headed check) — the
 * selectors below are still unverified best-effort guesses, kept as a starting point for if/when this
 * is revisited with stealth tooling (e.g. `playwright-extra` + a stealth plugin, not currently a
 * dependency here) or a different automation approach. Expect `blocked` on every real run until then.
 *
 * SUPERSEDED 2026-06-30: `index.js` now uses `checkers/instamartMcp.js` (Swiggy's official Builders
 * MCP API, not browser automation) for the `instamart` store instead of this file. Kept here as a
 * record of the browser-automation attempt and its confirmed-blocked result, in case the MCP route
 * ever needs a fallback.
 */
async function check(page, url, pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(1500); // the "Request Blocked" page is client-rendered; domcontentloaded fires before it appears

  const bodyTextEarly = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyTextEarly)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyTextEarly.slice(0, 2000), error: null };
  }

  try {
    const locationInput = page.locator('input[placeholder*="location" i], input[placeholder*="area" i], input[placeholder*="address" i]').first();
    if (await locationInput.count() > 0) {
      await locationInput.fill(pincode);
      await page.waitForTimeout(1500);
      const suggestion = page.locator('[class*="address" i], [class*="suggestion" i], li').first();
      if (await suggestion.count() > 0) {
        await suggestion.click();
        await page.waitForTimeout(1500);
      }
    }
  } catch {
    // location picker not found/interactable — proceed, results may reflect a stale/default location
  }

  const lower = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  if (lower.includes('notify me') || lower.includes('currently unavailable') || lower.includes('out of stock')) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: '', error: null };
  }
  if (lower.includes('add to cart') || lower.match(/\badd\b/)) {
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null };
  }

  const result = await scanBodyForStockMarkers(page);
  return { status: result.status, http_status: httpStatus, raw: result.raw, error: result.error };
}

module.exports = { check };
