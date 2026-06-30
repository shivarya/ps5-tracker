---
name: ps5-local-crawler
description: Install, run, schedule, and monitor the local Windows Playwright crawler for PS5 Tracker retailers blocked from shared hosting (Croma, Flipkart, Games The Shop, Amazon, Blinkit, Instamart), plus its backup-check role for the 3 server-cron stores (Reliance Digital, Vijay Sales, Sony Center). Use when developing/testing the local crawler, registering/removing its Task Scheduler entry, or viewing its dashboard.
---

The local crawler (`local-crawler/`) covers retailers the cPanel server can't reach (Akamai/PerimeterX-blocked, or quick-commerce stock that's purely location-driven). It runs a real headed Chromium via Playwright on this Windows machine, reports results to the same backend the cron worker writes to (`POST /stock/report`), and fires a Windows toast locally on a stock-in transition — in addition to the existing Expo push to the phone. Every run also appends to `local-crawler/logs/runs.jsonl`, viewable in the local dashboard (`dashboard.js`).

**Also backs up the 3 server-cron stores since 2026-06-30** (`checkers/relianceDigital.js`, `vijaySales.js`, `sonyCenter.js`, registered as `BACKUP_CHECKERS` in `index.js`) — these mirror the server-side PHP checkers' exact API calls (no browser needed, just axios from this machine's residential IP) but are only *run* for a listing when `GET /status` shows that listing's `last_status` is already `blocked` or `error`. This is deliberately conditional, not unconditional like `LOCAL_STORES` — checking a healthy listing too would race the cron worker and reintroduce the dual-poller clobbering bug already hit once (see `stock_poll_worker.php`'s docblock). The dashboard/mobile "Polled by" column shows `server cron (+ local backup)` for these 3 to reflect this.

## One-time setup

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; npm install
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; npx playwright install chromium
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; copy .env.example .env
```

Edit `.env`:
```
API_URL=https://shivarya.dev/ps5_tracker     # or http://localhost:8000 for local dev against `ps5-dev`'s PHP server
API_KEY=<same shared secret as server/.env's API_KEY; leave empty if server/.env's API_KEY is also empty>
DEFAULT_PINCODE=560067
HEADLESS=false                                # headed is less likely to be fingerprinted; set true once selectors are verified reliable
```

**Currently configured against production** (`API_URL=https://shivarya.dev/ps5_tracker`) — tracking 9 real listings. `npm run swiggy-login` once for Instamart (see below) before relying on it.

## Instamart — one-time Swiggy login (and again every ~5 days)

Instamart is covered by `checkers/instamartMcp.js`, which calls Swiggy's official Builders MCP API (`https://mcp.swiggy.com/builders/`) instead of a browser — `swiggy.com/instamart` confirmed-blocks even a real headed Playwright browser, but this is a sanctioned developer API. Requires logging in with a real Swiggy account:

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; npm run swiggy-login
```
Opens a browser — enter your phone number + OTP. On success, saves a token to `.swiggy_token.json` (gitignored). **Swiggy MCP v1.0 has no refresh-token grant** — the access token lasts 5 days, then this must be re-run manually. If a scheduled run logs `"No Swiggy MCP login found"` or `"access token expired"` in `logs/runs.jsonl`, that's the signal to re-run it. Address lookup for the tracked pincode is cached in `.swiggy_addresses.json` (gitignored) after the first successful run.

## Run once manually (for testing)

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; node index.js
```

This fetches `GET {API_URL}/status`, runs every listing whose `store` is `croma`, `flipkart`, `games_the_shop`, `amazon`, `blinkit`, or `instamart` unconditionally (`LOCAL_STORES`), plus any `reliance_digital`/`vijay_sales`/`sony_center` listing whose `last_status` is currently `blocked`/`error` (`BACKUP_CHECKERS` — see the intro above), batch-POSTs results to `/stock/report`, and fires a toast for any reported transition. All 6 `LOCAL_STORES` are verified working as of 2026-06-30 (see `CLAUDE.md`'s per-store table) — `error`/`blocked` on a given run usually means a genuine transient issue (Amazon's pincode-update endpoint rate-limits occasionally; Instamart needs a valid Swiggy login), not a broken selector.

## Dashboard

Auto-started at logon via the **`PS5TrackerDashboard`** Scheduled Task (`run-dashboard.cmd` → `node dashboard.js`, logged to `logs/dashboard.log`) — registered 2026-06-30, same pattern as the other two tasks below.

```powershell
schtasks /query /tn "PS5TrackerDashboard" /v /fo list   # status, last/next run time
schtasks /run /tn "PS5TrackerDashboard"                  # (re)start it
schtasks /end /tn "PS5TrackerDashboard"                  # stop it
```

