/**
 * zepto.com Playwright-based checker for PS5 stock.
 *
 * Zepto is a quick-commerce app; stock is location-specific (tied to the nearest dark
 * store). The product page uses `bff-gateway.zepto.com` (CORS-blocked from outside the
 * page) so no plain-axios approach is possible — Playwright with real browser is required.
 *
 * Stock signal — unambiguous from page text:
 *   "Add to Cart"               → in_stock
 *   "Notify Me when back in stock" / "Notify Me" → out_of_stock
 *
 * Location approach — cookie injection (NOT UI-based location picker):
 *   The location picker modal worked in a real Chrome session but Playwright's click on the
 *   div-based location button (it has no role="button") never opened the modal regardless of
 *   which selector or wait strategy was tried. Injecting the location cookies directly via
 *   page.context().addCookies() before navigation is reliable and faster.
 *
 *   Cookies captured from a Chrome DevTools session with pincode 560067 set:
 *     latitude / longitude — plain floats
 *     user_position         — URL-encoded JSON with lat/lon
 *     serviceability        — URL-encoded JSON with storeId for the nearest dark store
 *       storeId for 560067 (Kadugodi / BLR-Belathur):
 *         primary   = e58fff62-7695-44c2-aba0-6bc96074bc64  (8 min ETA)
 *         secondary = 0059ff6a-7eb0-477a-a7f5-69256f2c444b (21 min ETA)
 *
 *   To support a new pincode: open zepto.com in a fresh Chrome session, set the location to
 *   the desired pincode, then run `document.cookie` in DevTools Console and capture the four
 *   cookies above. Add a new entry to LOCATION_COOKIES below.
 *
 *   If the pincode is not in LOCATION_COOKIES, the checker returns status='error'.
 */
const { looksBlocked } = require('../utils/pageHelpers');
const { readProductData } = require('../utils/structuredData');

const STOCK_MARKER_RE = /notify me|add to cart|out of stock/i;
const STOCK_MARKER_TIMEOUT_MS = 6000;
// Zepto serves its 404 as HTTP 202 with a soft-404 body ("...has made an egg-sit"), so the status
// code can't be trusted to spot a delisted product — match the copy instead. Hit live on
// 2026-07-29: the tracked PS5 PDP worked at 10:15 and 404'd by 11:40, with Zepto's catalog left
// holding only PS5 games and accessories. Worth distinguishing from a parse failure, since the
// fix is "find a new URL", not "fix the checker".
const NOT_FOUND_RE = /egg-sit|page you.{0,3}re looking for/i;

/** Waits until the product card shows a definite stock marker; returns the last read on timeout. */
async function pollForStockMarker(page) {
  const deadline = Date.now() + STOCK_MARKER_TIMEOUT_MS;
  let latest = '';
  while (Date.now() < deadline) {
    latest = await page.locator('body').innerText().catch(() => '');
    if (STOCK_MARKER_RE.test(latest) || looksBlocked(latest) || NOT_FOUND_RE.test(latest)) return latest;
    await page.waitForTimeout(300);
  }
  return latest;
}

