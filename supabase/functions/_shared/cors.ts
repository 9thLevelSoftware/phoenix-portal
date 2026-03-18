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
 * Generate CORS headers with dynamic origin validation.
 * Returns the request's origin in Access-Control-Allow-Origin if it matches
 * the whitelist. Omits the header entirely for disallowed origins so browsers
 * reject the response without seeing a misconfigured empty value.
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
  };
}

/**
 * Static CORS headers for non-browser endpoints (webhooks, cron).
 * Uses APP_URL directly. Prefer getCorsHeaders(req) for browser-facing functions.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'http://localhost:5173',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};
