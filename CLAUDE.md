# CLAUDE.md — PS5 Tracker

> ## ⚠️ SUNSET — decommissioned 2026-08-18
> This app no longer runs. All 3 local Windows Scheduled Tasks are deleted, all local processes killed, and the production cPanel cron job is removed. Deployed code + DB are left dormant, not deleted. **Read [`SUNSET.md`](SUNSET.md) first** for what was stopped, what's still there, and how to resurrect it. The reusable architecture pattern behind this app is written up generically at [`../docs/stock-availability-tracker-pattern.md`](../docs/stock-availability-tracker-pattern.md) for building a similar tracker for a different product. Everything below this banner is the historical build record — accurate as of the sunset date, describes what was built, not what's currently running.

Guidance for Claude Code when working inside `ps5-tracker/`. Launch Claude from this directory so the project's configuration loads automatically. (Terminal command rules: see the workspace-root `CLAUDE.md`, which loads automatically alongside this one.)

## What this app does

A personal, single-user 24/7 stock monitor: polls PS5 listings across several Indian retailers for deliverability to a specific pincode, and pushes an instant phone notification the moment one goes from out-of-stock to in-stock **at or below a price cap** (₹60,000 by default — see "Price-gated notifications" below). No login/multi-user system — it's a personal tool, gated by a single shared `API_KEY` header on write endpoints.

**Formerly live** at `https://shivarya.dev/ps5_tracker/` (cPanel) — see the sunset banner above, this is now historical. **Status as of sunset**: Phase 1 complete — server polled every 15 min live (docs elsewhere in this file say 30 min lowered from 5; that was stale, the crontab entry actually removed was `*/15`). Of 16 total tracked listings (per the 2026-07-29 URL audit below), 3 were checked server-side (Reliance Digital, Vijay Sales, Sony Center); Phase 2's local Playwright crawler (`local-crawler/`) covered the rest — retailers Akamai/PerimeterX-blocks on shared hosting (Croma, Flipkart, Games The Shop, Amazon) plus quick-commerce (Blinkit, Instamart) that were never server-side checkers at all. It reported results to the same backend via `POST /stock/report`, so both push notifications (Expo) and a local Windows toast fired from one shared transition-detection path (`server/utils/stockResultProcessor.php`). Three Windows Scheduled Tasks used to run on this machine (now deleted): `PS5TrackerLocalCrawler` (the crawler, at logon + every 30 min), `PS5TrackerDevServer` (local PHP dev server bound to `0.0.0.0` — see the Commands section below for why), `PS5TrackerDashboard` (status dashboard + add-listing form at `http://localhost:5055`). It was configured against production (`local-crawler/.env`'s `API_URL=https://shivarya.dev/ps5_tracker`) — tracking real listings unattended, not local dev.

## Price-gated notifications (added 2026-07-29)

Stock alone stopped being a useful alert signal once the disc edition's price roughly split into two tiers. Live prices captured 2026-07-29 for the tracked listings:

| Listing | Price | Alerts? |
|---|---|---|
| Reliance Digital disc, Croma disc, Flipkart disc, MD Computers disc | ₹54,990 | yes |
| Croma digital, (Games The Shop digital) | ₹49,990 | yes |
| Blinkit disc | ₹58,190 | yes |
| **Games The Shop disc, Vijay Sales disc, Sony Center disc, Zepto disc** | **₹69,990** | **no — muted** |
| Amazon Pro | ₹2L+ (unavailable, no price rendered) | no, unless given its own cap |

Mechanics: every checker now returns `price` alongside `status`; `processCheckResult()` writes it to `stock_check_log.price` and `tracked_listings.last_price` (a null price never overwrites the last known good one). `notifyTransitions()` runs `evaluateNotifyGate()` first and pushes only if the price is at or under the listing's cap — `tracked_listings.max_notify_price` if set, else `.env`'s `NOTIFY_MAX_PRICE` (default 60000; `0` disables gating entirely). A suppressed transition is still logged and still updates `last_status`, it just doesn't push.

