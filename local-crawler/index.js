require('dotenv').config();
const { chromium } = require('playwright');
const axios = require('axios');
const { notifyStockIn } = require('./utils/notify');
const { appendRun } = require('./utils/runLog');

const API_URL = (process.env.API_URL || 'http://localhost:8000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY || '';
const DEFAULT_PINCODE = process.env.DEFAULT_PINCODE || '560067';
const HEADLESS = process.env.HEADLESS === 'true';

const CHECKERS = {
  croma: require('./checkers/croma'),
  flipkart: require('./checkers/flipkart'),
  games_the_shop: require('./checkers/gamesTheShop'),
  amazon: require('./checkers/amazon'),
  blinkit: require('./checkers/blinkit'),
  instamart: require('./checkers/instamartMcp'), // official Swiggy MCP API, not browser automation — see its docblock
};

const LOCAL_STORES = Object.keys(CHECKERS);

function jitter() {
  const ms = 500 + Math.floor(Math.random() * 3500);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const api = axios.create({
  baseURL: API_URL,
  headers: API_KEY ? { 'X-Api-Key': API_KEY } : {},
  timeout: 15000,
});

async function main() {
  const startedAt = new Date().toISOString();
  const { data } = await api.get('/status');
  const listings = (data?.data || []).filter(
    (l) => l.is_active && LOCAL_STORES.includes(l.store)
  );

  if (listings.length === 0) {
    console.log('[local-crawler] no local-store listings to check');
    appendRun({ startedAt, finishedAt: new Date().toISOString(), checked: [], transitions: [], error: null });
    return;
  }

  console.log(`[local-crawler] checking ${listings.length} listing(s)`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const results = [];
  const checked = [];

  try {
    for (const listing of listings) {
      const page = await context.newPage();
      const checker = CHECKERS[listing.store];
      let result;
      try {
        result = await checker.check(page, listing.url, listing.pincode || DEFAULT_PINCODE, listing.product_name);
      } catch (err) {
        result = { status: 'error', http_status: null, raw: '', error: err.message };
      } finally {
        await page.close();
      }

      console.log(`[local-crawler] listing ${listing.id} (${listing.store}): ${result.status}`);
      results.push({ listing_id: listing.id, ...result });
      checked.push({
        listing_id: listing.id,
        store: listing.store,
        product_name: listing.product_name,
        url: listing.url,
        status: result.status,
        http_status: result.http_status,
        error: result.error,
      });
      await jitter();
    }
  } finally {
    await browser.close();
  }

  const { data: reportData } = await api.post('/stock/report', { results });
  const transitions = reportData?.data?.transitions || [];

  for (const t of transitions) {
    console.log(`[local-crawler] transition: listing ${t.listing_id} (${t.store}) -> in_stock`);
    notifyStockIn({
      productName: t.product_name,
      store: t.store,
      pincode: t.pincode,
      url: t.url,
    });
  }

  console.log(`[local-crawler] reported ${results.length} result(s), ${transitions.length} transition(s)`);

  appendRun({ startedAt, finishedAt: new Date().toISOString(), checked, transitions, error: null });
}

main().catch((err) => {
  console.error('[local-crawler] fatal error:', err);
  appendRun({
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    checked: [],
    transitions: [],
    error: err.message || err.code || String(err),
  });
  process.exit(1);
});
