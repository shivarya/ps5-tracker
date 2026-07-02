-- Migration 003: add zepto to tracked_listings.store ENUM
ALTER TABLE tracked_listings
  MODIFY COLUMN store ENUM(
    'reliance_digital','croma','vijay_sales','sony_center',
    'games_the_shop','flipkart','amazon','blinkit','instamart','zepto'
  ) NOT NULL;
