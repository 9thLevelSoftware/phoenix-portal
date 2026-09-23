/**
 * Garmin OAuth 1.0a request signing (HMAC-SHA1, RFC 5849), shared by
 * `garmin-oauth` (token exchange) and `providerRevoke.ts` (user
 * de-registration on disconnect).
 */

/**
 * Generate OAuth 1.0a signature base string and HMAC-SHA1 signature.
 * Per RFC 5849 Section 3.4.
 */
export async function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string = '',
): Promise<string> {
  // Sort parameters alphabetically and encode
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  // Create signature base string
  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  // Signing key = consumer_secret&token_secret
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  // HMAC-SHA1
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signatureBase));
  return btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
}

/**
 * Generate a random nonce for OAuth requests.
 */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Build an OAuth 1.0a Authorization header.
 */
export function buildAuthHeader(params: Record<string, string>): string {
  const headerParts = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');
  return `OAuth ${headerParts}`;
}

/**
 * Signed `Authorization` header for a request made with a user's permanent
 * access token (no body parameters, no query string).
 */
export async function signedGarminAuthorization(
  method: string,
  url: string,
  credentials: {
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
  },
): Promise<string> {
  const params: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.token,
    oauth_version: '1.0',
  };
  params.oauth_signature = await generateOAuthSignature(
    method,
    url,
    params,
    credentials.consumerSecret,
    credentials.tokenSecret,
  );
  return buildAuthHeader(params);
}
