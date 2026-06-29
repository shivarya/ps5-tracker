<?php
/**
 * Shared curl wrapper used by every store checker. Never throws on a bad
 * response — store checkers need to keep polling other listings even if one
 * store starts blocking, so transport/HTTP failures are returned as a normal
 * result shape instead of an exception.
 */
class HttpClient
{
  private const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/124.0.0.0',
  ];

  public static function randomUserAgent(): string
  {
    return self::USER_AGENTS[array_rand(self::USER_AGENTS)];
  }

  /** Random jitter delay before a request, in microseconds. */
  public static function jitter(int $minMs = 500, int $maxMs = 4000): void
  {
    usleep(random_int($minMs, $maxMs) * 1000);
  }

  /**
   * @param string $cookieJar Absolute path to a per-listing cookie jar file
   *   (persists session cookies across the seed GET + the AJAX check).
   * @return array{ok:bool, http_status:?int, body:string, error:?string}
   */
  public static function get(string $url, string $cookieJar, array $extraHeaders = [], ?string $referer = null): array
  {
    return self::request('GET', $url, $cookieJar, $extraHeaders, $referer, null);
  }

  public static function post(string $url, string $cookieJar, array $extraHeaders = [], ?string $referer = null, $body = null): array
  {
    return self::request('POST', $url, $cookieJar, $extraHeaders, $referer, $body);
  }

  private static function request(string $method, string $url, string $cookieJar, array $extraHeaders, ?string $referer, $body): array
  {
    $ch = curl_init();
    $headers = array_merge([
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      'Accept-Language: en-IN,en;q=0.9',
      'Upgrade-Insecure-Requests: 1',
    ], $extraHeaders);

    curl_setopt_array($ch, [
      CURLOPT_URL => $url,
      CURLOPT_CUSTOMREQUEST => $method,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_MAXREDIRS => 5,
      CURLOPT_TIMEOUT => 15,
      CURLOPT_CONNECTTIMEOUT => 10,
      CURLOPT_ENCODING => '', // auto-decompress gzip/deflate/br
      CURLOPT_USERAGENT => self::randomUserAgent(),
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_COOKIEJAR => $cookieJar,
      CURLOPT_COOKIEFILE => $cookieJar,
      CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($referer !== null) {
      curl_setopt($ch, CURLOPT_REFERER, $referer);
    }
    if ($body !== null) {
      curl_setopt($ch, CURLOPT_POSTFIELDS, is_array($body) ? json_encode($body) : $body);
    }

    $responseBody = curl_exec($ch);
    $httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $errno = curl_errno($ch);
    $error = $errno ? curl_error($ch) : null;
    curl_close($ch);

    if ($errno) {
      return ['ok' => false, 'http_status' => null, 'body' => '', 'error' => $error];
    }

    return ['ok' => true, 'http_status' => (int)$httpStatus, 'body' => (string)$responseBody, 'error' => null];
  }

  /** Heuristic CAPTCHA/bot-block detection shared across checkers. */
  public static function looksBlocked(int $httpStatus, string $body): bool
  {
    if (in_array($httpStatus, [403, 429, 503], true)) {
      return true;
    }
    $needles = ['captcha', 'unusual traffic', 'access denied', 'are you a robot', 'validateCaptcha'];
    $lower = strtolower($body);
    foreach ($needles as $needle) {
      if (str_contains($lower, strtolower($needle))) {
        return true;
      }
    }
    return false;
  }
}
