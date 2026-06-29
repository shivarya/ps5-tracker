---
name: ps5-local-crawler
description: Install, run, schedule, and monitor the local Windows Playwright crawler for PS5 Tracker retailers blocked from shared hosting (Croma, Flipkart, Games The Shop, Amazon, Blinkit, Instamart). Use when developing/testing the local crawler, registering/removing its Task Scheduler entry, or viewing its dashboard.
---

The local crawler (`local-crawler/`) covers retailers the cPanel server can't reach (Akamai/PerimeterX-blocked, or quick-commerce stock that's purely location-driven). It runs a real headed Chromium via Playwright on this Windows machine, reports results to the same backend the cron worker writes to (`POST /stock/report`), and fires a Windows toast locally on a stock-in transition — in addition to the existing Expo push to the phone. Every run also appends to `local-crawler/logs/runs.jsonl`, viewable in the local dashboard (`dashboard.js`).

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

This fetches `GET {API_URL}/status`, filters to listings whose `store` is `croma`, `flipkart`, `games_the_shop`, `amazon`, `blinkit`, or `instamart`, runs each through its checker, batch-POSTs results to `/stock/report`, and fires a toast for any reported transition. All 6 stores are verified working as of 2026-06-30 (see `CLAUDE.md`'s per-store table) — `error`/`blocked` on a given run usually means a genuine transient issue (Amazon's pincode-update endpoint rate-limits occasionally; Instamart needs a valid Swiggy login), not a broken selector.

## Dashboard

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\local-crawler" ; node dashboard.js
```
Open `http://localhost:5055`. Shows:
- **Add a tracked listing** — a form (store dropdown of all 9 stores, URL, optional product name, pincode) that `POST`s to `/api/listings`, which the dashboard server proxies to `{API_URL}/listings` with the `X-Api-Key` header attached server-side (the browser never sees `API_KEY`). Equivalent to running `add_listing.php`, just without a terminal.
- **Current listing status (all tracked listings)** — proxied live from `GET {API_URL}/status`, with a "Polled by" column (`local crawler` vs `server cron`) based on whether the store is one of the 6 local-crawler stores.
- **Recent crawler runs** — the last 50 logged runs; click a row to expand per-listing results for that run.

Auto-refreshes every 30s. Not itself scheduled/auto-started — run it on demand when you want to check in or add a listing. `DASHBOARD_PORT` env var overrides the port.

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
# edit the exported XML: add a <LogonTrigger><Enabled>true</Enabled></LogonTrigger> entry inside <Triggers>
schtasks /create /tn "PS5TrackerLocalCrawler" /xml "$env:TEMP\ps5_task.xml" /f
```
(A `<Repetition>` with no `<Duration>` child repeats indefinitely — don't add one.)

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
