/**
 * Verified live via chrome-devtools MCP on 2026-06-30 against a real PS5 listing. Unlike Flipkart,
 * Croma uses real semantic CSS classes (not content-hashed), and — importantly — a real headed browser
 * is NOT Akamai-blocked here at all (unlike the bare curl request server/utils/storeCheckers/CromaChecker.php's
 * docblock documents as a 403 at the edge). Croma auto-detects/defaults a pincode via geo-IP on load; we
 * always override it explicitly via the pincode-editor modal rather than trusting the default.
 *
 * Flow: click `.header-pincode-edit.pincode-s-edit.pincode-pencil-icon` (pencil icon next to the
 * pincode shown in the header) → opens a "SELECT YOUR LOCATION" modal with `input.pinElem`
 * (placeholder="Enter Pincode", pre-filled with the current/default pincode — clear it first) → click
 * the "Continue" text button → page reloads delivery info for that pincode in place.
 * Stock signal: "Sold Out"/"Out of Stock"/"Notify Me" text = out_of_stock, "Add to Cart"/"Buy Now" = in_stock.
 *
 * BUG FOUND AND FIXED 2026-07-01: on a genuinely fresh browser session (no cached location — i.e.
 * every real scheduled-task run, since the crawler launches a new context each time), Croma instead
 * auto-shows the same "SELECT YOUR LOCATION" modal immediately on page load, with NO pencil icon to
 * click (none exists yet — no location is set). The pencil-icon click was timing out, the catch block
 * swallowed it, and the checker fell through to reading stock text from BEHIND the still-open modal —
 * `innerText()` includes the underlying page's "Add to Cart" text regardless of the modal covering it
 * visually, and regardless of which pincode (if any) Croma had defaulted to. This reported `in_stock`
 * for whatever Croma's own fallback/geo-IP-guessed pincode resolved to, never the tracked one. Fixed by
 * checking whether `input.pinElem` is already visible (auto-modal case) before attempting the
 * pencil-icon click at all.
 *
 * SECOND BUG FOUND AND FIXED 2026-06-30: confirming the explicit pincode set via the modal is NOT
 * durable — Croma's own client-side JS silently reverts the header/delivery widget to an
 * IP-geolocation-derived default (e.g. "Mumbai, 400049" from this machine's residential IP, nowhere
 * near the tracked 560067) somewhere between ~1.5s and ~3s after the "Continue" click — confirmed via
 * repeated live captures (`Bash` debug script, not just chrome-devtools snapshots), and the timing
 * is non-deterministic (varied between 2s and 3s across runs). The old code did a single blind
 * `waitForTimeout(1500)` then scanned once — a coin flip on which side of that race it landed,
 * meaning it could silently report stock for Mumbai's availability instead of the tracked pincode's,
 * with no signal that anything had gone wrong. Fixed by polling for the tracked pincode's digits to
 * actually appear in the page text (confirming the set took effect) and reading the stock markers
 * from that SAME text snapshot — no separate delay/re-fetch between "pincode confirmed" and "scan
 * stock" that could itself cross the revert boundary. If the pincode is never confirmed showing
 * within the poll window, returns `error` (not a guess) rather than trusting whatever's on screen.
 *
 * THIRD BUG FOUND AND FIXED 2026-06-30 (the previous two fixes were real but didn't catch this —
 * user reported "croma still shows in stock" a second time and it was worth re-investigating rather
 * than assuming it was already fixed): "Buy Now"/"Add to Cart" text is present on the page
 * REGARDLESS of pincode deliverability — confirmed live that even with the pincode correctly
 * confirmed as the tracked 560067, the page *simultaneously* shows "Delivery at: Bengaluru, 560067.
 * Not Available for your pincode" while "Buy Now"/"Add to Cart" text is still present elsewhere
 * (almost certainly an in-store-pickup/global-sellability signal, unrelated to home delivery to the
 * tracked pincode). This means the generic Buy-Now/Add-to-Cart heuristic was NEVER a reliable
 * pincode-aware stock signal for this store — it would report `in_stock` even when Croma explicitly
 * tells a real user the item can't be delivered to them. Fixed by checking the "Delivery at: ..."
 * section specifically: "Not Available for your pincode" there now means `out_of_stock`, its absence
 * (with the delivery section present and confirmed against the tracked pincode) means `in_stock`. The
 * generic Buy-Now/Sold-Out scan is kept only as a fallback for when the delivery section can't be
 * found at all (defensive — not the primary signal anymore).
 */
