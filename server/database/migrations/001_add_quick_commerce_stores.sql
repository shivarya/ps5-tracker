-- Adds Blinkit/Instamart to the tracked_listings.store ENUM (local Playwright crawler covers these).
ALTER TABLE tracked_listings
  MODIFY COLUMN store ENUM('reliance_digital','croma','vijay_sales','sony_center','games_the_shop','flipkart','amazon','blinkit','instamart') NOT NULL;
