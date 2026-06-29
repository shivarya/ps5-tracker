<?php
class Response
{
  public static function success($data = null, $message = null, $statusCode = 200)
  {
    http_response_code($statusCode);
    echo json_encode([
      'success' => true,
      'data' => $data,
      'message' => $message
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  public static function error($message, $statusCode = 400, $errors = null)
  {
    http_response_code($statusCode);
    $response = [
      'success' => false,
      'error' => $message
    ];
    if ($errors !== null) {
      $response['errors'] = $errors;
    }
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }
}

// Helper function to get JSON input
function getJsonInput()
{
  $input = file_get_contents('php://input');
  return json_decode($input, true) ?? [];
}

// Helper function to validate required fields
function validateRequired($data, $fields)
{
  $errors = [];
  foreach ($fields as $field) {
    if (!isset($data[$field]) || $data[$field] === '') {
      $errors[$field] = ucfirst($field) . ' is required';
    }
  }
  return $errors;
}

// Checks the X-Api-Key header against the configured API_KEY. Single shared
// secret is enough here — this is a personal single-user tool, not multi-tenant.
function requireApiKey(): void
{
  if (API_KEY === '') {
    return; // not configured (e.g. local dev) — skip the check
  }
  $headers = function_exists('getallheaders') ? getallheaders() : [];
  $provided = $headers['X-Api-Key'] ?? $_SERVER['HTTP_X_API_KEY'] ?? '';
  if (!hash_equals(API_KEY, (string)$provided)) {
    Response::error('Unauthorized', 401);
  }
}
