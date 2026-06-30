const BLOCK_MARKERS = ['captcha', 'unusual traffic', 'access denied', 'are you a robot', 'request blocked'];

function looksBlocked(bodyText) {
  const lower = bodyText.toLowerCase();
  return BLOCK_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Generic HTML heuristic fallback: scans visible body text for stock markers.
 * Mirrors the PHP checkers' fallback (CromaChecker/GamesTheShopChecker) —
 * used until a site-specific selector is verified live.
 */
async function scanBodyForStockMarkers(page) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (looksBlocked(bodyText)) {
    return { status: 'blocked', raw: bodyText.slice(0, 2000), error: null };
  }
  const lower = bodyText.toLowerCase();
  if (lower.includes('sold out') || lower.includes('out of stock') || lower.includes('notify me')) {
    return { status: 'out_of_stock', raw: bodyText.slice(0, 500), error: null };
  }
  if (lower.includes('add to cart') || lower.includes('buy now')) {
    return { status: 'in_stock', raw: bodyText.slice(0, 500), error: null };
  }
  return {
    status: 'error',
    raw: bodyText.slice(0, 500),
    error: 'Could not find a known stock marker — page structure may have changed or needs a site-specific selector',
  };
}

module.exports = { looksBlocked, scanBodyForStockMarkers };
