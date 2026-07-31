/**
 * Local-crawler BACKUP for sony_center — same rationale as relianceDigital.js/vijaySales.js: a
 * fallback for when the server-side PHP checker (server/utils/storeCheckers/SonyCenterChecker.php)
 * reports `blocked`/`error`, run only then by index.js to avoid a second always-on poller racing
 * the cron worker.
 *
 * Mirrors SonyCenterChecker.php's approach: GET the Shopify `.json` endpoint for the variant id, then
 * POST `cart/add.js` to read the real stock signal (this theme strips `variants[].available`, so
 * cart/add.js's 200-vs-422 response is the only reliable signal — see that PHP file's docblock for
 * the full investigation). Unlike the PHP version's original bug, cookies here are captured from the
 * GET response and forwarded to the POST in-memory for this one check only — never written to disk,
 * so there's no possibility of the cross-poll accumulating-cart-quantity bug recurring locally.
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
// Shopify's `local_rate_limited` window outlasts a single short pause when the endpoint has been
// hit repeatedly, so back off twice before giving up (verified 2026-07-29: a 429 burst clears
// within ~20s and returns 200 again).
const RATE_LIMIT_BACKOFF_MS = [3000, 6000];

function extractCookies(setCookieHeaders) {
  if (!setCookieHeaders) return '';
  return setCookieHeaders.map((c) => c.split(';')[0]).join('; ');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(_page, url, _pincode) {
  const jsonUrl = url.replace(/\/$/, '').replace(/\.json$/, '') + '.json';

  // Shopify rate-limits this endpoint per IP and answers 429 `local_rate_limited` (reproduced
  // live 2026-07-29 — that's what the sony_center 429s in the crawler's run log were, not a block
  // or a dead URL). Retry with a short backoff instead of burning the whole run on it.
  let jsonRes;
  for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFF_MS.length; attempt++) {
    try {
      jsonRes = await axios.get(jsonUrl, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        validateStatus: () => true,
        timeout: 15000,
      });
    } catch (err) {
      return { status: 'error', http_status: null, raw: '', error: err.message };
    }
    if (jsonRes.status !== 429) break;
    if (attempt < RATE_LIMIT_BACKOFF_MS.length) await sleep(RATE_LIMIT_BACKOFF_MS[attempt]);
  }

  if (jsonRes.status === 404) {
    return { status: 'error', http_status: 404, raw: '', error: 'Product not found (404) — the handle was probably relisted under a new one' };
  }
  if (jsonRes.status !== 200) {
    return { status: 'error', http_status: jsonRes.status, raw: JSON.stringify(jsonRes.data).slice(0, 2000), error: `Unexpected HTTP status fetching product JSON (${jsonRes.status})` };
  }

  const variants = jsonRes.data?.product?.variants;
  if (!Array.isArray(variants) || variants.length === 0) {
    return { status: 'error', http_status: 200, raw: JSON.stringify(jsonRes.data).slice(0, 500), error: 'No variants found — endpoint may have changed' };
  }
  const variantId = variants[0].id;
  if (variantId === undefined) {
    return { status: 'error', http_status: 200, raw: '', error: 'Could not find a variant id' };
  }
  // Shopify ships the price on the same variant as a decimal string ("69990.00").
  const price = Number.isFinite(Number(variants[0].price)) && Number(variants[0].price) > 0 ? Number(variants[0].price) : null;

  const cookieHeader = extractCookies(jsonRes.headers['set-cookie']);

  let cartRes;
  try {
    cartRes = await axios.post(
      'https://shopatsc.com/cart/add.js',
      { items: [{ id: variantId, quantity: 1 }] },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }

  if (cartRes.status === 200) {
    return { status: 'in_stock', http_status: 200, raw: JSON.stringify(cartRes.data).slice(0, 500), error: null, price };
  }
  const bodyText = JSON.stringify(cartRes.data);
  if (cartRes.status === 422 && /sold out/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: 422, raw: bodyText.slice(0, 500), error: null, price };
  }

  return { status: 'error', http_status: cartRes.status, raw: bodyText.slice(0, 500), error: 'Unexpected cart/add.js response — endpoint may have changed', price };
}

module.exports = { check };
