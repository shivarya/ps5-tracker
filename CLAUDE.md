# CLAUDE.md — PS5 Tracker

Guidance for Claude Code when working inside `ps5-tracker/`. Launch Claude from this directory so the project's configuration loads automatically.

## Terminal Command Rules

**CRITICAL**: Always combine directory change and command in a single line, and use absolute Windows paths.

```powershell
# ✅ Correct
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\server" ; php -S localhost:8000
```

---

## What this app does

A personal, single-user 24/7 stock monitor: polls PS5 listings across several Indian retailers for deliverability to a specific pincode, and pushes an instant phone notification the moment one goes from out-of-stock to in-stock. No login/multi-user system — it's a personal tool, gated by a single shared `API_KEY` header on write endpoints.

**Live**: `https://shivarya.dev/ps5_tracker/` (cPanel). **Status**: Phase 1 complete — deployed, server polling every 30 min (lowered from 5 min), 3 listings tracked server-side. Phase 2: a local Playwright crawler (`local-crawler/`) runs on the user's Windows machine, covering retailers Akamai/PerimeterX-blocks on shared hosting (Croma, Flipkart, Games The Shop, Amazon) plus quick-commerce platforms (Blinkit, Instamart) that were never server-side checkers at all. It reports results to the same backend via `POST /stock/report`, so both push notifications (Expo) and a local Windows toast fire from one shared transition-detection path (`server/utils/stockResultProcessor.php`). A Windows Scheduled Task (`PS5TrackerLocalCrawler`) is registered on this machine — fires once at every logon, then every 30 min indefinitely. A second task (`PS5TrackerDevServer`) auto-starts `php -S 0.0.0.0:8000` at logon so the crawler (and an Android emulator via `10.0.2.2`) has a local API to report to (MySQL itself runs as an always-on Windows service, already `Automatic` startup; bound to `0.0.0.0` rather than `localhost` specifically so the emulator's host-loopback alias can reach it — `localhost`-only binding was a real bug that silently broke the mobile app's `/status` calls from an emulator). A third task (`PS5TrackerDashboard`) auto-starts the dashboard (`local-crawler/dashboard.js`, `http://localhost:5055`) at logon — shows current status for all tracked listings (any store, not just local-crawler ones) plus the crawler's run history, and has a form to add new tracked listings without a terminal. **Currently configured against the local dev API** (`local-crawler/.env`'s `API_URL=http://localhost:8000`) — switch it to the production URL/key once ready to track real listings unattended.

## Claude Code skills (`.claude/skills/`, load when launched inside `ps5-tracker/`)

- `ps5-dev` — run the PHP API + Expo app locally, run the poller once manually.
- `ps5-deploy-api` — deploy/update the PHP backend on cPanel; documents the deploy-path symlink and inode-quota gotchas hit during the first deploy.
- `ps5-add-listing` — register a new tracked product URL with the correct per-store format; lists which stores are actually verified working.
- `ps5-local-crawler` — install/run/schedule the Windows Playwright crawler for the blocked retailers (`local-crawler/`).

**Server-side retailers**, with real difficulty verified live via Chrome DevTools + curl on 2026-06-28 (corrects the original plan's assumptions — see per-checker docblocks for full capture details):

| Store | Checker | Status |
|---|---|---|
| Reliance Digital | `RelianceDigitalChecker.php` | **Working, pincode-aware.** Fynd storefront JSON endpoint (`.../sizes/`), no auth/signature needed, `x-location-detail` carries the pincode. |
| Vijay Sales | `VijaySalesChecker.php` | **Working, pincode-aware.** Dedicated `oms.vijaysales.systems/v1/servicability?pincode=&vanNo=` microservice, no auth needed. |
| Sony Center | `SonyCenterChecker.php` | **Working, stock-only (no pincode check exists for this store).** Shopify storefront, but this theme strips `variants[].available` from `products.json` — real signal is `POST /cart/add.js`, which returns 422 "already sold out" when OOS. |
| Croma | `CromaChecker.php` | **Verified NOT scrapable from shared hosting.** Akamai Bot Manager blocks even the plain HTML page at the edge (403, before reaching origin) for a bare curl request — same difficulty tier as Amazon. PHP checker still returns `blocked` gracefully; real attempt now lives in the local crawler instead (residential IP + real browser). |
| Games The Shop | `GamesTheShopChecker.php` | **Unverified, HTML-heuristic fallback only.** Turned out to be a custom Next.js storefront, not Shopify as assumed — no stock API captured yet. Also covered by the local crawler. |
| Flipkart, Amazon | `FlipkartChecker.php`, `AmazonChecker.php` | Server-side stubs, intentionally always return `error` — real anti-bot infrastructure not attempted here. Covered by the local crawler instead (Flipkart now verified there, see below). |

**Local-crawler-only retailers** (`local-crawler/checkers/`, no PHP equivalent): Blinkit, Instamart — quick-commerce, no server-side checker exists since stock is purely location/app-driven. See the `ps5-local-crawler` skill for setup. Per-store implementation status, verified live via chrome-devtools MCP starting 2026-06-30:

| Store | Checker | Status |
|---|---|---|
| Flipkart | `local-crawler/checkers/flipkart.js` | **Verified working** against two real PS5 listings (one in-stock, one out-of-stock) via real Playwright runs, not just manual driving. Flow: click "Select delivery location" text → fill `input[placeholder="Search by area, street name, pin code"]` → click `getByText(pincode, {exact:true}).first()` (every suggestion row contains the literal pincode as its own text node, so this works regardless of which city it resolves to) → click "Confirm" text. Stock signal: "Notify Me" text = `out_of_stock`, "Buy now"/"Add to cart" text = `in_stock`. Flipkart's CSS classes are content-hashed (`css-xxxxx`, not stable across deploys) — every selector here is deliberately text/placeholder-based instead. |
| Croma | `local-crawler/checkers/croma.js` | **Verified working.** A real headed browser is NOT Akamai-blocked here at all (contrary to the curl-level 403 documented in `CromaChecker.php`) — Croma uses real semantic class names (`.header-pincode-edit.pincode-s-edit.pincode-pencil-icon`, `input.pinElem`), no hashing. Flow: click the pencil icon → fill the pincode input (clear first, it's pre-filled with a geo-IP default) → click "Continue". Stock signal: generic "Sold Out"/"Add to Cart" scan. **Real bug found and fixed 2026-07-01**: on a genuinely fresh session (i.e. every real scheduled run), Croma instead auto-shows the same modal with no pencil icon to click yet — the click timed out, fell through silently, and read stock state from behind the still-open modal, against whatever pincode Croma had defaulted to rather than the tracked one. Fixed by checking whether `input.pinElem` is already visible before attempting the pencil-icon click. **Second real bug found and fixed 2026-06-30** (user asked "why croma showing in stock?" — investigated rather than assumed): the explicit pincode set via the modal isn't durable — Croma's own client JS silently reverts the header/delivery widget to an IP-geolocation default (e.g. this machine's residential IP → "Mumbai, 400049", nowhere near the tracked 560067) somewhere between ~1.5s and ~3s after "Continue" (non-deterministic, confirmed via repeated live captures). The old fixed `waitForTimeout(1500)` was a coin flip on which side of that race it landed — could silently report stock for the wrong city with no signal anything was off. Fixed by polling for the tracked pincode's digits to actually appear in page text, then scanning stock markers from that *same* text snapshot (no gap for the revert to land in); returns `error` if the pincode is never confirmed within ~2.5s rather than trusting whatever's on screen. Re-verified live post-fix: 4/4 fresh runs correctly confirmed `Bengaluru, 560067` before reading state — the in_stock reports are genuine, not a bug artifact. |
| Games The Shop | `local-crawler/checkers/gamesTheShop.js` | **Verified working.** Stock state is present in the client-rendered HTML after a short wait, confirming the Next.js-hydration assumption in `GamesTheShopChecker.php`'s docblock. A separate pincode-deliverability widget (`input[placeholder="Enter pincode"]` + "CHECK" button) exists, but global stock state ("Out of Stock"/"Notify Me") takes priority — confirmed live that a globally-OOS item can still show "Delivery available in your area" for a given pincode. |
| Amazon | `local-crawler/checkers/amazon.js` | **Verified working**, contrary to the "hardest target, likely still blocked" assumption — zero blocking/captcha hit across ~10 navigations with a real browser. The original best-effort-guessed ids (`#glow-ingress-block`, `#GLUXZipUpdateInput`, `#GLUXZipUpdate`) turned out exactly correct. Caveat found live: the pincode-update AJAX call intermittently fails ("Sorry, content is not available.") under rapid repeated automated attempts (possible endpoint-specific rate-limiting, not a general block) — falls through gracefully to reading global stock state when this happens. Also confirmed: a plain JS `.click()` via `evaluate()` does NOT trigger Amazon's handler — a real Playwright `.click()` is required. |
| Blinkit | `local-crawler/checkers/blinkit.js` | **Verified working** for the out-of-stock case (the only state available on the test listing). Flow: click text matching `/Delivery in \d+ minutes/` → fill `input[placeholder="search delivery location"]` → click the first `div[class*="LocationListContainer"]` suggestion (Blinkit's styled-components classes have a stable readable prefix + unstable hash suffix — match the prefix via `[class*=...]`) — no separate confirm step needed. Stock signal: "Out of stock" text confirmed; in-stock "ADD" button text inferred from sibling product cards, not yet confirmed on a purchasable PS5 listing. |
| Instamart | `local-crawler/checkers/instamartMcp.js` (active) / `instamart.js` (superseded) | **Verified working — via Swiggy's official Builders MCP API instead of browser automation**, not Playwright. Browser automation is confirmed blocked even headed (`swiggy.com/instamart` → "Request Blocked", reproduced twice) — but `mcp.swiggy.com/builders` is a sanctioned developer API with a `search_products` tool, found 2026-06-30. Requires real OAuth login (phone + OTP, one-time interactive — see `utils/swiggyAuth.js` and `npm run swiggy-login`). **Caveat: Swiggy MCP v1.0 has no refresh-token grant — the access token expires after 5 days and needs a fresh interactive login each time**, this cannot be automated. `instamart.js` (the original Playwright attempt) is kept as a record of the confirmed-blocked browser approach, no longer wired into `index.js`. |

## Project Layout

| Sub-app | Path | Stack |
|---------|------|-------|
| Server | `server/` | PHP 8.0+ + MySQL (front-controller REST API + cron poller) |
| Mobile | `mobile/` | React Native 0.81 + Expo 54 + React Navigation 7 (read-only status screen) |
| Local crawler | `local-crawler/` | Node.js + Playwright (Windows-only, scheduled via Task Scheduler) |

Production API target: `https://shivarya.dev/ps5_tracker/` (cPanel, top-level subfolder — see `server/CPANEL_DEPLOYMENT.md`).

---

## Remaining manual capture work

Only **Games The Shop** still needs its real stock endpoint captured (it's a client-rendered Next.js app — open a PDP, DevTools → Network → Fetch/XHR, and look for a `/api/...` or `/_next/data/...` call; the current HTML-scan fallback may not even see stock state if it's injected client-side after load). Croma is verified Akamai-blocked and not worth pursuing further from shared hosting. Reliance Digital, Vijay Sales, and Sony Center are done and verified working against live data.

When adding real tracked listings via `add_listing.php`, use product URLs in the form each checker expects:
- Reliance Digital: `https://www.reliancedigital.in/product/{slug}`
- Vijay Sales: `https://www.vijaysales.com/p/{sku}/{slug}` (numeric SKU must be present in the URL)
- Sony Center: `https://shopatsc.com/products/{handle}`

## Commands

### Server (`server/`)
```powershell
copy .env.example .env                              # set DB creds, API_KEY, DEFAULT_PINCODE
mysql -u root ps5_tracker < database/schema.sql      # import schema (create DB first)
php -S localhost:8000                                # local dev server (already auto-started at logon — see PS5TrackerDevServer below)
php cron/stock_poll_worker.php                        # run the poller once manually (normally cron-driven)
php scripts/add_listing.php --store=reliance_digital --url="..." --pincode=560067 --name="PS5 Slim Disc"
```
`server/run-dev-server.cmd` (`cd` + `php -S 0.0.0.0:8000`, logged to `server/ps5_tracker_dev_server.log`) is invoked by the `PS5TrackerDevServer` Scheduled Task at every logon — `schtasks /query /tn "PS5TrackerDevServer" /v /fo list` to check it's `Running`. Bound to `0.0.0.0`, not `localhost` — an Android emulator's `10.0.2.2` host alias can't reach a loopback-only bind (real bug hit 2026-06-30 testing the mobile app on an emulator: `/status` calls silently failed with `Network Error` until this was fixed).

### Mobile (`mobile/`)
```powershell
npm install --legacy-peer-deps
npm run typecheck
npm start
npm run android
```

### Local crawler (`local-crawler/`)
```powershell
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; npm install
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; npx playwright install chromium
copy .env.example .env                                # set API_URL, API_KEY, DEFAULT_PINCODE
node index.js                                          # run once manually (headed by default)
node dashboard.js                                      # local dashboard at http://localhost:5055 — run history + current status
```
Already registered as a Windows Scheduled Task (`PS5TrackerLocalCrawler`, fires at logon + every 30 min indefinitely) — see the `ps5-local-crawler` skill for inspecting/rebuilding it.

---

## Architecture

### Server — PHP front-controller (`server/index.php`)
Mirrors `diet-plan`/`expense-tracker` conventions: single entry point strips the `/ps5_tracker` base path and dispatches by URL prefix to a controller file (functions, not classes). `config/database.php` is the shared PDO singleton (`getDB()`). No JWT — `utils/response.php`'s `requireApiKey()` checks an `X-Api-Key` header against `.env`'s `API_KEY` for write routes only.

- **`/listings`** (`controllers/listingsController.php`) — CRUD for tracked product URLs.
- **`/devices/register`** (`controllers/devicesController.php`) — upserts an Expo push token.
- **`/status`** (`controllers/statusController.php`) — read-only feed the mobile app (and the local crawler, for listing discovery) polls.
- **`/stock/report`** (`controllers/stockReportController.php`) — `POST` ingestion endpoint for the local crawler's batch results (`X-Api-Key` required). Runs each result through the same `processCheckResult()`/`notifyTransitions()` path as the cron worker, so transition detection, backoff, and Expo push are identical regardless of which side performed the check. Returns which listings transitioned so the local crawler knows when to fire a Windows toast.
- **`cron/stock_poll_worker.php`** — the 30-min cron poller. CLI-only, ~45s time budget (mirrors `expense-tracker`'s `gmail_sync_worker.php`). For each due listing: jitter delay → dispatch to the store's checker (`utils/storeCheckers/*`) → `processCheckResult()` → on an out_of_stock→in_stock transition, push via `utils/expoPush.php` to all active `device_tokens`. Backoff (`consecutive_failures` → growing `next_check_after`) isolates one blocked store from slowing down the rest. **`STORE_CHECKERS` only maps `reliance_digital`/`vijay_sales`/`sony_center`** — Croma/Games The Shop/Flipkart/Amazon/Blinkit/Instamart are deliberately excluded (listings for unmapped stores are skipped, not polled) even though some PHP checker classes still exist. Found live on 2026-06-30: with both sides mapped, the local crawler would correctly detect e.g. Flipkart `in_stock`, then this worker's always-broken `FlipkartChecker` stub would run on its own cron cycle minutes later and clobber it back to `error` — two systems racing to write the same row. The local crawler owns those 6 stores exclusively now.
- **`utils/httpClient.php`** — shared curl wrapper used by every checker: UA rotation, jitter helper, cookie-jar persistence, CAPTCHA/block detection. Never throws — returns a normalized error shape so the cron loop survives a bad listing.
- **`utils/storeCheckers/StoreCheckerInterface.php`** — the contract every `*Checker::check($url, $pincode)` implements, returning `{status, http_status, raw, error}` with `status` one of `in_stock|out_of_stock|blocked|error`. The local crawler's `checkers/*.js` mirror this same shape so `processCheckResult()` is checker-source-agnostic.
- **`utils/stockResultProcessor.php`** — shared `processCheckResult()` (stock_check_log insert + last_status/backoff update + transition detection) and `notifyTransitions()` (Expo push), used by both the cron worker and `/stock/report`.

### Database (`server/database/schema.sql`, migrations in `server/database/migrations/`)
- `tracked_listings` — one row per candidate product URL/store/edition. `last_status` + `last_status_changed_at` drive notify-on-change (not on every successful poll). `store` ENUM now also includes `blinkit`/`instamart` (migration `001_add_quick_commerce_stores.sql` — apply on the live cPanel DB via SSH before registering listings for those stores).
- `device_tokens` — Expo push tokens; deactivated automatically when Expo reports `DeviceNotRegistered`.
- `stock_check_log` — one row per poll attempt, for debugging when a checker's parser breaks (grows ~288 rows/day/listing — periodic cleanup is a known follow-up, see `CPANEL_DEPLOYMENT.md`).

### Mobile (`mobile/`)
`App.tsx` wraps `ThemeProvider` + `NavigationContainer`, registers for push notifications on mount (`src/services/pushRegistration.ts` → `POST /devices/register`). Single screen `ListingsScreen` (`src/screens/`) lists tracked listings with status pills, pull-to-refresh against `GET /status`. No add/edit UI — listings are managed server-side via `add_listing.php`. `src/services/api.ts` is a plain Axios client (no auth — read-only `/status` needs none). Real EAS project (`@shivarya3/ps5-tracker-mobile`, id `baa830eb-c009-48d8-8b3a-86c0488b790e`) created 2026-06-30 — `app.json`'s `extra.eas.projectId` used to be a `REPLACE_WITH_NEW_EAS_PROJECT_ID` placeholder, which made `getExpoPushTokenAsync()` hang indefinitely (no error, no log line — just never resolved).

**Android push notifications verified working end-to-end 2026-06-30** — set up via a dedicated Firebase project (`ps5-tracker-e7d7e`): `mobile/google-services.json` (gitignored, package `dev.shivarya.ps5tracker`) wired in via `app.json`'s `android.googleServicesFile`, plus a Firebase Admin SDK service-account key (`mobile/*firebase-adminsdk*.json`, also gitignored — **never commit this, it's a private key**) uploaded to EAS for FCM v1. **Real gotcha hit during setup**: `eas credentials -p android` has a top-level `Google Service Account` menu item that's a *separate, different* credential slot from `Push Notifications (FCM V1)` — uploading the service account key under the generic top-level menu (which is what looks like the obvious choice, and is what's used for `eas submit`/Play Console API access) does **not** wire it up for push; `getReceipts`/`send` kept failing with `"Unable to retrieve the FCM server key"` even though `eas credentials` showed "client email and client id configured". The actual fix: drill into `Push Notifications (FCM V1): Manage your FCM V1 Service Account Key` specifically (a separate submenu, easy to miss since the top-level menu only visibly distinguishes `Google Service Account` from `Push Notifications (Legacy)`) and either upload there or pick "Select an existing Google Service Account Key" to reuse the same file. Confirmed with a real `exp.host/--/api/v2/push/send` call delivering to a physical/emulator notification shade.

### Local crawler (`local-crawler/`)
Plain Node.js script (no TypeScript, mirrors `expense-tracker/scraper`'s style), not a daemon — invoked by `run.cmd` via the `PS5TrackerLocalCrawler` Scheduled Task (at logon + every 30 min). `index.js`: `GET /status` → filter to `LOCAL_STORES` (croma, flipkart, games_the_shop, amazon, blinkit, instamart) → one shared headed Chromium context → per-listing jittered checker call (`checkers/*.js`, each `check(page, url, pincode, product_name)` returning the same `{status, http_status, raw, error}` shape as the PHP checkers) → batch `POST /stock/report` → fire a Windows toast (`utils/notify.js`, `node-notifier`) for any listing the server reports as transitioned → append a run record to `logs/runs.jsonl` (`utils/runLog.js`, trimmed to last 500) whether the run succeeded or threw. Server stays the single source of truth for `last_status`; the crawler never decides "is this a transition" itself. The `instamart` entry in `CHECKERS` points at `checkers/instamartMcp.js`, which ignores the Playwright `page` entirely (see below) — every other store still drives a real browser tab.

`dashboard.js` is a separate plain Node `http` server (port `5055`, no Express) serving `dashboard/index.html` — a single-file vanilla-JS page that polls `/api/status` (proxies `GET {API_URL}/status`, all stores) and `/api/runs` (reads `runLog.readRuns()`), auto-refreshing every 30s. `POST /api/listings` proxies to `{API_URL}/listings` with `X-Api-Key` attached server-side, backing the page's add-listing form — same effect as `add_listing.php` from a browser instead of a terminal. Auto-started at logon via the `PS5TrackerDashboard` Scheduled Task (`run-dashboard.cmd`, logged to `logs/dashboard.log`) — added 2026-06-30, same pattern as `PS5TrackerDevServer`/`PS5TrackerLocalCrawler`.

### Instamart via Swiggy's official Builders MCP (`local-crawler/checkers/instamartMcp.js`, `utils/swiggyAuth.js`)
`swiggy.com/instamart` confirmed-blocks even a real headed Playwright browser (`checkers/instamart.js`'s docblock — kept as a record, no longer wired into `index.js`). Instead, `instamartMcp.js` calls Swiggy's sanctioned developer platform (`https://mcp.swiggy.com/builders/`) via the real `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`, server URL `https://mcp.swiggy.com/im`.

- **Auth**: OAuth 2.1 + PKCE against a real Swiggy consumer account (phone + OTP, completed in a browser). `npm run swiggy-login` (→ `swiggy-login.js` → `utils/swiggyAuth.js`'s `login()`) does dynamic client registration (`POST /auth/register`), opens a browser to `/auth/authorize`, catches the redirect on a local callback server (port `51823`), exchanges the code at `/auth/token`, and saves the result to `local-crawler/.swiggy_token.json` (gitignored). **No refresh-token grant in Swiggy MCP v1.0** — the access token lasts 5 days, then `npm run swiggy-login` must be re-run manually; `getValidAccessToken()` throws a clear actionable error rather than attempting silent re-auth (the OTP step can't be automated).
- **Addresses**: `get_or_create_address_id()` looks for a saved address whose `addressLine` contains the tracked pincode (`get_addresses` has no separate `postalCode` field) and caches the match in `local-crawler/.swiggy_addresses.json` (gitignored); falls back to `create_address` with coordinates geocoded via Nominatim (free, no API key) if none exists — that fallback path is unverified live (the account used during verification already had a saved address for `560067`).
- **Search/matching**: `search_products({ addressId, query })` — `query` is the listing's `product_name` (falls back to `"PS5"`). Confirmed response shape: `result.structuredContent.products[]`, each `{displayName, brand, inStock, isAvail, variations: [{spinId, price, isInStockAndAvailable, ...}], productId, ...}`. There's no "look up this exact product" tool — matching is by `product_name` substring against `displayName`, so set a specific, descriptive `product_name` when adding an Instamart listing or this just reports the top search result.

---

## Environment Variables (`server/.env`)
```
DB_HOST, DB_PORT, DB_NAME=ps5_tracker, DB_USER, DB_PASS
API_KEY            # shared secret for write routes; empty disables the check (local dev only)
DEFAULT_PINCODE=560067
```

### Local crawler (`local-crawler/.env`)
```
API_URL=https://shivarya.dev/ps5_tracker   # or http://localhost:8000 for local dev
API_KEY=<same shared secret as server/.env>
DEFAULT_PINCODE=560067
HEADLESS=false                              # headed by default — less likely to be fingerprinted than headless
```

### Mobile (`app.json` extra)
```
apiUrl=https://shivarya.dev/ps5_tracker   apiUrlDev=http://10.0.2.2:8000
```
`apiUrlDev` uses `10.0.2.2` (the Android emulator's alias for the host machine's loopback), not `localhost` — `localhost` inside the emulator resolves to the emulator itself, not the dev machine. If testing on a physical device instead, swap back to your machine's real LAN IP and use `adb reverse tcp:8000 tcp:8000`, or just `localhost` if running an iOS simulator (which shares the host's network namespace, unlike Android's emulator).

---

## Deployment

Full step-by-step: [server/CPANEL_DEPLOYMENT.md](server/CPANEL_DEPLOYMENT.md). Short version: cPanel MySQL DB + import `schema.sql` (+ apply `database/migrations/001_add_quick_commerce_stores.sql` if the DB predates it), deploy `server/` to `~/public_html/ps5_tracker`, `.env` (600), cron entry `*/30 * * * * php ~/public_html/ps5_tracker/cron/stock_poll_worker.php`.

Mobile distribution: this is a personal tool — an EAS internal-distribution build (install via QR, no Play Console setup) is likely sufficient; Play Store listing is unnecessary unless that changes.

Local crawler distribution: runs only on the user's own Windows machine, registered via Windows Task Scheduler (see `ps5-local-crawler` skill) — not deployed anywhere, no server component beyond the `/stock/report` endpoint it talks to.