To run it manually instead (e.g. testing, or before the task exists on a fresh machine):
```powershell
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; node dashboard.js
```
Open `http://localhost:5055`. Shows:
- **Add a tracked listing** — a form (store dropdown of all 9 stores, URL, optional product name, pincode) that `POST`s to `/api/listings`, which the dashboard server proxies to `{API_URL}/listings` with the `X-Api-Key` header attached server-side (the browser never sees `API_KEY`). Equivalent to running `add_listing.php`, just without a terminal.
- **Current listing status (all tracked listings)** — proxied live from `GET {API_URL}/status`, with a "Polled by" column (`local crawler` vs `server cron`) based on whether the store is one of the 6 local-crawler stores.
- **Recent crawler runs** — the last 50 logged runs; click a row to expand per-listing results for that run.

Auto-refreshes every 30s. `DASHBOARD_PORT` env var overrides the port.

## Scheduled task — registered, runs automatically

A Windows Scheduled Task named **`PS5TrackerLocalCrawler`** is already registered on this machine with two triggers: once at every logon, and then repeating every 30 minutes indefinitely. It runs `run.cmd` (which `cd`s into `local-crawler/` and runs `node index.js`, appending stdout/stderr to `logs/crawler.log`), as the `Ash` user, interactively (`InteractiveToken` logon type — required so the headed Chromium window can actually display).

```powershell
schtasks /query /tn "PS5TrackerLocalCrawler" /v /fo list   # status, last/next run time, last result code
schtasks /run /tn "PS5TrackerLocalCrawler"                  # trigger an out-of-band run right now
schtasks /delete /tn "PS5TrackerLocalCrawler" /f            # unregister (stops both the logon and 30-min triggers)
```