- **Unknown price → still notifies**, flagged "price unknown — check before buying" in the body. Deliberate: these listings are out of stock ~100% of the time, so a rare unpriced alert beats missing a real restock. But if `last_price` is known and above the cap, that fallback suppresses it — a checker that temporarily can't parse a price doesn't un-mute a 70k listing.
- **Per-listing caps exist for the PS5 Pro case** — it legitimately costs ~2x a Slim, so a flat 60k cap would mute it forever. `php scripts/add_listing.php --max-price=120000`, `PUT /listings/{id} {"max_notify_price": 120000}`, or the dashboard's "Max notify price" field.
- `/status` returns `last_price`, `max_notify_price` and a server-resolved `effective_max_notify_price`; the mobile card and dashboard both grey out an over-cap price and say it won't push, so a muted listing never looks like a live alert.
- `POST /stock/report` returns each transition with a `notified` flag, and the local crawler only fires its Windows toast when it's not `false` — otherwise the desktop toast would still fire for exactly the listings the gate exists to mute. (It checks `=== false` specifically so an API deployed before this change keeps the old toast-everything behaviour rather than going silent.)

## Claude Code skills (`.claude/skills/`, load when launched inside `ps5-tracker/`)

- `ps5-dev` — run the PHP API + Expo app locally, run the poller once manually.
- `ps5-deploy-api` — deploy/update the PHP backend on cPanel; documents the deploy-path symlink and inode-quota gotchas hit during the first deploy.
- `ps5-add-listing` — register a new tracked product URL with the correct per-store format; lists which stores are actually verified working.
- `ps5-local-crawler` — install/run/schedule the Windows Playwright crawler for the blocked retailers (`local-crawler/`).

