-- 2026-07-29: price-aware notifications.
--
-- Motivation: the PS5 disc edition's price roughly doubled at some retailers (Sony Center and
-- Vijay Sales both relisted it as a new SKU at Rs 69,990, Games The Shop Rs 69,990) while others
-- still sell it around Rs 54,990. An in_stock alert for a 70k listing isn't actionable, so the
-- push is now gated on price as well as stock.
--
-- last_price        — last price observed by a checker (NULL when the checker couldn't read one).
-- max_notify_price  — per-listing cap; NULL falls back to the global NOTIFY_MAX_PRICE (.env).
--                     Set this on listings that legitimately cost more than the global cap
--                     (e.g. the PS5 Pro, which is ~2x a Slim and would otherwise never alert).
-- stock_check_log.price — per-check history, so a price trend is reconstructable from the log.

ALTER TABLE tracked_listings
  ADD COLUMN last_price DECIMAL(10,2) NULL AFTER pincode,
  ADD COLUMN max_notify_price DECIMAL(10,2) NULL AFTER last_price;

ALTER TABLE stock_check_log
  ADD COLUMN price DECIMAL(10,2) NULL AFTER http_status;
