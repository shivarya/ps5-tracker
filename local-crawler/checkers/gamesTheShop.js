/**
 * Verified live via chrome-devtools MCP on 2026-06-30 against a real PS5 listing. Confirms the
 * Next.js storefront note in server/utils/storeCheckers/GamesTheShopChecker.php's docblock — stock
 * state IS present in the client-rendered HTML (`document.body.innerText` after a short wait), no
 * separate API call needed. Stock and deliverability are separate signals: a globally out-of-stock
 * item can still show "Delivery available in your area" for a given pincode — global stock state
 * takes priority (an item you can't buy isn't "in_stock" regardless of deliverability).
 *
 * Flow: fill `input[placeholder="Enter pincode"]` → click the "CHECK" text button → read body text.
 * Stock signal: "Out of Stock"/"Notify Me" = out_of_stock, "Add to Cart"/"Buy Now" = in_stock
 * (same markers as the generic fallback below, confirmed accurate for this store).
 */
const { scanBodyForStockMarkers } = require('../utils/pageHelpers');
const { firstRupeeAmount } = require('../utils/structuredData');

async function check(page, url, pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message, price: null };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(1500); // allow client-side hydration to settle

  try {
    const pincodeInput = page.getByPlaceholder('Enter pincode');
    await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
    await pincodeInput.fill(pincode);
    await page.getByText('CHECK', { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(1000);
  } catch (err) {
    // pincode widget not found/interactable — fall through, global stock state still readable
  }

  const result = await scanBodyForStockMarkers(page);
  // No usable ld+json on this storefront (verified 2026-07-29 — empty block), so the price comes
  // from the page text: "₹ 69,990" for the disc edition, "₹ 49,990" for digital.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return { status: result.status, http_status: httpStatus, raw: result.raw, error: result.error, price: firstRupeeAmount(bodyText) };
}

module.exports = { check };
