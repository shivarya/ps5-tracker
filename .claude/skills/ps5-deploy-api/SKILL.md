---
name: ps5-deploy-api
description: Deploy the PS5 Tracker PHP backend to cPanel and verify it — upload server files, configure .env, import the DB schema, register tracked listings, set up the cron job, and health-check the live API. Use when deploying or updating the PS5 Tracker server.
---

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
   */5 * * * * /usr/local/bin/php /home/hm5pno1wummg/public_html/ps5_tracker/cron/stock_poll_worker.php >> /home/hm5pno1wummg/ps5_tracker_worker.log 2>&1
   ```
   **Always run `crontab -l` before and after touching the crontab on this host** to confirm other projects' cron entries (`expense_tracker`'s `gmail_sync_worker.php`, `cleanup-sessions.sh`) are still intact.

## Updating an existing deployment

1. Tarball + scp + extract the changed `server/` files into `~/public_html/ps5_tracker` (same as step 2 above — overwrites in place, `.env` is excluded from the tarball so it survives).
2. If `database/schema.sql` changed, write a numbered migration instead and apply it manually — don't re-run `schema.sql` against a live DB.

## Add tracked listings

```bash
ssh cpanel "cd ~/public_html/ps5_tracker && php scripts/add_listing.php --store=vijay_sales --url='https://www.vijaysales.com/p/<sku>/<slug>' --pincode=560067 --name='PS5 ...'"
```
See the `ps5-add-listing` skill for the per-store URL format and which stores are actually verified working.

## Verify

```powershell
Invoke-RestMethod https://shivarya.dev/ps5_tracker/health
Invoke-RestMethod https://shivarya.dev/ps5_tracker/status
```
Run the worker once manually via SSH (`php cron/stock_poll_worker.php`) and check `stock_check_log` for fresh rows before trusting cron timing alone.

## Troubleshooting

| Symptom | Check |
|---|---|
| Request returns the portfolio HTML instead of JSON | The `~/public_html/shivarya.dev/ps5_tracker` symlink is missing/broken — recreate it (see step 3) |
| "Disk quota exceeded" on file writes | `uapi --output=jsonpretty Quota get_quota_info` — almost certainly inodes, not MB; investigate before deleting anything |
| A checker reports `blocked` on every run | Expected for Croma/Flipkart/Amazon (confirmed Akamai/bot-blocked even from non-shared IPs); for Reliance Digital/Sony Center, the shared-hosting IP gets flagged more aggressively than a residential IP — backoff (`consecutive_failures` → `next_check_after`) handles this gracefully, no action needed |
| Push notifications never arrive | Confirm `device_tokens` has an active row (mobile app must have launched once and registered); check worker stdout for "no active push tokens registered" |
