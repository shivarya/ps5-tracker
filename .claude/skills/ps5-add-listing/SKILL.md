---
name: ps5-add-listing
description: Register a new PS5 product URL to track (local or production), using the correct URL format for each verified store. Use when the user wants to add/track a new PS5 listing.
---

Adds a row to `tracked_listings` via the CLI script `server/scripts/add_listing.php`. There's no add/edit UI in the mobile app by design — listings are managed server-side only.

## Verified-working stores (use these with confidence)

| Store | URL format | Notes |
|---|---|---|
| `reliance_digital` | `https://www.reliancedigital.in/product/{slug}` | Pincode-aware. May intermittently report `blocked` from the production IP (Akamai-style detection) — backoff handles it. |
| `vijay_sales` | `https://www.vijaysales.com/p/{numeric-sku}/{slug}` | Pincode-aware. The most reliable of the three in production. **The numeric SKU must be in the URL** — it's extracted via regex. |
| `sony_center` | `https://shopatsc.com/products/{handle}` | Stock-only, no pincode check exists for this store (direct-ship storefront). |

## Not recommended for the server-side checker — covered by the local crawler instead

| Store | Status |
|---|---|
| `croma` | Confirmed Akamai-blocked at the edge even for a bare HTML page request. Adding a listing here will just accumulate `blocked` rows from the cron worker. Polled instead by the local Playwright crawler (`local-crawler/checkers/croma.js`, still best-effort — Akamai may still block a real browser). |
| `flipkart` | Server-side checker is a stub returning `error`. Polled instead by `local-crawler/checkers/flipkart.js` (selectors not yet live-verified). |
| `amazon` | Server-side checker is a stub returning `error`. Polled instead by `local-crawler/checkers/amazon.js` — hardest target even with a real browser, expect frequent `blocked`/`error`. |
| `games_the_shop` | Server-side checker is an unverified HTML-heuristic fallback only. Polled instead by `local-crawler/checkers/gamesTheShop.js`. |
| `blinkit`, `instamart` | No server-side checker exists at all (quick-commerce, purely location-driven stock) — only the local crawler covers these (`local-crawler/checkers/blinkit.js`, `instamart.js`, selectors not yet live-verified). |

Listings for these 6 stores are still added the same way via `add_listing.php` — the local crawler discovers them through `GET /status` and filters by store name. See the `ps5-local-crawler` skill for running/scheduling that crawler.

## Command

```powershell
cd "c:\Users\Ash\Documents\Projects\apps\ps5-tracker\server"
php scripts/add_listing.php --store=vijay_sales --url="https://www.vijaysales.com/p/252606/sony-playstationr5-disc-sa-e-edition-console-video-game-ps5r-slim" --pincode=560067 --name="PS5 Disc SA E Edition"
```

Run against production via SSH instead of locally:
```bash
ssh cpanel "cd ~/public_html/ps5_tracker && php scripts/add_listing.php --store=... --url='...' --pincode=560067 --name='...'"
```

The script upserts on the `url` unique key — re-running with the same URL just updates `product_name`/`pincode` rather than duplicating.

## Finding a real product URL

Use a web search (`site:reliancedigital.in PS5`, `site:vijaysales.com PS5 console`, etc.) or browse the store directly. For `vijay_sales`, double-check the numeric SKU actually appears in the `/p/{sku}/...` URL segment before adding it — the checker has no fallback if it's missing.
