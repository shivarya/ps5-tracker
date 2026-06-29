<?php
// Load .env file
$envFile = __DIR__ . '/../.env';
if (file_exists($envFile)) {
  $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
  foreach ($lines as $line) {
    if (strpos($line, '=') !== false && strpos($line, '#') !== 0) {
      list($name, $value) = explode('=', $line, 2);
      $_ENV[trim($name)] = trim($value);
      putenv(trim($name) . '=' . trim($value));
    }
  }
}

// Database configuration
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_PORT', getenv('DB_PORT') ?: '3306');
define('DB_NAME', getenv('DB_NAME') ?: 'ps5_tracker');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: '');

// Shared secret for write endpoints (no JWT — single-user personal tool)
define('API_KEY', getenv('API_KEY') ?: '');

define('DEFAULT_PINCODE', getenv('DEFAULT_PINCODE') ?: '560067');

// Expo push
define('EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send');

// Timezone
date_default_timezone_set('Asia/Kolkata');

// Error reporting
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/../php_errors.log');

// CORS settings (mobile app only — no web frontend)
define('ALLOWED_ORIGINS', [
  'http://localhost:19006',
  'http://localhost:8081',
  'exp://*',
]);
