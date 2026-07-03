-- Add md_computers to the store ENUM (MD Computers — mdcomputers.in, pan-India shipping,
-- local-crawler-only: Cloudflare blocks plain HTTP from shared hosting).
ALTER TABLE tracked_listings
  MODIFY COLUMN store ENUM(
    'reliance_digital','croma','vijay_sales','sony_center',
    'games_the_shop','flipkart','amazon','blinkit','instamart','zepto','md_computers'
  ) NOT NULL;
