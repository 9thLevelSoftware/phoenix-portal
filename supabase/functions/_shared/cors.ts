import { buildAllowedOrigins } from './corsOrigins.ts';

export {
  buildAllowedOrigins,
  isHostedSupabaseUrl,
  shouldAllowLocalhostOrigins,
} from './corsOrigins.ts';

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
  const isAllowed = getAllowedOrigins().includes(origin);

  return {
    ...(isAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
    'Vary': 'Origin',
    // Security headers
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://*.paddle.com https://*.supabase.co https://api.phoenix-portal.com wss://api.phoenix-portal.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // HSTS only in production
    ...(readEnv('ENVIRONMENT') === 'production'
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
  };
}