If it's ever missing (e.g. after `schtasks /delete`) or needs rebuilding from scratch — `Register-ScheduledTask`'s `-RepetitionDuration` rejects `[TimeSpan]::MaxValue` (produces an out-of-range duration string), and plain `Register-ScheduledTask` was denied (`Access is denied`) in this non-elevated shell even with valid params — re-create it via `schtasks.exe` (works without elevation) plus an XML edit for the second trigger:
```powershell
schtasks /create /tn "PS5TrackerLocalCrawler" /tr "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler\run.cmd" /sc minute /mo 30 /ru $env:USERNAME /it /f
schtasks /query /tn "PS5TrackerLocalCrawler" /xml > "$env:TEMP\ps5_task.xml"
# edit the exported XML: add a <LogonTrigger><UserId>ASH-GAMING-PC\Ash</UserId><Enabled>true</Enabled></LogonTrigger> entry inside <Triggers>
schtasks /create /tn "PS5TrackerLocalCrawler" /xml "$env:TEMP\ps5_task.xml" /f
```
(A `<Repetition>` with no `<Duration>` child repeats indefinitely — don't add one.)

**Two real gotchas hit registering `PS5TrackerDashboard` this way (2026-06-30), both worth knowing for any future task built with this pattern:**
1. **`<LogonTrigger>` needs an explicit `<UserId>` child or the import is denied.** A bare `<LogonTrigger><Enabled>true</Enabled></LogonTrigger>` (no `UserId`) registers an *any-user* logon trigger, which requires admin — `schtasks /create /xml` fails with `Access is denied` in a non-elevated shell even though plain `/sc minute` task creation works fine. Scoping it to `<UserId>ASH-GAMING-PC\Ash</UserId>` (matching `whoami`'s `DOMAIN\user` form) avoids the privilege check entirely and creates without elevation.
2. **Re-exported XML must stay UTF-16, or `schtasks /create /xml` rejects it.** `schtasks /query .. /xml >` always emits UTF-16; if that file gets rewritten through a UTF-8 tool (e.g. a plain text editor save), `schtasks /create` throws either a parse error (`unable to switch the encoding`) if the `encoding="UTF-8"` declaration is fixed to match, or a misleading generic `Access is denied` if the declaration still says `UTF-16` but the bytes are actually UTF-8. Always write the final XML back out as real UTF-16LE, e.g. in PowerShell: `[System.IO.File]::WriteAllText($path, $xmlString, [System.Text.Encoding]::Unicode)`.

## Logs

- `logs/crawler.log` — raw stdout/stderr from each scheduled run (via `run.cmd`'s redirect).
- `logs/runs.jsonl` — one JSON line per run: `{startedAt, finishedAt, checked: [{listing_id, store, product_name, url, status, http_status, error}], transitions, error}`. Trimmed to the last 500 runs automatically. This is what the dashboard reads.
- Task Scheduler's own history (Task Scheduler GUI → the task → History tab) shows trigger/start/stop/exit-code events but not stdout.

## Notes

- The server is the single source of truth for `last_status` and transition detection (`server/utils/stockResultProcessor.php`) — the crawler just reports raw check results and reacts to the `transitions` array the server hands back. It does not need direct DB access.
- All 6 local-crawler checkers (`croma.js`, `flipkart.js`, `gamesTheShop.js`, `amazon.js`, `blinkit.js`, `instamartMcp.js`) are verified against real PS5 listings via chrome-devtools MCP + real Playwright/MCP runs as of 2026-06-30 — see `CLAUDE.md`'s per-store table for the verified flow/selectors and known caveats per store (Amazon's intermittent pincode-AJAX rate-limit, Blinkit's unverified in-stock case, Instamart's 5-day token expiry). `instamart.js` (the original Playwright attempt) is a kept-for-reference dead file — `swiggy.com/instamart` confirmed-blocks even a real headed browser, so `index.js` uses `instamartMcp.js` instead.
- `games_the_shop` has a working generic body-text heuristic (mirrors `GamesTheShopChecker.php`) but no pincode-specific check — same limitation as the PHP fallback.
- A real bug was found and fixed during initial verification: `notifyTransitions()` in `server/utils/stockResultProcessor.php` used to `echo` debug lines, which corrupted `/stock/report`'s JSON response body when called from a web request (worked fine for the CLI cron worker, broke silently for this endpoint — axios fell back to returning the raw string instead of parsed JSON, so transitions were never detected). Now gated on `PHP_SAPI === 'cli'` vs `error_log()`.
- A second real bug: the server cron worker used to also poll Croma/Games The Shop/Flipkart/Amazon/Blinkit/Instamart with its own (broken/stub) PHP checkers, racing with the local crawler and clobbering correct results back to `error`. Fixed by removing those 6 stores from `stock_poll_worker.php`'s `STORE_CHECKERS` map entirely — the local crawler owns them exclusively now.
- A third real bug, found 2026-07-01: `croma.js` only knew how to click the pencil icon to open the pincode editor (for when a location was already cached from a prior visit). On a genuinely fresh browser session — which is every real scheduled run — Croma instead auto-shows the same modal immediately with no pencil icon yet, the click timed out, and the checker silently fell through to reading stock state from behind the still-open modal, against whatever pincode Croma had defaulted to rather than the tracked one (manifested as a wrong/unexpected pincode and a misleading `in_stock`). Fixed by checking whether `input.pinElem` is already visible before attempting the pencil-icon click. If you hit a similar "selector worked once but not in a scheduled run" bug elsewhere, suspect the same fresh-session-vs-cached-session UI difference first.
- A fourth real bug, found 2026-06-30 in response to the user asking "why croma showing in stock?": the explicit pincode set via Croma's modal isn't durable — their own client JS silently reverts the header/delivery widget to an IP-geolocation default (this machine's residential IP → a different city entirely, e.g. "Mumbai, 400049" instead of the tracked 560067) somewhere between ~1.5s and ~3s after clicking "Continue", non-deterministically. The old code did one blind `waitForTimeout(1500)` then scanned once — a coin flip on which side of that race it landed, with zero signal if it lost. Fixed by polling for the tracked pincode's digits to actually appear in page text before scanning, and reading stock markers from that *same* text snapshot (no gap between "pincode confirmed" and "stock read" for the revert to land in) — returns `error` instead of guessing if the pincode never gets confirmed within the poll window. Re-verified live: 4/4 fresh runs post-fix correctly held `Bengaluru, 560067` and the in_stock reports were genuine.
- A fifth real bug, found 2026-06-30 when the user reported "croma still shows in stock" a *second* time — worth re-investigating rather than assuming the fourth fix above already covered it, and it turned out to be a deeper, different bug: the generic "Buy Now"/"Add to Cart" text-presence heuristic was never actually pincode-aware in the first place. Confirmed live that even with the pincode correctly held at the tracked 560067 (i.e. *not* the fourth bug's revert race), the page simultaneously shows "Delivery at: Bengaluru, 560067. **Not Available for your pincode**" while "Buy Now"/"Add to Cart" text is still present elsewhere on the page (almost certainly an in-store-pickup/global-sellability signal, unrelated to home delivery). So the checker had been reporting `in_stock` for a product Croma was explicitly telling a real user it couldn't deliver to them — every single check, regardless of the fourth bug's fix. Fixed by checking the "Delivery at: ..." section specifically (`"not available for your pincode"` there → `out_of_stock`, its absence → `in_stock`); the generic Buy-Now/Sold-Out text scan is now only a fallback for when that delivery section can't be found at all. **General lesson, worth applying to the other local-crawler checkers too**: a generic "Buy Now"/"Add to Cart" presence check can be a global-sellability signal rather than a pincode-specific deliverability signal — prefer a site's explicit per-pincode delivery message when one exists, and don't assume a fix that addresses a *timing* bug (stale pincode) also addresses a *signal* bug (wrong thing being checked) — they can both be present on the same checker.
