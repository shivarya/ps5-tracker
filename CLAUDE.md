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

**Live**: `https://shivarya.dev/ps5_tracker/` (cPanel). **Status**: Phase 1 complete — deployed, polling on a 5-min cron, 3 listings tracked.

## Claude Code skills (`.claude/skills/`, load when launched inside `ps5-tracker/`)

- `ps5-dev` — run the PHP API + Expo app locally, run the poller once manually.
- `ps5-deploy-api` — deploy/update the PHP backend on cPanel; documents the deploy-path symlink and inode-quota gotchas hit during the first deploy.
- `ps5-add-listing` — register a new tracked product URL with the correct per-store format; lists which stores are actually verified working.

**Retailers tracked**, with real difficulty verified live via Chrome DevTools + curl on 2026-06-28 (corrects the original plan's assumptions — see per-checker docblocks for full capture details):

| Store | Checker | Status |
|---|---|---|
| Reliance Digital | `RelianceDigitalChecker.php` | **Working, pincode-aware.** Fynd storefront JSON endpoint (`.../sizes/`), no auth/signature needed, `x-location-detail` carries the pincode. |
| Vijay Sales | `VijaySalesChecker.php` | **Working, pincode-aware.** Dedicated `oms.vijaysales.systems/v1/servicability?pincode=&vanNo=` microservice, no auth needed. |
| Sony Center | `SonyCenterChecker.php` | **Working, stock-only (no pincode check exists for this store).** Shopify storefront, but this theme strips `variants[].available` from `products.json` — real signal is `POST /cart/add.js`, which returns 422 "already sold out" when OOS. |
| Croma | `CromaChecker.php` | **Verified NOT scrapable from shared hosting.** Akamai Bot Manager blocks even the plain HTML page at the edge (403, before reaching origin) for a bare curl request — same difficulty tier as Amazon, contrary to the original "Low" assessment. Demoted to stretch goal; still returns `blocked` gracefully rather than crashing. |
| Games The Shop | `GamesTheShopChecker.php` | **Unverified, HTML-heuristic fallback only.** Turned out to be a custom Next.js storefront, not Shopify as assumed — no stock API captured yet. |
| Flipkart, Amazon | `FlipkartChecker.php`, `AmazonChecker.php` | Stretch goals, intentionally stubbed to always return `error` — real anti-bot infrastructure not yet attempted. |

## Project Layout

| Sub-app | Path | Stack |
|---------|------|-------|
| Server | `server/` | PHP 8.0+ + MySQL (front-controller REST API + cron poller) |
| Mobile | `mobile/` | React Native 0.81 + Expo 54 + React Navigation 7 (read-only status screen) |

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
php -S localhost:8000                                # local dev server
php cron/stock_poll_worker.php                        # run the poller once manually (normally cron-driven)
php scripts/add_listing.php --store=reliance_digital --url="..." --pincode=560067 --name="PS5 Slim Disc"
```

### Mobile (`mobile/`)
```powershell
npm install --legacy-peer-deps
npm run typecheck
npm start
npm run android
```

---

## Architecture

### Server — PHP front-controller (`server/index.php`)
Mirrors `diet-plan`/`expense-tracker` conventions: single entry point strips the `/ps5_tracker` base path and dispatches by URL prefix to a controller file (functions, not classes). `config/database.php` is the shared PDO singleton (`getDB()`). No JWT — `utils/response.php`'s `requireApiKey()` checks an `X-Api-Key` header against `.env`'s `API_KEY` for write routes only.

- **`/listings`** (`controllers/listingsController.php`) — CRUD for tracked product URLs.
- **`/devices/register`** (`controllers/devicesController.php`) — upserts an Expo push token.
- **`/status`** (`controllers/statusController.php`) — read-only feed the mobile app polls.
- **`cron/stock_poll_worker.php`** — the 5-min cron poller. CLI-only, ~45s time budget (mirrors `expense-tracker`'s `gmail_sync_worker.php`). For each due listing: jitter delay → dispatch to the store's checker (`utils/storeCheckers/*`) → log to `stock_check_log` → on an out_of_stock→in_stock transition, push via `utils/expoPush.php` to all active `device_tokens`. Backoff (`consecutive_failures` → growing `next_check_after`) isolates one blocked store from slowing down the rest.
- **`utils/httpClient.php`** — shared curl wrapper used by every checker: UA rotation, jitter helper, cookie-jar persistence, CAPTCHA/block detection. Never throws — returns a normalized error shape so the cron loop survives a bad listing.
- **`utils/storeCheckers/StoreCheckerInterface.php`** — the contract every `*Checker::check($url, $pincode)` implements, returning `{status, http_status, raw, error}` with `status` one of `in_stock|out_of_stock|blocked|error`.

### Database (`server/database/schema.sql`)
- `tracked_listings` — one row per candidate product URL/store/edition. `last_status` + `last_status_changed_at` drive notify-on-change (not on every successful poll).
- `device_tokens` — Expo push tokens; deactivated automatically when Expo reports `DeviceNotRegistered`.
- `stock_check_log` — one row per poll attempt, for debugging when a checker's parser breaks (grows ~288 rows/day/listing — periodic cleanup is a known follow-up, see `CPANEL_DEPLOYMENT.md`).

### Mobile (`mobile/`)
`App.tsx` wraps `ThemeProvider` + `NavigationContainer`, registers for push notifications on mount (`src/services/pushRegistration.ts` → `POST /devices/register`). Single screen `ListingsScreen` (`src/screens/`) lists tracked listings with status pills, pull-to-refresh against `GET /status`. No add/edit UI — listings are managed server-side via `add_listing.php`. `src/services/api.ts` is a plain Axios client (no auth — read-only `/status` needs none).

---

## Environment Variables (`server/.env`)
```
DB_HOST, DB_PORT, DB_NAME=ps5_tracker, DB_USER, DB_PASS
API_KEY            # shared secret for write routes; empty disables the check (local dev only)
DEFAULT_PINCODE=560067
```

### Mobile (`app.json` extra)
```
apiUrl=https://shivarya.dev/ps5_tracker   apiUrlDev=http://localhost:8000
```

---

## Deployment

Full step-by-step: [server/CPANEL_DEPLOYMENT.md](server/CPANEL_DEPLOYMENT.md). Short version: cPanel MySQL DB + import `schema.sql`, deploy `server/` to `~/public_html/ps5_tracker`, `.env` (600), cron entry `*/5 * * * * php ~/public_html/ps5_tracker/cron/stock_poll_worker.php`.

Mobile distribution: this is a personal tool — an EAS internal-distribution build (install via QR, no Play Console setup) is likely sufficient; Play Store listing is unnecessary unless that changes.
