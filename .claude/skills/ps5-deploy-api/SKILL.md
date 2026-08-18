---
name: ps5-deploy-api
description: Deploy the PS5 Tracker PHP backend to cPanel and verify it — upload server files, configure .env, import the DB schema, register tracked listings, set up the cron job, and health-check the live API. Use when deploying or updating the PS5 Tracker server.
---

> ⚠️ **SUNSET (2026-08-18)** — this app is decommissioned, see [`../../../SUNSET.md`](../../../SUNSET.md). The production cron job has been removed; redeploying would put code back in place but nothing polls it anymore unless the cron entry is re-added too.

Deploy the PS5 Tracker **PHP** API (`server/`) to cPanel at `https://shivarya.dev/ps5_tracker/`. Backend is PHP + MySQL (front-controller `index.php` with `.htaccess`), no Composer dependencies (plain curl, no Guzzle). Single-user personal tool — no JWT, just a shared `X-Api-Key` header on write routes.

**Host (GoDaddy cPanel):** SSH via `ssh cpanel` (configured alias) or the root helper `connect_ssh.ps1`. cPanel user `hm5pno1wummg`, PHP 8.4 on `/usr/local/bin/php`.

⚠️ **Deploy path gotcha**: unlike `diet_plan`/`split_cash` (which live directly under `~/public_html/shivarya.dev/`), `ps5_tracker` follows the `expense_tracker` pattern — **real code lives at the top-level `~/public_html/ps5_tracker`**, with a **symlink** `~/public_html/shivarya.dev/ps5_tracker -> /home/hm5pno1wummg/public_html/ps5_tracker` so it resolves under the `shivarya.dev` domain. Deploying only under `shivarya.dev/` without the top-level folder + symlink will 404 or get shadowed by the portfolio SPA.

⚠️ **Inode quota gotcha**: this account has hit its 250,000 **inode** (file count) limit before, not a megabyte limit — `citypata/` is the largest consumer. If any file write fails with "Disk quota exceeded" during deploy, check `uapi Quota get_quota_info` first; it's almost always inodes, not MB. Don't delete anything in other projects' directories without asking first.

## First-time setup (already done for the initial deploy — see below if redoing from scratch)

1. **Database**: cPanel → MySQL Databases (or `uapi Mysql create_database name=ps5Tracker` / `create_user` / `set_privileges_on_database` over SSH) — this host's DB names do **not** need the cPanel-user prefix (e.g. `ps5Tracker`, `dietPlan`, `budgetTracker` all exist unprefixed).
2. **Code**: tarball the `server/` folder (exclude `.env`, `vendor`, `*.log`), scp to the host, extract into `~/public_html/ps5_tracker`.
3. **Symlink**: `ln -s /home/hm5pno1wummg/public_html/ps5_tracker /home/hm5pno1wummg/public_html/shivarya.dev/ps5_tracker`
4. **`.env`** on the host (chmod 600, never upload your local one):
   ```env
   DB_HOST=localhost
   DB_NAME=ps5Tracker
   DB_USER=ps5_tracker_user
   DB_PASS=<password>
   API_KEY=<long random secret>
   DEFAULT_PINCODE=560067
   ```
