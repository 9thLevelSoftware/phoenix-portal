import { buildAllowedOrigins } from './corsOrigins.ts';

function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function getAllowedOrigins(): string[] {
  return buildAllowedOrigins(
    readEnv('APP_URL'),
    readEnv('ENVIRONMENT'),
    readEnv('SUPABASE_URL'),
  );
}

/**
 * Generate CORS headers with dynamic origin validation and security headers.
 * Returns the request's origin in Access-Control-Allow-Origin if it matches
 * the whitelist. Omits the header entirely for disallowed origins so browsers
 * reject the response without seeing a misconfigured empty value.
 *
 * Security headers added:
 * - X-Frame-Options: DENY (clickjacking protection)
 * - Content-Security-Policy (XSS mitigation). The header value sent is
 *   `default-src 'self'; connect-src 'self' https://*.paddle.com
 *   https://*.supabase.co https://api.phoenix-portal.com
 *   wss://api.phoenix-portal.com; script-src 'self' 'unsafe-inline';
 *   style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none';
 *   frame-ancestors 'none'`.
 *   The SPA Content-Security-Policy is a separate header and lives in
 *   `public/_headers`.
 * - Strict-Transport-Security: max-age=31536000 (HSTS for HTTPS enforcement)
 * - X-Content-Type-Options: nosniff (MIME sniffing protection)
 * - Referrer-Policy: strict-origin-when-cross-origin (privacy)
 *
 * MUST be used for all browser-facing Edge Functions.
 * Pass the Request object so the origin header can be validated.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const isAllowed = getAllowedOrigins().includes(origin);

  return {
    ...(isAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    // Browser callers send only POST (plus the OPTIONS preflight), and
    // garmin-webhook also serves GET. No caller sends PUT or DELETE.
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    // Lets browser clients read the wait on a 429/503 (PR 37 R-1).
    'Access-Control-Expose-Headers': 'Retry-After',
    'Vary': 'Origin',
    // Security headers
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://*.paddle.com https://*.supabase.co https://api.phoenix-portal.com wss://api.phoenix-portal.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // HSTS only in production
    ...(readEnv('ENVIRONMENT') === 'production'
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
}
