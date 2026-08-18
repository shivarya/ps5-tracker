---
name: ps5-add-listing
description: Register a new PS5 product URL to track (local or production), using the correct URL format for each verified store. Use when the user wants to add/track a new PS5 listing.
---

> ⚠️ **SUNSET (2026-08-18)** — this app is decommissioned, see [`../../../SUNSET.md`](../../../SUNSET.md). Adding a listing now has no effect — nothing polls `tracked_listings` anymore.

Adds a row to `tracked_listings` via the CLI script `server/scripts/add_listing.php`, or via the local crawler's dashboard form (`node local-crawler/dashboard.js` → `http://localhost:5055` → "Add a tracked listing") for a no-terminal option. There's no add/edit UI in the mobile app by design — listings are managed server-side or via the dashboard only.

Every listing also has an optional **`max_notify_price`** (`--max-price=` / the dashboard's "Max notify price" field / `max_notify_price` in the POST body). Leave it blank to use the global `NOTIFY_MAX_PRICE` cap from `server/.env` (₹60,000) — an in_stock transition above the cap is logged but never pushed. **Set it explicitly for anything that legitimately costs more than the global cap, most obviously a PS5 Pro**, or that listing will be tracked but can never alert. See the "Price-gated notifications" section of the project `CLAUDE.md`.

Every listing also has an `edition`: `disc`, `digital`, or `pro` (defaults to `digital` if omitted). Both the mobile app and the dashboard filter/group by this — get it right when adding a listing, since there's no separate "fix the edition" flow beyond re-running `add_listing.php`/the form with `--edition`/an explicit edition and the same URL (upserts on the `url` unique key). **Verify the edition live before adding** — don't trust a search engine's title alone. A store's generic "Buy Now"/"Add to Cart" text is not edition-specific; check the actual page content (model number, SKU, price point — disc/pro editions are reliably priced higher than digital) the same way the Croma stock-signal bug in this project was diagnosed.

## Verified-working stores (use these with confidence)

| Store | URL format | Notes |
|---|---|---|
| `reliance_digital` | `https://www.reliancedigital.in/product/{slug}` | Pincode-aware. May intermittently report `blocked` from the production IP (Akamai-style detection) — backoff handles it. |
| `vijay_sales` | `https://www.vijaysales.com/p/{numeric-sku}/{slug}` | Pincode-aware. The most reliable of the three in production. **The numeric SKU must be in the URL** — it's extracted via regex. |
| `sony_center` | `https://shopatsc.com/products/{handle}` | Stock-only, no pincode check exists for this store (direct-ship storefront). Shopify 429s (`local_rate_limited`) if the `.json` endpoint is hit repeatedly in a short window — the checker retries with backoff; a lone 429 in the log is not a dead URL. |

**Store URLs go stale — verify before assuming a checker broke.** Retailers reissue PS5 SKUs at new URLs when the price changes and the old one dies (2026-07-29: Vijay Sales' disc URL started 302ing to `/c/gaming`, and both Sony Center URLs 404'd). To find the current URL: `shopatsc.com/products.json?limit=250&page=N` for Sony Center (plain curl works, includes price and `available`), and the `/c/gaming-consoles` category page in a real browser for Vijay Sales — its `/search?q=` is client-rendered and returns games only, never the console.

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
php scripts/add_listing.php --store=vijay_sales --url="https://www.vijaysales.com/p/259648/sony-playstationr5-sa-e-disc-edition-gaming-console-ps5r-slim" --edition=disc --pincode=560067 --name="PS5 Slim Disc Edition (SA E)"
```

To repoint an existing listing at a relisted URL without losing its history, `PUT /listings/{id}` accepts `url` (and `max_notify_price`, `is_active`, `pincode`, `product_name`, `edition`) — better than adding a new row, which would restart the listing's `stock_check_log`.

Run against production via SSH instead of locally:
```bash
ssh cpanel "cd ~/public_html/ps5_tracker && php scripts/add_listing.php --store=... --url='...' --edition=disc --pincode=560067 --name='...'"
```

## PS5 Pro availability (checked 2026-06-30)

Only **Amazon** (`https://www.amazon.in/Sony-PlayStation-Pro-2TB-SSD/dp/B0H3BP5RB3`, Sony's official storefront) carries a genuine PS5 Pro listing in India right now — verified live (real box art, "Visit the Sony Store" link), currently shows "Currently unavailable". Reliance Digital, Croma, Vijay Sales, Sony Center, Games The Shop, Blinkit, and Instamart have **no real PS5 Pro listing at all** as of this check. Flipkart's search results for "PS5 Pro" are grey-market reseller spam (nonsense SEO-stuffed titles, ~2x official pricing, one candidate URL outright 404'd) — don't add those. Re-check store-by-store if asked to add PS5 Pro again later; this could change as Sony expands India availability.

The script upserts on the `url` unique key — re-running with the same URL just updates `product_name`/`pincode` rather than duplicating.

## Finding a real product URL

Use a web search (`site:reliancedigital.in PS5`, `site:vijaysales.com PS5 console`, etc.) or browse the store directly. For `vijay_sales`, double-check the numeric SKU actually appears in the `/p/{sku}/...` URL segment before adding it — the checker has no fallback if it's missing.