5. **Import schema**: `mysql -u ps5_tracker_user -p'<pass>' ps5Tracker < database/schema.sql`
6. **Cron job** — cPanel → Cron Jobs (UI is safer than `crontab -l | ... | crontab -` piping over SSH, which has bitten this account before by silently wiping unrelated existing cron entries if the pipe chain mis-quotes):
   ```
   */30 * * * * /usr/local/bin/php /home/hm5pno1wummg/public_html/ps5_tracker/cron/stock_poll_worker.php >> /home/hm5pno1wummg/ps5_tracker_worker.log 2>&1
   ```
   **Always run `crontab -l` before and after touching the crontab on this host** to confirm other projects' cron entries (`expense_tracker`'s `gmail_sync_worker.php`, `cleanup-sessions.sh`, the server health monitor) are still intact. (Lowered from `*/5` on 2026-06-29 — pairs with the local crawler's 30-min cadence, see below.)

## Updating an existing deployment

1. Tarball (exclude `.env`, `vendor`, `*.log`) + scp + extract the changed `server/` files into `~/public_html/ps5_tracker` — overwrites in place, `.env` is excluded so it survives:
   ```bash
   tar -czf /tmp/ps5_server_deploy.tar.gz --exclude='server/.env' --exclude='server/vendor' --exclude='server/*.log' -C "c:/Users/Ash/Documents/Projects/apps/ps5-tracker" server
   scp -i ~/.ssh/cpanel_key /tmp/ps5_server_deploy.tar.gz hm5pno1wummg@<host>:~/ps5_server_deploy.tar.gz
   ssh cpanel "cd ~/public_html/ps5_tracker && tar -xzf ~/ps5_server_deploy.tar.gz --strip-components=1 -C . && rm ~/ps5_server_deploy.tar.gz"
   ```
2. If `database/schema.sql` changed, write a numbered migration in `database/migrations/` instead and apply it manually — don't re-run `schema.sql` against a live DB. Apply without ever printing the DB password into the terminal/transcript:
   ```bash
   ssh cpanel "cd ~/public_html/ps5_tracker && eval \$(grep -E '^DB_' .env | sed 's/^/export /') && mysql -u \"\$DB_USER\" -p\"\$DB_PASS\" \"\$DB_NAME\" < database/migrations/00N_name.sql"
   ```
3. After deploying, verify with a read-only check rather than a destructive/state-changing one — e.g. `grep -c 'blinkit' controllers/listingsController.php` over SSH to confirm a specific change landed, rather than running the worker manually (which can send a real push notification).

## Add tracked listings

```bash
ssh cpanel "cd ~/public_html/ps5_tracker && php scripts/add_listing.php --store=vijay_sales --url='https://www.vijaysales.com/p/<sku>/<slug>' --pincode=560067 --name='PS5 ...'"
```
See the `ps5-add-listing` skill for the per-store URL format and which stores are actually verified working.

## Verify

```powershell
Invoke-RestMethod https://shivarya.dev/ps5_tracker/health
Invoke-RestMethod https://shivarya.dev/ps5_tracker/status
Invoke-RestMethod https://shivarya.dev/ps5_tracker/stock/report -Method POST -Body '{}' -ContentType 'application/json'  # expect 401 (route exists, auth required), not 404
```
Run the worker once manually via SSH (`php cron/stock_poll_worker.php`) and check `stock_check_log` for fresh rows before trusting cron timing alone — but note this can send a real push notification on a transition, so prefer the read-only checks above when just confirming a deploy landed.

## Local crawler dependency (`local-crawler/`, runs on the user's Windows machine, not this server)

The local Playwright crawler (see the `ps5-local-crawler` skill) reports results to `POST /stock/report` on this same API. If that endpoint's code changes here, redeploy before assuming the local crawler is broken — it'll get a `404` and silently discard a run's results otherwise (a real bug hit during initial rollout, 2026-06-29: the endpoint existed locally but `local-crawler/.env` was pointed at production before the matching server code was deployed).

Server-side `cron/stock_poll_worker.php`'s `STORE_CHECKERS` map only covers `reliance_digital`/`vijay_sales`/`sony_center` — Croma/Games The Shop/Flipkart/Amazon/Blinkit/Instamart are deliberately excluded (not just "expected blocked") because the local crawler owns those exclusively now. Don't re-add them to that map without removing them from `LOCAL_STORES` in `local-crawler/index.js` first, or the two sides will race and clobber each other's results (real bug hit and fixed 2026-06-30).

## Troubleshooting

| Symptom | Check |
|---|---|
| Request returns the portfolio HTML instead of JSON | The `~/public_html/shivarya.dev/ps5_tracker` symlink is missing/broken — recreate it (see step 3) |
| "Disk quota exceeded" on file writes | `uapi --output=jsonpretty Quota get_quota_info` — almost certainly inodes, not MB; investigate before deleting anything |
| Reliance Digital / Vijay Sales / Sony Center report `blocked` occasionally | The shared-hosting IP gets flagged more aggressively than a residential IP — backoff (`consecutive_failures` → `next_check_after`) handles this gracefully. Additionally, since 2026-06-30 the local crawler runs a backup check for these 3 stores whenever it sees `blocked`/`error` from the server (see the `ps5-local-crawler` skill's `BACKUP_CHECKERS` section) — usually rescues within one local-crawler cycle (≤30 min), no manual action needed either way. Croma/Games The Shop/Flipkart/Amazon/Blinkit/Instamart are NOT polled by this server at all (see above) — if one of those shows stale data, the issue is on the local crawler side, not here. |
| `/stock/report` returns `404` | Server-side code (`controllers/stockReportController.php`, `utils/stockResultProcessor.php`, the route in `index.php`) hasn't been deployed yet — see "Updating an existing deployment" above |
| Push notifications never arrive | First check the **price gate** (added 2026-07-29): `stock_check_log` will show `result='in_stock', notified=0` and the worker log a "above cap … push suppressed" line when a listing went in stock above its cap. Raise `NOTIFY_MAX_PRICE` in `.env` or set that listing's `max_notify_price`. Otherwise confirm `device_tokens` has an active row (mobile app must have launched once and registered); check worker stdout for "no active push tokens registered" |
| Deploying a `/stock/report` change | The crawler now reads a `notified` flag off each returned transition to decide whether to fire its Windows toast. It treats a *missing* flag as "notify" so an older API doesn't silence toasts — but deploy the server before assuming a suppressed toast is a bug. |
