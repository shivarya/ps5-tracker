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
 */
const { scanBodyForStockMarkers, looksBlocked } = require('../utils/pageHelpers');

const PINCODE_CONFIRM_TIMEOUT_MS = 2500;
const PINCODE_CONFIRM_POLL_MS = 150;

async function check(page, url, pincode) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { status: 'error', http_status: null, raw: '', error: err.message };
  }
  const httpStatus = response ? response.status() : null;
  await page.waitForTimeout(1000);

  const bodyTextEarly = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyTextEarly)) {
    return { status: 'blocked', http_status: httpStatus, raw: bodyTextEarly.slice(0, 2000), error: null };
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
    };
  }

  const lower = confirmedText.toLowerCase();
  if (looksBlocked(confirmedText)) {
    return { status: 'blocked', http_status: httpStatus, raw: confirmedText.slice(0, 2000), error: null };
  }
  if (lower.includes('sold out') || lower.includes('out of stock') || lower.includes('notify me')) {
    return { status: 'out_of_stock', http_status: httpStatus, raw: confirmedText.slice(0, 500), error: null };
  }
  if (lower.includes('add to cart') || lower.includes('buy now')) {
    return { status: 'in_stock', http_status: httpStatus, raw: confirmedText.slice(0, 500), error: null };
  }

  return {
    status: 'error',
    http_status: httpStatus,
    raw: confirmedText.slice(0, 500),
    error: 'Could not find a known stock marker — page structure may have changed or needs a site-specific selector',
  };
}

module.exports = { check };