**Server-side retailers**, with real difficulty verified live via Chrome DevTools + curl on 2026-06-28 (corrects the original plan's assumptions — see per-checker docblocks for full capture details):

| Store | Checker | Status |
|---|---|---|
| Reliance Digital | `RelianceDigitalChecker.php` | **Working, pincode-aware — rewritten 2026-07-02** after a full day of false in_stock alarms: the original Fynd `sizes/` endpoint silently **ignores** the `x-location-detail` pincode header (identical responses for Bangalore vs Leh, verified live). Real flow is two-step: GET `/ext/raven-api/catalog/v1.0/products/{slug}` → `item_code` as article_id, then POST `/ext/raven-api/inventory/multi/articles-v2` with `{articles:[{article_id,quantity:0}],phone_number:"0",pincode,request_page:"pdp"}` — `data.success===true` = in_stock. Storefront bearer token suffices, no `x-fp-signature` needed. Local-crawler backup `relianceDigital.js` mirrors the same two calls. |
| Vijay Sales | `VijaySalesChecker.php` | **Working, pincode-aware.** Dedicated `oms.vijaysales.systems/v1/servicability?pincode=&vanNo=` microservice, no auth needed. |
| Sony Center | `SonyCenterChecker.php` | **Working, stock-only (no pincode check exists for this store).** Shopify storefront, but this theme strips `variants[].available` from `products.json` — real signal is `POST /cart/add.js`, which returns 422 "already sold out" when OOS. |
| Croma | `CromaChecker.php` | **Verified NOT scrapable from shared hosting.** Akamai Bot Manager blocks even the plain HTML page at the edge (403, before reaching origin) for a bare curl request — same difficulty tier as Amazon. PHP checker still returns `blocked` gracefully; real attempt now lives in the local crawler instead (residential IP + real browser). |
| Games The Shop | `GamesTheShopChecker.php` | **Unverified, HTML-heuristic fallback only.** Turned out to be a custom Next.js storefront, not Shopify as assumed — no stock API captured yet. Also covered by the local crawler. |
| Flipkart, Amazon | `FlipkartChecker.php`, `AmazonChecker.php` | Server-side stubs, intentionally always return `error` — real anti-bot infrastructure not attempted here. Covered by the local crawler instead (Flipkart now verified there, see below). |

**Local-crawler-only retailers** (`local-crawler/checkers/`, no PHP equivalent): Blinkit, Instamart, Zepto (quick-commerce — stock is purely location/app-driven) and MD Computers (Cloudflare-blocked from shared hosting). See the `ps5-local-crawler` skill for setup. Per-store implementation status, verified live via chrome-devtools MCP starting 2026-06-30:

**Retailers evaluated and rejected (2026-07-03, don't re-investigate):** JioMart — no actual PS5 console listing anymore, only accessories; the old console PDPs 404 after their Fynd platform migration. Tata CLiQ — pivoted to fashion-only, dropped electronics entirely (that's Croma's territory within Tata). International (PlayStation Direct, Best Buy, Walmart, Amazon Global) — none ship consoles to India (lithium-battery restrictions / US-EU-only), and even a freight-forwarder route means ~36-40% customs duty plus a void India warranty.

| Store | Checker | Status |
|---|---|---|
| Flipkart | `local-crawler/checkers/flipkart.js` | **Verified working** against two real PS5 listings (one in-stock, one out-of-stock) via real Playwright runs, not just manual driving. Flow: click "Select delivery location" text → fill `input[placeholder="Search by area, street name, pin code"]` → click `getByText(pincode, {exact:true}).first()` (every suggestion row contains the literal pincode as its own text node, so this works regardless of which city it resolves to) → click "Confirm" text. Stock signal: "Notify Me" text = `out_of_stock`, "Buy now"/"Add to cart" text = `in_stock`. Flipkart's CSS classes are content-hashed (`css-xxxxx`, not stable across deploys) — every selector here is deliberately text/placeholder-based instead. |
| Croma | `local-crawler/checkers/croma.js` | **Verified working**, but hit 3 separate hydration/race bugs before it was reliable: (1) a fresh session shows the pincode modal already open with no pencil icon to click, so the click-through timed out and read stale state; (2) Croma's client JS silently reverts the confirmed pincode to an IP-geolocated default 1.5–3s after "Continue," so a fixed wait could read the wrong city; (3) the generic Buy-Now/Add-to-Cart scan wasn't actually pincode-aware — a pincode-unavailable listing still shows those buttons elsewhere on the page as an unrelated in-store-pickup signal. All three fixed by polling for definite markers instead of fixed waits. Full blow-by-blow in `croma.js`'s docblock and the "recurring bug shape" section below. Re-verified 4/4 clean runs post-fix. |
| Games The Shop | `local-crawler/checkers/gamesTheShop.js` | **Verified working.** Stock state is present in the client-rendered HTML after a short wait, confirming the Next.js-hydration assumption in `GamesTheShopChecker.php`'s docblock. A separate pincode-deliverability widget (`input[placeholder="Enter pincode"]` + "CHECK" button) exists, but global stock state ("Out of Stock"/"Notify Me") takes priority — confirmed live that a globally-OOS item can still show "Delivery available in your area" for a given pincode. |
| Amazon | `local-crawler/checkers/amazon.js` | **Verified working**, contrary to the "hardest target, likely still blocked" assumption — zero blocking/captcha hit across ~10 navigations with a real browser. The original best-effort-guessed ids (`#glow-ingress-block`, `#GLUXZipUpdateInput`, `#GLUXZipUpdate`) turned out exactly correct. Caveat found live: the pincode-update AJAX call intermittently fails ("Sorry, content is not available.") under rapid repeated automated attempts (possible endpoint-specific rate-limiting, not a general block) — falls through gracefully to reading global stock state when this happens. Also confirmed: a plain JS `.click()` via `evaluate()` does NOT trigger Amazon's handler — a real Playwright `.click()` is required. |
| Blinkit | `local-crawler/checkers/blinkit.js` | **Verified working** for the out-of-stock case (the only state available on the test listing). Flow: click text matching `/Delivery in \d+ minutes/` → fill `input[placeholder="search delivery location"]` → click the first `div[class*="LocationListContainer"]` suggestion (Blinkit's styled-components classes have a stable readable prefix + unstable hash suffix — match the prefix via `[class*=...]`) — no separate confirm step needed. Stock signal: "Out of stock" text confirmed; in-stock "ADD" button text inferred from sibling product cards, not yet confirmed on a purchasable PS5 listing. |
| Instamart | `local-crawler/checkers/instamartMcp.js` (active) / `instamart.js` (superseded) | **Verified working — via Swiggy's official Builders MCP API instead of browser automation**, not Playwright. Browser automation is confirmed blocked even headed (`swiggy.com/instamart` → "Request Blocked", reproduced twice) — but `mcp.swiggy.com/builders` is a sanctioned developer API with a `search_products` tool, found 2026-06-30. Requires real OAuth login (phone + OTP, one-time interactive — see `utils/swiggyAuth.js` and `npm run swiggy-login`). **Caveat: Swiggy MCP v1.0 has no refresh-token grant — the access token expires after 5 days and needs a fresh interactive login each time**, this cannot be automated. `instamart.js` (the original Playwright attempt) is kept as a record of the confirmed-blocked browser approach, no longer wired into `index.js`. |
| Zepto | `local-crawler/checkers/zepto.js` | **Verified working (OOS case), added 2026-07-02.** Quick-commerce; stock tied to the nearest dark store. Location is set via **cookie injection, NOT the UI picker** — the div-based location button (no `role="button"`) accepts Playwright clicks without error but never fires the React handler; meanwhile a fresh session gets IP-geolocated to an arbitrary dark store, which caused false in_stock before the fix. `page.context().addCookies()` with `latitude`/`longitude`/`user_position`/`serviceability` (captured per-pincode from a real Chrome session — values for 560067 hardcoded in `LOCATION_COOKIES`; new pincodes need a one-time DevTools `document.cookie` capture) makes the backend serve pincode-correct stock. Gotcha: the header still shows "Select Location" even when cookies are honored — it is NOT a failure signal. Stock signal: "Notify Me" = `out_of_stock`, "Add to Cart" = `in_stock`. |
| MD Computers | `local-crawler/checkers/mdComputers.js` | **Verified working, added 2026-07-03.** Genuine Kolkata retailer, ships pan-India from a central warehouse — **no pincode interaction at all** (global stock = deliverable). Cloudflare blocks plain curl (local-crawler-only, same tier as Croma), but a real browser loads the PDP fine on a fresh context. Gotcha: hitting a malformed route (e.g. `/search?q=...`) flags the whole session, cookie/session-scoped not IP-scoped — the fresh-context-per-run pattern is naturally immune, but never navigate anywhere except the product URL. URL format `mdcomputers.in/product/{slug}` (old `.html` URLs 301 there). **False-alert bug, fixed 2026-07-29** (see "recurring bug shape" below for the incident) by reading `offers.availability` from the server-rendered schema.org JSON-LD instead of a timed text scan. **This is the only store where JSON-LD availability drives the stock verdict** (global stock == deliverable here); everywhere else it's a price source only. |

## Project Layout

| Sub-app | Path | Stack |
|---------|------|-------|
| Server | `server/` | PHP 8.0+ + MySQL (front-controller REST API + cron poller) |
| Mobile | `mobile/` | React Native 0.81 + Expo 54 + React Navigation 7 (read-only status screen) |
| Local crawler | `local-crawler/` | Node.js + Playwright (Windows-only, scheduled via Task Scheduler) |

Production API target: `https://shivarya.dev/ps5_tracker/` (cPanel, top-level subfolder — see `server/CPANEL_DEPLOYMENT.md`).

---

## The recurring bug shape here: reading a client-rendered page once, at a fixed time

Four of these checkers have now had the same defect, and it's worth recognising on sight. Every one of these storefronts renders its buy box with client-side JS, so `await page.waitForTimeout(N)` followed by a single `body.innerText()` read is a coin flip against hydration. When it lands early you don't get an error — you get a *confident wrong answer*, because the page at that instant genuinely contains some other element's "Add to Cart".

- **MD Computers (2026-07-29)** — read the related-products carousel's buttons as the product's own state → false `in_stock` → 38 spurious push notifications. Fixed via server-rendered JSON-LD.
- **Blinkit (2026-07-29)** — spurious `error` on ~1 in 3 fresh runs, and intermittently null prices. Fixed by polling for a definite marker.
- **Zepto (2026-07-29)** — same, fixed the same way.
- **Croma (2026-06-30 / 07-01)** — three separate versions of this, documented at length in `croma.js`.

The fix is always one of: prefer server-rendered structured data (`utils/structuredData.js`), or poll until a *definite* marker appears rather than waiting a fixed time, and return `error` instead of guessing when neither shows up. Never widen a text scan to the whole body to "make it work" — that's what caused the false alerts.

## Listing URL audit (2026-07-29)

Retailers reissue PS5 SKUs under new URLs when the price changes, and the old URL just dies — so a listing showing `error` for days is as likely to be a dead URL as a broken checker. All 16 tracked URLs were opened in a real browser on 2026-07-29:

| Listing | Verdict |
|---|---|
| `vijay_sales` disc `/p/252606/...` | **Dead** — 302s to `/c/gaming` (the category page). Replaced with `/p/259648/sony-playstationr5-sa-e-disc-edition-gaming-console-ps5r-slim` (₹69,990), the relisted SKU. |
| `sony_center` disc `/products/playstation-5-standard-edition` | **404**. Replaced with `/products/ps5-standard-e-chassis-arv` (₹69,990, published 2026-07-27). |
| `sony_center` digital `/products/playstation-5-digital-edition` | **404, no replacement exists** — `products.json` (440 products, paginated) has exactly one PS5 console left, the Standard/disc above. Sony Center has delisted the Digital Edition console. Listing deleted. |
| `instamart` | URL fine, but the Swiggy MCP token expired 2026-07-04 and re-login is manual + interactive every ~5 days. Deactivated. |
| `zepto` disc | **Died mid-session** — worked at 10:15 (out_of_stock, ₹69,990), soft-404'd by 11:40 the same day, with and without the location cookies. Zepto's catalog now has only PS5 *games* and accessories, no console. Left active (quick-commerce catalogs churn, so it may return); `zepto.js` now reports it as an explicit "delisted, needs a new URL" error rather than an ambiguous parse failure. |
| Everything else (reliance, croma ×2, games_the_shop ×2, flipkart, amazon ×3, blinkit ×2, md_computers) | Valid. Croma's disc URL 302s to a renamed slug on the same `/p/305985` id — harmless, left as-is. |

**Zepto's 404 is a soft 404**: HTTP 202 with a body reading "The page you're looking for has made an egg-sit". The status code is useless for detecting a dead listing there — match the copy.

Useful discovery endpoints when a URL dies: `shopatsc.com/products.json?limit=250&page=N` (Shopify, works from curl, includes price + `available`), and for Vijay Sales the `/c/gaming-consoles` category page in a real browser (its `/search?q=` is client-rendered and returns games only — the console never appears there).

## Remaining manual capture work

Only **Games The Shop** still needs its real stock endpoint captured (it's a client-rendered Next.js app — open a PDP, DevTools → Network → Fetch/XHR, and look for a `/api/...` or `/_next/data/...` call; the current HTML-scan fallback may not even see stock state if it's injected client-side after load). Croma is verified Akamai-blocked and not worth pursuing further from shared hosting. Reliance Digital, Vijay Sales, and Sony Center are done and verified working against live data.

When adding real tracked listings via `add_listing.php`, use product URLs in the form each checker expects:
- Reliance Digital: `https://www.reliancedigital.in/product/{slug}`
- Vijay Sales: `https://www.vijaysales.com/p/{sku}/{slug}` (numeric SKU must be present in the URL)
- Sony Center: `https://shopatsc.com/products/{handle}`

Where each checker gets its **price** (all verified live 2026-07-29 — worth knowing before "fixing" a null):
- Reliance Digital: the Fynd application API's `sizes/` endpoint (`price.effective.max`). Neither raven-api call returns a price. **Price only** — that endpoint's stock fields ignore the pincode, which is the exact bug the 2026-07-02 rewrite fixed.
- Vijay Sales: a second GET of the PDP HTML for `data-compare-price="69990"`; the servicability microservice is stock-only.
- Sony Center: `variants[0].price` from the Shopify product JSON already being fetched — free.
- Flipkart, Blinkit, Zepto, MD Computers: schema.org JSON-LD / `<meta itemprop="price">` via `local-crawler/utils/structuredData.js`.
- Croma, Games The Shop: **no usable structured data** (empty ld+json) — first plausible rupee amount in page text (floor ₹15,000, so Croma's "₹2,589/mo*" EMI line loses).
- Amazon: `#corePrice_feature_div .a-price .a-offscreen`. Null while a listing is "Currently unavailable" (Amazon renders no price at all then) — verified the selector works by running the checker against an in-stock DualSense PDP: `in_stock`, ₹6,149.

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
- `tracked_listings` — one row per candidate product URL/store/edition. `last_status` + `last_status_changed_at` drive notify-on-change (not on every successful poll). `last_price` + `max_notify_price` (migration `005`, 2026-07-29) drive the price gate; `stock_check_log.price` keeps per-check history. `store` ENUM now also includes `blinkit`/`instamart` (migration `001`), `zepto` (migration `003`), and `md_computers` (migration `004`) — apply on the live cPanel DB via SSH before registering listings for those stores (001–004 all applied to prod as of 2026-07-03). `edition` ENUM (`disc`/`digital`/`pro`, default `digital`, migration `002_add_edition.sql`) added 2026-06-30 — both the mobile app and the local dashboard filter/group by this. `add_listing.php` and `POST /listings` both accept `--edition`/`edition`; omit it for digital.
- `device_tokens` — Expo push tokens; deactivated automatically when Expo reports `DeviceNotRegistered`.
- `stock_check_log` — one row per poll attempt, for debugging when a checker's parser breaks (grows ~288 rows/day/listing — periodic cleanup is a known follow-up, see `CPANEL_DEPLOYMENT.md`).

### Mobile (`mobile/`)
`App.tsx` wraps `ThemeProvider` + `NavigationContainer`, registers for push notifications on mount (`src/services/pushRegistration.ts` → `POST /devices/register`). Single screen `ListingsScreen` (`src/screens/`) lists tracked listings with status pills, pull-to-refresh against `GET /status`, auto-polls every 30s (same cadence as the dashboard). Filter chips (All/Disc/Digital/Pro) at the top — "All" groups listings into sections by edition (`SectionList`, mirrors the dashboard's grouped table); selecting a specific edition shows a flat filtered list. No add/edit UI — listings are managed server-side via `add_listing.php` or the dashboard's form. `src/services/api.ts` is a plain Axios client (no auth — read-only `/status` needs none). Real EAS project (`@shivarya3/ps5-tracker-mobile`, id `baa830eb-c009-48d8-8b3a-86c0488b790e`) created 2026-06-30 — `app.json`'s `extra.eas.projectId` used to be a `REPLACE_WITH_NEW_EAS_PROJECT_ID` placeholder, which made `getExpoPushTokenAsync()` hang indefinitely (no error, no log line — just never resolved).

**Android push notifications verified working end-to-end 2026-06-30** — set up via a dedicated Firebase project (`ps5-tracker-e7d7e`): `mobile/google-services.json` (gitignored, package `dev.shivarya.ps5tracker`) wired in via `app.json`'s `android.googleServicesFile`, plus a Firebase Admin SDK service-account key (`mobile/*firebase-adminsdk*.json`, also gitignored — **never commit this, it's a private key**) uploaded to EAS for FCM v1. **Real gotcha hit during setup**: `eas credentials -p android` has a top-level `Google Service Account` menu item that's a *separate, different* credential slot from `Push Notifications (FCM V1)` — uploading the service account key under the generic top-level menu (which is what looks like the obvious choice, and is what's used for `eas submit`/Play Console API access) does **not** wire it up for push; `getReceipts`/`send` kept failing with `"Unable to retrieve the FCM server key"` even though `eas credentials` showed "client email and client id configured". The actual fix: drill into `Push Notifications (FCM V1): Manage your FCM V1 Service Account Key` specifically (a separate submenu, easy to miss since the top-level menu only visibly distinguishes `Google Service Account` from `Push Notifications (Legacy)`) and either upload there or pick "Select an existing Google Service Account Key" to reuse the same file. Confirmed with a real `exp.host/--/api/v2/push/send` call delivering to a physical/emulator notification shade.

### Local crawler (`local-crawler/`)
Plain Node.js script (no TypeScript, mirrors `expense-tracker/scraper`'s style), not a daemon — invoked by `run.cmd` via the `PS5TrackerLocalCrawler` Scheduled Task (at logon + every 30 min). `index.js`: `GET /status` → filter to `LOCAL_STORES` (croma, flipkart, games_the_shop, amazon, blinkit, instamart, always checked) plus any `BACKUP_CHECKERS` store (reliance_digital, vijay_sales, sony_center — only checked when that listing's `last_status` is already `blocked`/`error`) → one shared headed Chromium context → per-listing jittered checker call (`checkers/*.js`, each `check(page, url, pincode, product_name)` returning the same `{status, http_status, raw, error}` shape as the PHP checkers) → batch `POST /stock/report` → fire a Windows toast (`utils/notify.js`, `node-notifier`) for any listing the server reports as transitioned → append a run record to `logs/runs.jsonl` (`utils/runLog.js`, trimmed to last 500) whether the run succeeded or threw. Server stays the single source of truth for `last_status`; the crawler never decides "is this a transition" itself. The `instamart` entry in `CHECKERS` points at `checkers/instamartMcp.js`, which ignores the Playwright `page` entirely (see below) — every other store still drives a real browser tab. The 3 `BACKUP_CHECKERS` (`checkers/relianceDigital.js`/`vijaySales.js`/`sonyCenter.js`, added 2026-06-30) also ignore `page` — they're plain `axios` calls mirroring the server-side PHP checkers' exact API endpoints, the point being a different (residential) IP, not a different request shape. The conditional trigger (only when already `blocked`/`error`) is deliberate — checking these unconditionally would race the server cron worker the same way Croma/Flipkart/etc. did before `STORE_CHECKERS` was split (see `stock_poll_worker.php`'s docblock above).

`dashboard.js` is a separate plain Node `http` server (port `5055`, no Express) serving `dashboard/index.html` — a single-file vanilla-JS page that polls `/api/status` (proxies `GET {API_URL}/status`, all stores) and `/api/runs` (reads `runLog.readRuns()`), auto-refreshing every 30s. `POST /api/listings` proxies to `{API_URL}/listings` with `X-Api-Key` attached server-side, backing the page's add-listing form (now includes an Edition dropdown: Digital/Disc/Pro) — same effect as `add_listing.php` from a browser instead of a terminal. The status table has filter chips (All/Disc/Digital/Pro) above it — same data/grouping logic as the mobile app's `ListingsScreen`, kept in sync deliberately since both read the same `/status` endpoint. The cached `INDEX_HTML` is read once at server startup (`fs.readFileSync`), not per-request — editing `dashboard/index.html` needs `schtasks /end` + `schtasks /run` on `PS5TrackerDashboard` (or a manual restart) to take effect, plain Metro-style hot reload doesn't apply here. Auto-started at logon via the `PS5TrackerDashboard` Scheduled Task (`run-dashboard.cmd`, logged to `logs/dashboard.log`) — added 2026-06-30, same pattern as `PS5TrackerDevServer`/`PS5TrackerLocalCrawler`.

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
NOTIFY_MAX_PRICE=60000   # global push cap in INR; per-listing max_notify_price overrides it, 0 disables gating
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

Mobile distribution: this is a personal tool — direct sideload of a locally-built release APK, no Play Store. Built locally via gradle (not EAS cloud build — EAS Build's remote builder can't see `google-services.json` since it's gitignored, and would additionally need a one-time interactive keystore-generation step neither of which the local build needs):
```powershell
# android/gradle.properties: reactNativeArchitectures=arm64-v8a,x86_64 (already set)
cmd /c "mklink /J C:\p C:\Users\Ash\Documents\Projects\apps\ps5-tracker\mobile"
cd C:\p\android
.\gradlew.bat assembleRelease -x lint -x test
# APK lands at mobile/android/app/build/outputs/apk/release/app-release.apk
cmd /c "rmdir C:\p"
```
Signed with the auto-generated debug keystore (`android/app/build.gradle`'s `release` build type intentionally reuses `signingConfigs.debug`) — fine for sideloading, would need a real release keystore (`eas credentials`, interactive) if ever submitted to Play Store. See the root `CLAUDE.md`'s "Windows build gotchas" section for the `MAX_PATH`/junction mechanics this build needs.

**Real bug found and fixed 2026-06-30, release-build-only crash**: `assembleRelease` produced an APK that crashed instantly on launch with `[runtime not ready]: ReferenceError: Property 'FormData' doesn't exist` (SIGABRT, `mqt_v_js` thread) — never reproduced in the dev-client build tested earlier, because dev-client mode serves JS live from Metro's dev server, never exercising the actual embedded-bundle code path. Root cause: axios's `package.json` correctly declares a `"react-native"` export condition pointing at its browser-safe build (`dist/browser/axios.cjs`), but Metro wasn't honoring it — it resolved to axios's raw `lib/` source instead, which pulls in `lib/platform/node/classes/FormData.js` (`import _FormData from 'form-data'`, the Node-only npm package), crashing at JS-bundle-evaluation time. Deferring the app's own early network calls (`setTimeout`) did **not** fix it — the crash came from axios's own module-scope code running at *import* time, not from when the app actually calls it. Fixed with `mobile/metro.config.js` setting `resolver.unstable_enablePackageExports = true` and `resolver.unstable_conditionNames = ['react-native', 'require', 'default']`, which makes Metro honor the export condition axios already ships. If any future dependency shows similarly inexplicable release-only crashes referencing a global that should obviously exist, suspect the same Metro package-exports gap before anything else.

Local crawler distribution: runs only on the user's own Windows machine, registered via Windows Task Scheduler (see `ps5-local-crawler` skill) — not deployed anywhere, no server component beyond the `/stock/report` endpoint it talks to.
