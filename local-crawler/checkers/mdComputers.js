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
 * FALSE-POSITIVE BUG FOUND AND FIXED 2026-07-29 (user reported "md computer is sending false
 * notifications frequently" — 38 of the 40 push notifications in the crawler's last 500 runs came
 * from this one listing, flipping out_of_stock -> in_stock -> out_of_stock within a single 30-min
 * cycle). Reproduced live by sampling this PDP at t+1s / t+3s / t+7s across three fresh contexts:
 *
 *   t+1s  notifyMe=false  addToCart=true   <-- the false in_stock window (2 of 3 runs)
 *   t+3s  notifyMe=true   addToCart=false
 *   t+7s  notifyMe=true   addToCart=false
 *
 * Root cause: the real buy box's "Notify Me!" button (`#button-nwa-duplicate`, injected by the
 * store's notify-when-available plugin) renders LATE, while the WooCommerce related-products
 * carousel — whose cards each carry their own `.add_to_cart_button.add-to-cart-loop` — becomes
 * visible EARLY. The old code waited a fixed 3000ms and then scanned `body.innerText` for
 * "Notify Me" before "Add to Cart", so any run where hydration landed on the slow side of that
 * fixed wait read the carousel's buttons as the product's own state and reported in_stock.
 *
 * Fix: read the stock state from the schema.org JSON-LD block instead (`offers.availability`),
 * which is server-rendered, present from first paint, unambiguous, and immune to the hydration
 * race — verified identical (`OutOfStock`) in all 9 samples above including the two that fooled
 * the text scan. It also carries the price (`offers.price`), so no separate price lookup is
 * needed. Using it as the *stock* signal is only sound because this store's global stock equals
 * deliverability; do not copy this pattern to a pincode-gated retailer.
 *
 * The text scan survives only as a fallback for when the LD block is missing entirely, and is now
 * scoped to the main product element (excluding `.add-to-cart-loop` carousel buttons) so it can't
 * reproduce the same false positive. If neither signal is readable we return `error` — never a guess.
 *
 * URL format: https://mdcomputers.in/product/{slug} (old .html URLs 301-redirect here).
 */
const { looksBlocked } = require('../utils/pageHelpers');
const { readProductData, availabilityToStatus } = require('../utils/structuredData');

async function check(page, url, _pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message, price: null };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(1500);

  const bodyText = await page.locator('body').innerText().catch(() => '');

  if (looksBlocked(bodyText) || /you have been blocked|attention required/i.test(bodyText)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyText.slice(0, 2000), error: null, price: null };
  }

  // Primary signal: server-rendered structured data (see the docblock — this is the fix for the
  // hydration race that made this checker the source of nearly every false alert).
  const product = await readProductData(page);
  const ldStatus = availabilityToStatus(product.availability);
  if (ldStatus) {
    return {
      status: ldStatus,
      http_status: httpStatus,
      raw: `ld+json availability=${product.availability} price=${product.price}`,
      error: null,
      price: product.price,
    };
  }

  // Fallback: scoped text scan. Only the main product summary is considered — the related-products
  // carousel's own "Add to Cart" buttons live outside it and are what the old whole-body scan hit.
  const productText = await page
    .locator('.product-page-inner, .summary.entry-summary, .single-product-content')
    .first()
    .innerText()
    .catch(() => '');
  const scopedText = productText || '';

  if (/notify me/i.test(scopedText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: scopedText.slice(0, 500), error: null, price: product.price };
  }
  if (/add to cart|buy now/i.test(scopedText)) {
    return { status: 'in_stock', http_status: httpStatus, raw: scopedText.slice(0, 500), error: null, price: product.price };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: (scopedText || bodyText).slice(0, 500),
    error:
      'No schema.org availability in the page and no stock marker in the product summary — ' +
      'page structure may have changed (deliberately not falling back to a whole-body text scan: ' +
      'that is what caused the 2026-07-29 false-alert bug)',
    price: product.price,
  };
}

module.exports = { check };
