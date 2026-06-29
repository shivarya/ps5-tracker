/**
 * Instamart via Swiggy's official Builders MCP platform (https://mcp.swiggy.com/builders/) instead of
 * browser automation — swiggy.com/instamart genuinely blocks even a real headed Playwright browser
 * (see the old browser-based attempt preserved in checkers/instamart.js's docblock), but this is a
 * sanctioned API requiring real account login (see utils/swiggyAuth.js).
 *
 * Unlike every other checker, this one ignores the Playwright `page` argument entirely — there's no
 * browser involved, just an MCP client call. `url` is also not fetched directly: Swiggy MCP has no
 * "look up this exact product page" tool, only `search_products({ addressId, query })`. Matching the
 * tracked listing to a search result is done by `product_name` (best-effort substring match) — set a
 * descriptive product_name when adding an Instamart listing via add_listing.php / the dashboard form,
 * or this will just report whatever the top search result is.
 *
 * VERIFIED live on 2026-06-30 against a real authenticated session (real OAuth login completed
 * interactively, real `search_products` call for query "PS5"). Confirmed response shape:
 * `result.structuredContent.products[]`, each `{ displayName, brand, inStock: boolean, isAvail,
 * variations: [{ spinId, quantityDescription, price: {mrp, offerPrice}, isInStockAndAvailable: boolean,
 * ... }], productId, parentProductId, isPromoted }`. `get_addresses` returns
 * `result.structuredContent.addresses[]`, each `{ id, addressLine, phoneNumber, addressCategory,
 * addressTag }` — note there's no separate `postalCode` field; the pincode is embedded in the
 * `addressLine` string, hence the substring match in `getOrCreateAddressId`. `create_address`'s
 * response shape is NOT yet confirmed live (the test account already had a saved address for the
 * pincode used during verification, so that code path never ran) — see the comment at its call site.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { getValidAccessToken, BASE_URL } = require('../utils/swiggyAuth');

const ADDRESS_CACHE_FILE = path.join(__dirname, '..', '.swiggy_addresses.json');

function loadAddressCache() {
  try {
    return JSON.parse(fs.readFileSync(ADDRESS_CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAddressCache(cache) {
  fs.writeFileSync(ADDRESS_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function geocodePincode(pincode) {
  const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { postalcode: pincode, country: 'India', format: 'json', limit: 1 },
    headers: { 'User-Agent': 'ps5-tracker-local-crawler/1.0' },
  });
  if (!data || data.length === 0) {
    throw new Error(`Could not geocode pincode ${pincode} via Nominatim`);
  }
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name };
}

async function getOrCreateAddressId(client, pincode) {
  const cache = loadAddressCache();
  if (cache[pincode]) {
    return cache[pincode];
  }

  const existing = await client.callTool({ name: 'get_addresses', arguments: {} });
  const addresses = existing?.structuredContent?.addresses || [];
  const match = addresses.find((a) => (a.addressLine || '').includes(String(pincode)));
  if (match) {
    cache[pincode] = match.id;
    saveAddressCache(cache);
    return cache[pincode];
  }

  const geo = await geocodePincode(pincode);
  const created = await client.callTool({
    name: 'create_address',
    arguments: {
      fullAddress: geo.display,
      addressLine: geo.display.split(',')[0] || geo.display,
      addressLine2: '',
      city: process.env.SWIGGY_CITY || 'Bengaluru',
      postalCode: pincode,
      latitude: geo.lat,
      longitude: geo.lon,
      addressCategory: 'OTHER',
      userName: process.env.SWIGGY_NAME || 'PS5 Tracker',
      userPhone: process.env.SWIGGY_PHONE || '',
    },
  });
  // Response shape unconfirmed live (the account used during verification already had a saved address
  // for the tracked pincode, so this path never ran) — guessing at the same {id, addressLine, ...}
  // shape confirmed for get_addresses, under a few plausible keys. Check `error.message` in the
  // crawler's run log if this throws on a real run, and fix based on the actual shape it reports.
  const createdAddress = created?.structuredContent?.address || created?.structuredContent?.addresses?.[0] || created?.structuredContent;
  const addressId = createdAddress?.id || createdAddress?.addressId;
  if (!addressId) {
    throw new Error(`create_address did not return a recognizable addressId: ${JSON.stringify(created).slice(0, 500)}`);
  }
  cache[pincode] = addressId;
  saveAddressCache(cache);
  return addressId;
}

async function check(_page, url, pincode, productName) {
  let accessToken;
  try {
    accessToken = getValidAccessToken();
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }

  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/im`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: 'ps5-tracker-local-crawler', version: '1.0.0' });

  try {
    await client.connect(transport);

    const addressId = await getOrCreateAddressId(client, pincode);
    const query = productName || 'PS5';
    const result = await client.callTool({ name: 'search_products', arguments: { addressId, query } });
    const products = result?.structuredContent?.products || [];

    if (products.length === 0) {
      return { status: 'error', http_status: 200, raw: JSON.stringify(result).slice(0, 1500), error: `search_products found no results for "${query}"` };
    }

    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = products.find((p) => {
      const name = (p.displayName || '').toLowerCase();
      return queryTokens.every((t) => name.includes(t));
    }) || products[0];

    const available = matched.inStock === true || (matched.variations || []).some((v) => v.isInStockAndAvailable === true);

    return {
      status: available ? 'in_stock' : 'out_of_stock',
      http_status: 200,
      raw: JSON.stringify(matched).slice(0, 1000),
      error: null,
    };
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { check };
