# PS5 Tracker — Sunset

**Status: decommissioned 2026-08-18.** Nothing is polling any retailer for this app anymore. This doc is the record of what was stopped, what still exists (dormant), and how to bring it back if ever needed. The generalized pattern behind this app — reusable for tracking any other product's stock/price across multiple sites — is written up separately at [`../docs/stock-availability-tracker-pattern.md`](../docs/stock-availability-tracker-pattern.md); read that first if the goal is to build something *new* rather than resurrect this one.

The rest of [`CLAUDE.md`](CLAUDE.md) is left intact below the sunset banner — it's the detailed build history (per-retailer checker implementations, bugs found and fixed, architecture) and remains accurate as a record of what was built, just not of what's currently running.

## What was actually stopped (2026-08-18)

**Local machine (this Windows PC):**
- Deleted all 3 Scheduled Tasks: `PS5TrackerLocalCrawler`, `PS5TrackerDevServer`, `PS5TrackerDashboard` (`schtasks /delete /tn "<name>" /f`). None will fire at next logon or on their interval anymore.
- Killed the 3 processes that were live at the time: the crawler (`node index.js`, plus its headed Chromium process tree), the local PHP dev server (`php -S 0.0.0.0:8000`), and the dashboard (`node dashboard.js`, port 5055).

**Production (`shivarya.dev` cPanel):**
- Removed the cron entry that ran `cron/stock_poll_worker.php` from the `hm5pno1wummg` crontab. The other 4 unrelated cron jobs on that account (expense-tracker's Gmail sync, citypata session cleanup, server health monitor, medimention) were left untouched — edited via a full `crontab -l` → edit → `crontab -` round trip, not a blind append/remove.
- **Accuracy note found while doing this**: `CPANEL_DEPLOYMENT.md` and `CLAUDE.md` both claim the live cadence was lowered to every 30 min, but the actual crontab entry removed was still `*/15 * * * *`. The docs were stale — worth knowing if this is ever resurrected and cadence matters.

## What still exists (dormant, not deleted)

- **Deployed PHP code + `.env`** at `~/public_html/ps5_tracker/` on cPanel — untouched, still reachable over HTTP (routes still respond; nothing calls them anymore on a schedule).
- **MySQL database** `hm5pno1wummg_ps5_tracker` — all tables (`tracked_listings`, `stock_check_log`, `device_tokens`) intact with their last real data.
- **Local repo** (`local-crawler/`, `server/`, `mobile/`) — untouched on disk, still under git.
- **Sideloaded Android APK** on the phone — will still launch and can still call the (still-live) `/status` endpoint, but will only ever show whatever `last_status`/`last_price` was as of 2026-08-18, since nothing updates it anymore. Harmless to leave installed or uninstall at your convenience.
- **Firebase project** (`ps5-tracker-e7d7e`, for Expo push) and **EAS project** (`@shivarya3/ps5-tracker-mobile`) — untouched, unused now that nothing triggers a push.
- **Swiggy MCP OAuth token** (`local-crawler/.swiggy_token.json`, gitignored) — was already stale (5-day expiry, last login long past); irrelevant now.
- **`play-deploy/config/apps.json`**'s `ps5-tracker` entry — was already `active: false` (never Play-published, sideload-only by design); `notes` field updated to mention the sunset for accuracy, no functional change.

## How to resurrect this, if ever needed

1. **Production cron**: SSH in (`scripts/connect_ssh.ps1` at the workspace root) and re-add a line to the crontab:
   ```
   */15 * * * * /usr/local/bin/php ~/public_html/ps5_tracker/cron/stock_poll_worker.php >> ~/ps5_tracker_worker.log 2>&1
   ```
   (Use `crontab -l`, append, `crontab -` — don't overwrite the other jobs on that account.) The deployed code and DB are already there and current as of the sunset date; no redeploy needed unless the local repo has since diverged from what's on the server.
2. **Local crawler + dev server + dashboard**: re-register the 3 Scheduled Tasks. The `ps5-local-crawler` skill (`.claude/skills/ps5-local-crawler/SKILL.md`) documents the exact `schtasks /create` incantation and the two XML-import gotchas (explicit `<UserId>` on the logon trigger, UTF-16LE encoding) hit building these the first time — follow that rather than re-deriving it.
3. **Mobile app**: already installed; will pick back up live data as soon as the server starts getting polled again. Re-run `npm run swiggy-login` in `local-crawler/` if Instamart coverage matters (token will have long since expired).
4. Check `tracked_listings` for dead URLs before trusting anything — retailers reissue SKUs under new URLs periodically (see the "Listing URL audit" section in `CLAUDE.md`); anything untouched since 2026-08-18 is more likely stale than not.

## Why sunset

Owner decision, 2026-08-18 — no longer needed as a running service. The technical approach (see the pattern doc) was considered worth preserving and generalizing even though this specific instance is being retired.