const { looksBlocked } = require('../utils/pageHelpers');
const { firstRupeeAmount } = require('../utils/structuredData');

const PINCODE_CONFIRM_TIMEOUT_MS = 2500;
const PINCODE_CONFIRM_POLL_MS = 150;
const PRICE_POLL_TIMEOUT_MS = 2500;

/** Waits for the MRP to render (it lags the pincode confirmation). Null if it never shows. */
async function pollForPrice(page) {
  const deadline = Date.now() + PRICE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText().catch(() => '');
    const price = firstRupeeAmount(text);
    if (price !== null) return price;
    await page.waitForTimeout(200);
  }
  return null;
}

async function check(page, url, pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message, price: null };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(1000);

  const bodyTextEarly = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyTextEarly)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyTextEarly.slice(0, 2000), error: null, price: null };
  }

  try {
    const pincodeInput = page.locator('input.pinElem');
    const modalAlreadyOpen = await pincodeInput.isVisible().catch(() => false);
    if (!modalAlreadyOpen) {
      await page.locator('.header-pincode-edit.pincode-s-edit.pincode-pencil-icon').first().click({ timeout: 5000 });
      await pincodeInput.waitFor({ state: 'visible', timeout: 5000 });
    }
    await pincodeInput.fill('');
    await pincodeInput.fill(pincode);
    await page.getByText('Continue', { exact: true }).click({ timeout: 5000 });
  } catch (err) {
    // pincode widget not found/interactable (layout changed) — fall through to the confirmation
    // poll below, which will correctly report `error` since the pincode never gets confirmed.
  }

  // Poll for the pincode to actually be showing, then scan stock markers from that SAME text read —
  // no gap between "confirmed set" and "read stock" for Croma's own revert race to land in.
  const deadline = Date.now() + PINCODE_CONFIRM_TIMEOUT_MS;
  let confirmedText = null;
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText().catch(() => '');
    if (text.includes(pincode)) {
      confirmedText = text;
      break;
    }
    await page.waitForTimeout(PINCODE_CONFIRM_POLL_MS);
  }

  if (!confirmedText) {
    return {
      status: 'error',
      http_status: httpStatus,
      raw: '',
      error: `Pincode ${pincode} never confirmed showing on page — Croma's location widget likely reverted to an IP-geolocation default before the stock check could run`,
      price: null,
    };
  }

  const lower = confirmedText.toLowerCase();
  if (looksBlocked(confirmedText)) {
    return { status: 'blocked', http_status: httpStatus, raw: confirmedText.slice(0, 2000), error: null, price: null };
  }

  // Croma's ld+json carries no price (verified 2026-07-29 — the block is empty), so it has to come
  // from page text. It must NOT be read from `confirmedText`: the pincode is confirmed ~150-300ms
  // after the Continue click, and at that instant the MRP line hasn't rendered — only the EMI
  // figure ("₹2,589/mo*") has, which the plausible-price floor correctly rejects, yielding null
  // every time (observed live 2026-07-29). Unlike the stock verdict, price is not part of the
  // pincode-revert race — the MRP doesn't change when Croma silently switches back to its
  // geo-IP city — so it's safe to poll for it separately after the verdict snapshot is taken.
  const price = await pollForPrice(page);

  // Primary signal: the pincode-specific "Delivery at: ..." section — Buy Now/Add to Cart text is
  // present regardless of deliverability, so it's checked only as a fallback below.
  const deliveryIdx = lower.indexOf('delivery at');
  if (deliveryIdx >= 0) {
    const deliverySection = lower.slice(deliveryIdx, deliveryIdx + 200);
    if (deliverySection.includes(pincode)) {
      const status = deliverySection.includes('not available for your pincode') ? 'out_of_stock' : 'in_stock';
      return { status, http_status: httpStatus, raw: confirmedText.slice(deliveryIdx, deliveryIdx + 200), error: null, price };
    }
  }

  if (lower.includes('sold out') || lower.includes('out of stock') || lower.includes('notify me')) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: confirmedText.slice(0, 500), error: null, price };
  }
  if (lower.includes('add to cart') || lower.includes('buy now')) {
    return { status: 'in_stock', http_status: httpStatus, raw: confirmedText.slice(0, 500), error: null, price };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: confirmedText.slice(0, 500),
    error: 'Could not find a known stock marker — page structure may have changed or needs a site-specific selector',
    price,
  };
}

module.exports = { check };
