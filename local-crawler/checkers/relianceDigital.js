/**
 * Local-crawler BACKUP for reliance_digital — see CLAUDE.md / ps5-deploy-api skill for why this
 * exists: the server-side PHP checker (server/utils/storeCheckers/RelianceDigitalChecker.php) hits
 * Fynd's raven-api from shared hosting, and intermittently gets `blocked` purely from the cPanel
 * IP's reputation. A request from this machine's residential IP shouldn't hit the same block, so
 * index.js only runs this checker when the server's last reported status was already `blocked` or
 * `error` — a fallback, not a replacement, to avoid the same dual-poller race condition that hit
 * STORE_CHECKERS earlier (see stock_poll_worker.php's docblock).
 *
 * Root-cause fix 2026-07-02: the previous approach used the Fynd `sizes/` endpoint with an
 * `x-location-detail` pincode header. That endpoint IGNORES the pincode and returns global stock
 * (confirmed: identical responses for 560067 Bangalore and 194101 Leh) — causing false in_stock
 * alarms. Fixed to use the real pincode-aware two-step approach:
 *
 *   Step 1: GET /ext/raven-api/catalog/v1.0/products/{slug} → extract item_code (article_id)
 *   Step 2: POST /ext/raven-api/inventory/multi/articles-v2
 *     Body: {articles:[{article_id, quantity:0}], phone_number:"0", pincode, request_page:"pdp"}
 *     → data.success===true: in stock and deliverable to pincode
 *     → data.success===false: OOS or not serviceable (both → out_of_stock)
 *
 * No x-fp-signature required — verified that both raven-api endpoints accept requests without
 * it (the signature the page's Fynd SDK sends is not enforced server-side).
 *
 * No browser needed — plain axios from a different IP. Ignores the Playwright `page` argument.
 */
const axios = require('axios');

const STOREFRONT_TOKEN = 'NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==';
const CATALOG_BASE = 'https://www.reliancedigital.in/ext/raven-api/catalog/v1.0/products/';
const INVENTORY_URL = 'https://www.reliancedigital.in/ext/raven-api/inventory/multi/articles-v2';
// PRICE ONLY. This is the Fynd application-API endpoint whose STOCK fields ignore the pincode —
// the exact trap the 2026-07-02 rewrite above got out of. It does carry price.effective, which
// neither raven-api call returns. Never read availability from it.
const SIZES_BASE = 'https://www.reliancedigital.in/api/service/application/catalog/v1.0/products/';

const AUTH_HEADERS = {
  Authorization: `Bearer ${STOREFRONT_TOKEN}`,
  Accept: 'application/json, text/plain, */*',
};

function extractSlug(url) {
  const path = new URL(url).pathname;
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

async function check(_page, url, pincode) {
  const slug = extractSlug(url);
  if (!slug) {
    return { status: 'error', http_status: null, raw: '', error: `Could not extract product slug from URL: ${url}` };
  }

  // Step 1: catalog call to get article_id (item_code)
  let catalogRes;
  try {
    catalogRes = await axios.get(CATALOG_BASE + slug, {
      headers: { ...AUTH_HEADERS, 'x-currency-code': 'INR' },
      validateStatus: () => true,
      timeout: 15000,
    });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: `Catalog fetch failed: ${err.message}` };
  }

  if (catalogRes.status !== 200) {
    return { status: 'error', http_status: catalogRes.status, raw: JSON.stringify(catalogRes.data).slice(0, 500), error: `Catalog HTTP ${catalogRes.status}` };
  }
  const articleId = catalogRes.data?.item_code;
  if (!articleId) {
    return { status: 'error', http_status: 200, raw: JSON.stringify(catalogRes.data).slice(0, 500), error: 'article_id (item_code) missing from catalog response — endpoint may have changed' };
  }

  // Step 2: pincode-aware inventory check
  let invRes;
  try {
    invRes = await axios.post(
      INVENTORY_URL,
      { articles: [{ article_id: articleId, quantity: 0 }], phone_number: '0', pincode, request_page: 'pdp' },
      { headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' }, validateStatus: () => true, timeout: 15000 }
    );
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: `Inventory fetch failed: ${err.message}` };
  }

  if (invRes.status !== 200) {
    return { status: 'error', http_status: invRes.status, raw: JSON.stringify(invRes.data).slice(0, 500), error: `Inventory HTTP ${invRes.status}` };
  }

  const data = invRes.data?.data;
  if (!data || typeof data.success === 'undefined') {
    return { status: 'error', http_status: 200, raw: JSON.stringify(invRes.data).slice(0, 500), error: 'Unexpected inventory response shape — endpoint may have changed' };
  }

  // data.success===true: item is in stock AND deliverable to the pincode.
  // data.success===false: either globally OOS or not serviceable to this pincode.
  const inStock = data.success === true;
  return {
    status: inStock ? 'in_stock' : 'out_of_stock',
    http_status: 200,
    raw: JSON.stringify(invRes.data).slice(0, 500),
    error: null,
    price: await fetchPrice(slug),
  };
}

/** Best-effort price from the sizes endpoint's price.effective. Null on any failure. */
async function fetchPrice(slug) {
  try {
    const res = await axios.get(`${SIZES_BASE}${encodeURIComponent(slug)}/sizes/`, {
      headers: { ...AUTH_HEADERS, 'x-currency-code': 'INR' },
      validateStatus: () => true,
      timeout: 15000,
    });
    if (res.status !== 200) return null;
    const effective = res.data?.price?.effective;
    const value = effective?.max ?? effective?.min ?? null;
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  } catch (_) {
    return null;
  }
}

module.exports = { check };
