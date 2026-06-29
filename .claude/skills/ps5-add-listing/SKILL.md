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

## Not recommended — intentionally stubbed or unverified

| Store | Status |
|---|---|
| `croma` | Confirmed Akamai-blocked at the edge even for a bare HTML page request. Adding a listing here will just accumulate `blocked` rows. |
| `flipkart` | Checker is a stub returning `error`. A single anonymous request works, but any repeat request from the same IP gets `403`'d — unusable for repeated polling. |
| `amazon` | Checker is a stub returning `error`. Blocked on the very first request, no exceptions. |
| `games_the_shop` | Unverified HTML-heuristic fallback only — no real stock API captured yet (it's a custom Next.js storefront). |

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
