<?php
/**
 * Sends push notifications via Expo's hosted push service. No SDK dependency
 * needed — it's a plain JSON POST endpoint.
 */
class ExpoPush
{
  /**
   * @param string[] $tokens
   * @return array Decoded Expo response (array of per-message tickets), or [] on transport failure.
   */
  public static function send(array $tokens, string $title, string $body, array $data = []): array
  {
    if (empty($tokens)) {
      return [];
    }

    $messages = array_map(fn($token) => [
      'to' => $token,
      'sound' => 'default',
      'title' => $title,
      'body' => $body,
      'data' => $data,
      'priority' => 'high',
    ], $tokens);

    $ch = curl_init();
    curl_setopt_array($ch, [
      CURLOPT_URL => EXPO_PUSH_URL,
      CURLOPT_CUSTOMREQUEST => 'POST',
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 15,
      CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Accept: application/json',
        'Accept-Encoding: gzip',
      ],
      CURLOPT_ENCODING => '',
      CURLOPT_POSTFIELDS => json_encode($messages),
    ]);
    $response = curl_exec($ch);
    $errno = curl_errno($ch);
    curl_close($ch);

    if ($errno || $response === false) {
      error_log('[expo-push] send failed: curl errno ' . $errno);
      return [];
    }

    $decoded = json_decode($response, true);
    return $decoded['data'] ?? [];
  }

  /**
   * Inspects Expo's push tickets and deactivates any device_tokens row whose
   * token came back DeviceNotRegistered (uninstalled app, revoked token, etc).
   */
  public static function deactivateStaleTokens(Database $db, array $tokens, array $tickets): void
  {
    foreach ($tickets as $i => $ticket) {
      if (($ticket['status'] ?? '') !== 'error') {
        continue;
      }
      if (($ticket['details']['error'] ?? '') === 'DeviceNotRegistered' && isset($tokens[$i])) {
        $db->execute('UPDATE device_tokens SET is_active = 0 WHERE expo_push_token = ?', [$tokens[$i]]);
      }
    }
  }
}
