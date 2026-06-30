ALTER TABLE tracked_listings
  ADD COLUMN edition ENUM('disc','digital','pro') NOT NULL DEFAULT 'digital' AFTER store;

-- Backfill existing rows from their product_name (set before this migration ran, so
-- "digital" default above is wrong for the disc-edition listings added earlier today).
-- Instamart's listing says "CD version" rather than "Disc"/"Standard" -- same thing,
-- different phrasing chosen when that listing was added.
UPDATE tracked_listings
SET edition = 'disc'
WHERE product_name LIKE '%Disc%' OR product_name LIKE '%Standard%' OR product_name LIKE '%CD version%';
