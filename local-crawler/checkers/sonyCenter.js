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

function extractCookies(setCookieHeaders) {
  if (!setCookieHeaders) return '';
  return setCookieHeaders.map((c) => c.split(';')[0]).join('; ');
}

async function check(_page, url, _pincode) {
  const jsonUrl = url.replace(/\/$/, '').replace(/\.json$/, '') + '.json';

  let jsonRes;
  try {
    jsonRes = await axios.get(jsonUrl, {
      headers: { Accept: 'application/json' },
      validateStatus: () => true,
      timeout: 15000,
    });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }

  if (jsonRes.status !== 200) {
    return { status: 'error', http_status: jsonRes.status, raw: JSON.stringify(jsonRes.data).slice(0, 2000), error: 'Unexpected HTTP status fetching product JSON' };
  }

  const variants = jsonRes.data?.product?.variants;
  if (!Array.isArray(variants) || variants.length === 0) {
    return { status: 'error', http_status: 200, raw: JSON.stringify(jsonRes.data).slice(0, 500), error: 'No variants found — endpoint may have changed' };
  }
  const variantId = variants[0].id;
  if (variantId === undefined) {
    return { status: 'error', http_status: 200, raw: '', error: 'Could not find a variant id' };
  }

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
    return { status: 'in_stock', http_status: 200, raw: JSON.stringify(cartRes.data).slice(0, 500), error: null };
  }
  const bodyText = JSON.stringify(cartRes.data);
  if (cartRes.status === 422 && /sold out/i.test(bodyText)) {
    return { status: 'out_of_stock', http_status: 422, raw: bodyText.slice(0, 500), error: null };
  }

  return { status: 'error', http_status: cartRes.status, raw: bodyText.slice(0, 500), error: 'Unexpected cart/add.js response — endpoint may have changed' };
}

module.exports = { check };
