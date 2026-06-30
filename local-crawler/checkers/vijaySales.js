/**
 * Local-crawler BACKUP for vijay_sales — same rationale as relianceDigital.js: the server-side PHP
 * checker hits this same servicability microservice via curl from shared hosting and can intermittently
 * report `blocked` from that IP. index.js only runs this checker when the server's last reported
 * status was already `blocked`/`error`, as a fallback rather than a second always-on poller (avoids
 * re-creating the dual-poller race condition documented in stock_poll_worker.php's docblock).
 *
 * No browser needed — mirrors VijaySalesChecker.php's plain HTTP call. Ignores the Playwright `page`.
 */
const axios = require('axios');

function extractSku(url) {
  const m = url.match(/\/p\/(\d+)\//);
  return m ? m[1] : null;
}

async function check(_page, url, pincode) {
  const sku = extractSku(url);
  if (!sku) {
    return { status: 'error', http_status: null, raw: '', error: `Could not extract SKU from URL: ${url}` };
  }

  const apiUrl = `https://oms.vijaysales.systems/v1/servicability?pincode=${pincode}&vanNo=${sku}&storeList=true`;

  let res;
  try {
    res = await axios.get(apiUrl, {
      headers: {
        Origin: 'https://www.vijaysales.com',
        Accept: '*/*',
        Referer: 'https://www.vijaysales.com/',
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

  const entry = res.data?.data?.[sku];
  if (!entry || typeof entry !== 'object') {
    return { status: 'error', http_status: 200, raw: JSON.stringify(res.data).slice(0, 500), error: 'Unexpected response shape — endpoint may have changed' };
  }

  const inStock = Boolean(entry.isServiceable) && Number(entry.maxQuantity || 0) > 0;

  return {
    status: inStock ? 'in_stock' : 'out_of_stock',
    http_status: 200,
    raw: JSON.stringify(res.data).slice(0, 500),
    error: null,
  };
}

module.exports = { check };
