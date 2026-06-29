---
name: ps5-add-listing
description: Register a new PS5 product URL to track (local or production), using the correct URL format for each verified store. Use when the user wants to add/track a new PS5 listing.
---

Adds a row to `tracked_listings` via the CLI script `server/scripts/add_listing.php`, or via the local crawler's dashboard form (`node local-crawler/dashboard.js` → `http://localhost:5055` → "Add a tracked listing") for a no-terminal option. There's no add/edit UI in the mobile app by design — listings are managed server-side or via the dashboard only.

## Verified-working stores (use these with confidence)

| Store | URL format | Notes |
|---|---|---|
| `reliance_digital` | `https://www.reliancedigital.in/product/{slug}` | Pincode-aware. May intermittently report `blocked` from the production IP (Akamai-style detection) — backoff handles it. |
| `vijay_sales` | `https://www.vijaysales.com/p/{numeric-sku}/{slug}` | Pincode-aware. The most reliable of the three in production. **The numeric SKU must be in the URL** — it's extracted via regex. |
| `sony_center` | `https://shopatsc.com/products/{handle}` | Stock-only, no pincode check exists for this store (direct-ship storefront). |

## Not polled server-side — covered by the local crawler instead (all verified working, 2026-06-30/07-01)

| Store | Status |
|---|---|
| `croma` | Confirmed Akamai-blocked from shared hosting (bare curl gets a 403), but **a real headed browser is not blocked at all**. Verified working via the local crawler (`local-crawler/checkers/croma.js`). |
| `flipkart` | Verified working via the local crawler (`local-crawler/checkers/flipkart.js`) — real delivery-location flow, not a guess. |
| `amazon` | Verified working via the local crawler (`local-crawler/checkers/amazon.js`) — zero blocking hit with a real browser, contrary to the original "hardest target" assumption. Occasional intermittent rate-limit on the pincode-update step, handled gracefully. |
| `games_the_shop` | Verified working via the local crawler (`local-crawler/checkers/gamesTheShop.js`). |
| `blinkit` | Verified working via the local crawler (`local-crawler/checkers/blinkit.js`) for the out-of-stock case; in-stock marker inferred, not yet confirmed on a purchasable listing. No server-side checker exists at all for this store (quick-commerce, purely location-driven). |
| `instamart` | Verified working, but via **Swiggy's official Builders MCP API**, not browser automation (`swiggy.com/instamart` confirmed-blocks even a real headed browser) — `local-crawler/checkers/instamartMcp.js`. Requires a one-time (and every ~5 days) interactive Swiggy login: `npm run swiggy-login` in `local-crawler/`. No server-side checker exists at all for this store. |

Listings for these 6 stores are still added the same way via `add_listing.php` (or the dashboard form) — the local crawler discovers them through `GET /status` and filters by store name. For `instamart` specifically, set a descriptive `product_name` (e.g. "Sony PS5 1TB Slim CD version Single Controller Console") — there's no per-product lookup, only a search by query matched against `product_name`. See the `ps5-local-crawler` skill for running/scheduling that crawler.

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
