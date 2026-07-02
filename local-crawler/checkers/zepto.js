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
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(2000);

  const bodyText = await page.locator('body').innerText().catch(() => '');

  if (looksBlocked(bodyText)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyText.slice(0, 2000), error: null };
  }

  // NOTE: Zepto's header UI still shows "Select Location" even when the location cookies
  // are successfully injected — the header is driven by a separate UI state, not by the
  // cookies that the backend uses for stock computation. The stock signal in the product
  // area (Notify Me / Add to Cart) IS driven by the injected lat/lon/serviceability, so
  // "Select Location" in the body is NOT a reliable guard and must not block us here.

  if (/notify me/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: bodyText.slice(0, 500), error: null };
  }

  if (/add to cart/i.test(bodyText)) {
    return { status: 'in_stock', http_status: httpStatus, raw: '', error: null };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: bodyText.slice(0, 500),
    error: 'Could not find a known stock marker ("Add to Cart" / "Notify Me") — page structure may have changed',
  };
}

module.exports = { check };
