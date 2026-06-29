<?php
function handleDevicesRoutes(string $uri, string $method): void
{
    $db = getDB();

    if ($uri === '/devices/register' && $method === 'POST') {
        $input = getJsonInput();
        $errors = validateRequired($input, ['expoPushToken']);
        if (!empty($errors)) {
            Response::error('Validation failed', 422, $errors);
        }
        $token = (string)$input['expoPushToken'];
        $label = $input['deviceLabel'] ?? null;

        $db->execute(
            "INSERT INTO device_tokens (expo_push_token, device_label, is_active, last_seen_at)
             VALUES (?, ?, 1, NOW())
             ON DUPLICATE KEY UPDATE device_label = VALUES(device_label), is_active = 1, last_seen_at = NOW()",
            [$token, $label]
        );
        Response::success(null, 'Device registered');
    }

    Response::error('Route not found', 404);
}
