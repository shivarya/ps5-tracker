# cPanel Deployment Guide — PS5 Tracker API

## First-time setup

### 1. Database
- cPanel → **MySQL Databases** → create DB `hm5pno1wummg_ps5_tracker` + a user, grant ALL PRIVILEGES.
- Import schema once: `mysql -u hm5pno1wummg_<user> -p'<pass>' hm5pno1wummg_ps5_tracker < database/schema.sql`.

### 2. Code
- Deploy to `~/public_html/ps5_tracker` (top-level subfolder, matches the `expense_tracker` convention — not under `~/public_html/shivarya.dev/`).
- No Composer dependencies are required for v1 (plain curl, no Guzzle) — `composer install` is a no-op but harmless to run.

### 3. `.env`
Create `~/public_html/ps5_tracker/.env` (perms **600**):
```env
DB_HOST=localhost
DB_NAME=hm5pno1wummg_ps5_tracker
DB_USER=hm5pno1wummg_<user>
DB_PASS=<password>
API_KEY=<long random secret>
DEFAULT_PINCODE=560067
```

### 4. `.htaccess`
Ships with the repo — `RewriteBase /ps5_tracker/`, routes non-file requests to the absolute `/ps5_tracker/index.php`, blocks `.env`/dotfiles. Keep it intact.

### 5. Cron job
cPanel → Cron Jobs:
```
*/30 * * * * php ~/public_html/ps5_tracker/cron/stock_poll_worker.php >> ~/ps5_tracker_worker.log 2>&1
```
(Lowered from every 5 min to every 30 min — pairs with the local Playwright crawler, which runs on the same 30-min cadence from the user's Windows machine for retailers blocked on shared hosting; see `../local-crawler/`.)

### 6. Add tracked listings
SSH in, then:
```bash
cd ~/public_html/ps5_tracker
php scripts/add_listing.php --store=reliance_digital --url="https://..." --pincode=560067 --name="PS5 Slim Disc"
```

## Verify
```powershell
Invoke-RestMethod https://shivarya.dev/ps5_tracker/health
Invoke-RestMethod https://shivarya.dev/ps5_tracker/status
```
Run the worker once manually via SSH (`php cron/stock_poll_worker.php`) before trusting cron timing — confirms no fatal errors and that `stock_check_log` rows get written.

## Known follow-ups (not needed for v1)
- `stock_check_log` grows ~288 rows/day per listing; add a periodic cleanup (`DELETE WHERE checked_at < NOW() - INTERVAL 30 DAY`) once it matters.
- The worker log (`~/ps5_tracker_worker.log`) grows unbounded; rotate or truncate periodically.

## Troubleshooting

| Symptom | Check |
|---|---|
| **500 Internal Server Error** | cPanel → Errors / `php_errors.log`; `.htaccess` syntax; `.env` exists with valid DB creds |
| **Database connection failed** | `.env` creds; user privileges in cPanel → MySQL Databases |
| **API route returns the portfolio HTML / 404** | `.htaccess` `RewriteEngine`/`RewriteBase` intact; deployed to `~/public_html/ps5_tracker` |
| **Cron runs but no rows in `stock_check_log`** | run the worker manually via SSH to see the error directly; check `consecutive_failures`/`next_check_after` isn't skipping every listing |
| **Push notifications never arrive** | confirm `device_tokens` has an active row (mobile app registered); check worker output for "no active push tokens registered" |
