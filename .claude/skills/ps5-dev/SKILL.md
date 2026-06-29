---
name: ps5-dev
description: Run the PS5 Tracker app locally — start the PHP API and the Expo mobile app, and run the cron poller once manually. Use to develop or test ps5-tracker.
---

Start the PS5 Tracker backend and mobile app for local development.

## One-time setup

1. **Server env**: `cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\server" ; copy .env.example .env` — set `DB_*`, leave `API_KEY` empty for local dev (skips the write-route auth check).
2. **Database**: ensure MySQL/MariaDB is running (XAMPP: `D:\xampp\mysql\bin\mysqld.exe --defaults-file=D:\xampp\mysql\bin\my.ini`), then:
   ```powershell
   & "D:\xampp\mysql\bin\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS ps5_tracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   cmd /c '"D:\xampp\mysql\bin\mysql.exe" -u root ps5_tracker < "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\server\database\schema.sql"'
   ```
3. **Mobile deps**: `cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\mobile" ; npm install --legacy-peer-deps`

## Run

1. **PHP API** — already auto-started on this machine via the `PS5TrackerDevServer` Windows Scheduled Task (logon trigger, runs `server/run-dev-server.cmd` → `php -S localhost:8000`, output logged to `server/ps5_tracker_dev_server.log`). Check/restart it instead of starting a second instance manually:
   ```powershell
   schtasks /query /tn "PS5TrackerDevServer" /v /fo list   # Status should be "Running"
   schtasks /end /tn "PS5TrackerDevServer"                  # stop it
   schtasks /run /tn "PS5TrackerDevServer"                  # (re)start it
   ```
   If it's not registered (e.g. fresh machine), start it manually instead:
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\server" ; php -S localhost:8000
   ```
   Verify either way: `Invoke-RestMethod http://localhost:8000/health`
2. **Add a test listing** (see the `ps5-add-listing` skill for the full per-store URL format):
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\server" ; php scripts/add_listing.php --store=vijay_sales --url="https://www.vijaysales.com/p/<sku>/<slug>" --pincode=560067 --name="Test listing"
   ```
3. **Run the poller once manually** (normally cron-driven every 30 min in prod):
   ```powershell
   cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\server" ; php cron/stock_poll_worker.php
   ```
4. **Mobile app**: `cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\mobile" ; npm start` (set `app.json` `extra.apiUrlDev` to your local API URL if testing on a device/emulator that can't reach `localhost` directly — e.g. via `adb reverse tcp:8000 tcp:8000`).

## Notes

- No login/auth in this app — it's a personal single-user tool. `API_KEY` only gates write routes (`POST/PUT/DELETE /listings`, `POST /devices/register`); leave empty locally.
- Of the 7 PHP store checkers in `server/utils/storeCheckers/`, only **Reliance Digital, Vijay Sales, Sony Center** are wired into the cron worker (`stock_poll_worker.php`'s `STORE_CHECKERS` map) — that's a deliberate exclusion, not an oversight: **Croma, Flipkart, Amazon** PHP checkers are intentionally stubbed/blocked from shared hosting (confirmed Akamai/bot-blocked even from a clean dev IP) and **Games The Shop**'s PHP checker is an unverified HTML-heuristic fallback. See `utils/storeCheckers/*.php` docblocks.
- Croma/Flipkart/Games The Shop/Amazon plus quick-commerce (Blinkit/Instamart) are instead covered by the local Playwright crawler (`local-crawler/`) — **all 6 verified working there** via a real browser (Croma/Amazon turned out to NOT be blocked at all once you're not on shared hosting; Instamart specifically uses Swiggy's official MCP API instead of a browser, since that one genuinely is blocked even headed). See the `ps5-local-crawler` skill, which also runs on this machine via a logon-triggered Scheduled Task (`PS5TrackerLocalCrawler`) and depends on `PS5TrackerDevServer` being up to have anything to report to — though it currently targets production (`local-crawler/.env`), not this local dev server.
- If `PS5TrackerDevServer` is ever missing and needs re-registering: `schtasks /create` with `/sc onlogon` was denied (`Access is denied`) in this non-elevated shell, and a long-running server task also needs `ExecutionTimeLimit` set to `PT0S` (no limit) so Task Scheduler doesn't kill it after the default time budget. Create it with a throwaway `/sc minute` schedule first (works without elevation), then export/edit/reimport the XML to swap in a `<LogonTrigger>` and `<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>` — same approach documented in the `ps5-local-crawler` skill for `PS5TrackerLocalCrawler`.
