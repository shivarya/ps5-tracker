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
  zepto: require('./checkers/zepto'),
};

const LOCAL_STORES = Object.keys(CHECKERS);

// Backup checkers for the 3 stores the server cron worker owns (reliance_digital, vijay_sales,
// sony_center). These are NOT polled unconditionally like LOCAL_STORES above — that would race the
// cron worker and reintroduce the dual-poller clobbering bug already hit once with Croma/Flipkart/etc
// (see stock_poll_worker.php's docblock). Instead, index.js only checks a backup-store listing when
// the server's last reported status for it is already `blocked`/`error` — this machine's residential
// IP doesn't carry the shared-hosting IP's reputation problem, so it can often "rescue" a listing the
// server-side curl checker is currently stuck on, without ever fighting over a healthy listing.
const BACKUP_CHECKERS = {
  reliance_digital: require('./checkers/relianceDigital'),
  vijay_sales: require('./checkers/vijaySales'),
  sony_center: require('./checkers/sonyCenter'),
};
const BACKUP_TRIGGER_STATUSES = ['blocked', 'error'];

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
  const allListings = data?.data || [];
  const listings = allListings.filter((l) => {
    if (!l.is_active) return false;
    if (LOCAL_STORES.includes(l.store)) return true;
    if (BACKUP_CHECKERS[l.store]) return BACKUP_TRIGGER_STATUSES.includes(l.last_status);
    return false;
  });

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
      const isBackup = !LOCAL_STORES.includes(listing.store);
      const checker = isBackup ? BACKUP_CHECKERS[listing.store] : CHECKERS[listing.store];
      if (isBackup) {
        console.log(`[local-crawler] listing ${listing.id} (${listing.store}): running backup check (server status was '${listing.last_status}')`);
      }
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