// Captured from a Chrome DevTools session with each pincode set in the location picker.
// Values are stored URL-encoded (as Zepto's React app sets them).
const LOCATION_COOKIES = {
  '560067': {
    latitude: '12.9967012',
    longitude: '77.758197',
    user_position: '%7B%22latitude%22%3A12.9967012%2C%22longitude%22%3A77.758197%7D',
    serviceability: '%7B%22primaryStore%22%3A%7B%22etaInMinutes%22%3A%228%22%2C%22isDeliverable%22%3Atrue%2C%22isNightlyStore%22%3Afalse%2C%22serviceable%22%3Atrue%2C%22storeConstruct%22%3A%22PRIMARY_STORE%22%2C%22storeId%22%3A%22e58fff62-7695-44c2-aba0-6bc96074bc64%22%7D%2C%22secondaryStore%22%3A%7B%22etaInMinutes%22%3A%2221%22%2C%22isDeliverable%22%3Atrue%2C%22isNightlyStore%22%3Afalse%2C%22serviceable%22%3Atrue%2C%22storeConstruct%22%3A%22SECONDARY_STORE%22%2C%22storeId%22%3A%220059ff6a-7eb0-477a-a7f5-69256f2c444b%22%7D%2C%22storesData%22%3A%7B%22e58fff62-7695-44c2-aba0-6bc96074bc64%22%3A%7B%22etaInMinutes%22%3A%228%22%2C%22isDeliverable%22%3Atrue%2C%22isNightlyStore%22%3Afalse%2C%22serviceable%22%3Atrue%2C%22storeConstruct%22%3A%22PRIMARY_STORE%22%2C%22storeId%22%3A%22e58fff62-7695-44c2-aba0-6bc96074bc64%22%7D%2C%220059ff6a-7eb0-477a-a7f5-69256f2c444b%22%3A%7B%22etaInMinutes%22%3A%2221%22%2C%22isDeliverable%22%3Atrue%2C%22isNightlyStore%22%3Afalse%2C%22serviceable%22%3Atrue%2C%22storeConstruct%22%3A%22SECONDARY_STORE%22%2C%22storeId%22%3A%220059ff6a-7eb0-477a-a7f5-69256f2c444b%22%7D%7D%2C%22etaInformation%22%3A%7B%22secondaryText%22%3A%228%20minutes%22%7D%2C%22storeDetailedInfo%22%3A%7B%22city%22%3A%22Bengaluru%22%2C%22name%22%3A%22BLR-Belathur%22%7D%2C%22timeSaved%22%3A1783012660392%7D',
  },
};

async function check(page, url, pincode) {
  const locCookies = LOCATION_COOKIES[pincode];
  if (!locCookies) {
    return {
      status: 'error',
      http_status: null,
      raw: '',
      error: `No location cookies configured for pincode ${pincode}. Add an entry to LOCATION_COOKIES in zepto.js (see docblock above).`,
      price: null,
    };
  }

  // Inject location cookies before navigation so Zepto loads the page with the right
  // dark-store context, bypassing the location picker entirely.
  await page.context().addCookies([
    { name: 'latitude',       value: locCookies.latitude,       domain: '.zepto.com', path: '/' },
    { name: 'longitude',      value: locCookies.longitude,      domain: '.zepto.com', path: '/' },
    { name: 'user_position',  value: locCookies.user_position,  domain: '.zepto.com', path: '/' },
    { name: 'serviceability', value: locCookies.serviceability, domain: '.zepto.com', path: '/' },
  ]);

  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message, price: null };
  }
  const httpStatus = response ? response.status() : null;

  // Poll for a definite stock marker instead of reading the body once after a fixed 2s wait — the
  // product card hydrates late and a single early read intermittently returned `error` (seen on a
  // live prod run 2026-07-29). Same fix as blinkit.js and mdComputers.js.
  const bodyText = await pollForStockMarker(page);

  if (looksBlocked(bodyText)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyText.slice(0, 2000), error: null, price: null };
  }

  if (NOT_FOUND_RE.test(bodyText)) {
    return {
      status: 'error',
      http_status: httpStatus,
      raw: bodyText.slice(0, 500),
      error: 'Zepto product page not found (soft 404) — the product was delisted from the catalog; the listing needs a new URL',
      price: null,
    };
  }

  // Zepto exposes the selling price via <meta itemprop="price"> (₹49,499 at the time of writing —
  // it discounts below MRP, so this is the number that matters for the notify cap).
  const { price } = await readProductData(page);

  // NOTE: Zepto's header UI still shows "Select Location" even when the location cookies
  // are successfully injected — the header is driven by a separate UI state, not by the
  // cookies that the backend uses for stock computation. The stock signal in the product
  // area (Notify Me / Add to Cart) IS driven by the injected lat/lon/serviceability, so
  // "Select Location" in the body is NOT a reliable guard and must not block us here.

  if (/notify me/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null, price };
  }

  if (/add to cart/i.test(bodyText)) {
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null, price };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: bodyText.slice(0, 500),
    error: 'Could not find a known stock marker ("Add to Cart" / "Notify Me") — page structure may have changed',
    price,
  };
}

module.exports = { check };
