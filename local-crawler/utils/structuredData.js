/**
 * Reads schema.org Product data (JSON-LD `<script type="application/ld+json">` plus the
 * OpenGraph/microdata price meta tags) out of whatever page the Playwright `page` is on.
 *
 * Why this exists: every retailer here renders its buy box with client-side JS, so a
 * `body.innerText` scan is a race against hydration — the exact failure that made
 * mdComputers.js report false in_stock roughly once every eight runs (see its docblock).
 * The structured-data block is emitted in the server HTML and is stable from first paint,
 * which makes it both a better price source and, for stores where global stock == deliverable,
 * a better stock signal.
 *
 * IMPORTANT: `availability` here is the store's GLOBAL stock state — it is never
 * pincode-aware. Only use it as a *stock* signal for stores where global stock implies
 * deliverability (MD Computers ships pan-India from one warehouse). Everywhere else it's a
 * PRICE source only; the pincode-specific logic in each checker stays the stock authority.
 */

// PreOrder/BackOrder deliberately count as out_of_stock: they're orderable but not shippable now,
// and the whole point of the price/stock gate is that an alert should mean "buy it today".
const IN_STOCK_AVAILABILITY = /InStock|LimitedAvailability|OnlineOnly|InStoreOnly/i;
const OUT_OF_STOCK_AVAILABILITY = /OutOfStock|SoldOut|Discontinued|PreOrder|PreSale|BackOrder/i;

/**
 * @returns {Promise<{price: number|null, availability: string|null, name: string|null}>}
 */
async function readProductData(page) {
  const raw = await page
    .evaluate(() => {
      const offers = [];

      const collect = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (node.offers || node['@type'] === 'Offer' || node['@type'] === 'AggregateOffer') {
          const offerNodes = [].concat(node.offers || node);
          for (const o of offerNodes) {
            if (o && typeof o === 'object') {
              offers.push({
                price: o.price ?? o.lowPrice ?? null,
                availability: o.availability ?? null,
                name: node.name ?? null,
              });
            }
          }
        }
        Object.values(node).forEach(collect);
      };

      for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          collect(JSON.parse(el.textContent));
        } catch (_) {
          // A malformed LD block on one retailer must not break the read for the rest.
        }
      }

      const metaOf = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.getAttribute('content') : null;
      };

      return {
        offers,
        metaPrice:
          metaOf('meta[property="product:price:amount"]') ||
          metaOf('meta[property="og:price:amount"]') ||
          metaOf('meta[itemprop="price"]'),
        metaAvailability:
          metaOf('meta[property="product:availability"]') ||
          metaOf('meta[property="og:availability"]') ||
          metaOf('meta[itemprop="availability"]'),
      };
    })
    .catch(() => null);

  if (!raw) {
    return { price: null, availability: null, name: null };
  }

  const priced = raw.offers.find((o) => parsePrice(o.price) !== null);
  const withAvailability = raw.offers.find((o) => o.availability);

  return {
    price: parsePrice(priced ? priced.price : raw.metaPrice),
    availability: (withAvailability && withAvailability.availability) || raw.metaAvailability || null,
    name: (priced && priced.name) || (withAvailability && withAvailability.name) || null,
  };
}

/** "54,990.00" / "₹54990" / 54990 -> 54990. Anything unparseable or <= 0 -> null. */
function parsePrice(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const num = Number.parseFloat(digits);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Maps a schema.org availability URL to our status vocabulary.
 * @returns {'in_stock'|'out_of_stock'|null} null when it's absent or unrecognized.
 */
function availabilityToStatus(availability) {
  if (!availability) return null;
  // Negative case first — an ambiguous value should fall to the conservative side, never alert.
  if (OUT_OF_STOCK_AVAILABILITY.test(availability)) return 'out_of_stock';
  if (IN_STOCK_AVAILABILITY.test(availability)) return 'in_stock';
  return null;
}

/**
 * Fallback price read for stores with no usable structured data (Croma and Games The Shop both
 * emit an empty/priceless ld+json block — verified 2026-07-29). Takes the first rupee amount in
 * the given text that's plausibly a console price, so EMI/monthly figures ("₹2,589/mo") and
 * accessory prices in "similar products" strips don't win.
 *
 * @param {string} text        Page or product-section text.
 * @param {number} [min=15000] Floor for a plausible console price.
 * @param {number} [max=400000] Ceiling, to skip bundle/comparison totals.
 */
function firstRupeeAmount(text, min = 15000, max = 400000) {
  if (!text) return null;
  const re = /(?:₹|Rs\.?\s?|INR\s?)\s?([0-9][0-9,]{2,12}(?:\.[0-9]{1,2})?)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const value = parsePrice(match[1]);
    if (value !== null && value >= min && value <= max) return value;
  }
  return null;
}

module.exports = { readProductData, availabilityToStatus, parsePrice, firstRupeeAmount };
