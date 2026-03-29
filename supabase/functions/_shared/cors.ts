const ALLOWED_ORIGINS: string[] = (() => {
  const appUrl = Deno.env.get('APP_URL');
  const origins: string[] = appUrl ? [appUrl] : [];
  // Always allow localhost in non-production
  if (Deno.env.get('ENVIRONMENT') !== 'production') {
    origins.push('http://localhost:5173', 'http://localhost:3000');
  }
  return origins;
})();

/**
 * Generate CORS headers with dynamic origin validation and security headers.
 * Returns the request's origin in Access-Control-Allow-Origin if it matches
 * the whitelist. Omits the header entirely for disallowed origins so browsers
 * reject the response without seeing a misconfigured empty value.
 *
 * Security headers added:
 * - X-Frame-Options: DENY (clickjacking protection)
 * - Content-Security-Policy: default-src 'self' (XSS mitigation)
 * - Strict-Transport-Security: max-age=31536000 (HSTS for HTTPS enforcement)
 * - X-Content-Type-Options: nosniff (MIME sniffing protection)
 * - Referrer-Policy: strict-origin-when-cross-origin (privacy)
 *
 * MUST be used for all browser-facing Edge Functions.
 * Pass the Request object so the origin header can be validated.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    ...(isAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
    'Vary': 'Origin',
    // Security headers
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://*.paddle.com https://*.supabase.co; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // HSTS only in production
    ...(Deno.env.get('ENVIRONMENT') === 'production'
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
}

/**
 * Static CORS headers for non-browser endpoints (webhooks, cron).
 * Uses APP_URL directly. Prefer getCorsHeaders(req) for browser-facing functions.
 * Includes basic security headers for webhook endpoints.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'http://localhost:5173',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
