-- PS5 Tracker schema

CREATE TABLE IF NOT EXISTS tracked_listings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  store ENUM('reliance_digital','croma','vijay_sales','sony_center','games_the_shop','flipkart','amazon','blinkit','instamart') NOT NULL,
  edition ENUM('disc','digital','pro') NOT NULL DEFAULT 'digital',
  url VARCHAR(1000) NOT NULL,
  product_name VARCHAR(255) NULL,
  pincode VARCHAR(10) NOT NULL DEFAULT '560067',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_status ENUM('unknown','in_stock','out_of_stock','blocked','error') NOT NULL DEFAULT 'unknown',
  last_checked_at DATETIME NULL,
  last_status_changed_at DATETIME NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  next_check_after DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_url (url)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expo_push_token VARCHAR(255) NOT NULL,
  device_label VARCHAR(100) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_token (expo_push_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_check_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  listing_id INT NOT NULL,
  checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result ENUM('in_stock','out_of_stock','blocked','error') NOT NULL,
  http_status INT NULL,
  response_snippet TEXT NULL,
  notified TINYINT(1) NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  FOREIGN KEY (listing_id) REFERENCES tracked_listings(id) ON DELETE CASCADE,
  INDEX idx_listing_checked (listing_id, checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
