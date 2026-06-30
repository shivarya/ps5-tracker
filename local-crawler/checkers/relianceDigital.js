/**
 * Local-crawler BACKUP for reliance_digital — see CLAUDE.md / ps5-deploy-api skill for why this
 * exists: the server-side PHP checker (server/utils/storeCheckers/RelianceDigitalChecker.php) hits
 * this same Fynd/GoFynd `sizes/` endpoint via curl from shared hosting, and intermittently gets
 * `blocked` purely from the cPanel IP's reputation (not bot-fingerprinting — it's a plain JSON API,
 * no JS challenge). A request from this machine's residential IP shouldn't hit the same block, so
 * index.js only runs this checker when the server's last reported status was already `blocked` or
 * `error` — a fallback, not a replacement, to avoid the same dual-poller race condition that hit
 * STORE_CHECKERS earlier (see stock_poll_worker.php's docblock).
 *
 * No browser needed — this mirrors the PHP checker's plain HTTP call exactly, just from a different
 * IP. Ignores the Playwright `page` argument (same pattern as instamartMcp.js).
 */
const axios = require('axios');

const STOREFRONT_TOKEN = 'NjQ1YTA1Nzg3NWQ4YzQ4ODJiMDk2ZjdlOl9fLU80NC00aQ==';

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

  const apiUrl = `https://www.reliancedigital.in/api/service/application/catalog/v1.0/products/${slug}/sizes/`;
  const locationHeader = JSON.stringify({
    country_iso_code: 'IN',
    country: 'INDIA',
    pincode,
    city: '',
    state: '',
  });

  let res;
  try {
    res = await axios.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${STOREFRONT_TOKEN}`,
        'x-location-detail': locationHeader,
        'x-currency-code': 'INR',
        Accept: 'application/json, text/plain, */*',
      },
      validateStatus: () => true,
      timeout: 15000,
    });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }

  if (res.status !== 200) {
    return { status: 'error', http_status: res.status, raw: JSON.stringify(res.data).slice(0, 2000), error: 'Unexpected HTTP status' };
  }

  const decoded = res.data;
  if (!decoded || typeof decoded.sellable === 'undefined') {
    return { status: 'error', http_status: 200, raw: JSON.stringify(decoded).slice(0, 500), error: 'Unexpected response shape — endpoint may have changed' };
  }

  const sizes = decoded.sizes || [];
  const anyAvailable = sizes.some((s) => s.is_available && Number(s.quantity || 0) > 0);
  const inStock = Boolean(decoded.sellable) && anyAvailable;

  return {
    status: inStock ? 'in_stock' : 'out_of_stock',
    http_status: 200,
    raw: JSON.stringify(decoded).slice(0, 500),
    error: null,
  };
}

module.exports = { check };
