/**
 * Strava OAuth token refresh, shared by `strava-sync` and the disconnect path
 * (`providerRevoke.ts`) so there is one implementation.
 *
 * Strava access tokens expire after about 6 hours and the refresh token may
 * rotate on every refresh, so a caller that keeps the grant must persist the
 * returned pair.
 */

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

/** Refresh when the access token expires within this window. */
export const STRAVA_REFRESH_BUFFER_MS = 60_000;

export interface StravaClientCredentials {
  fetch: typeof fetch;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Optional abort signal (e.g. a timeout). */
  signal?: AbortSignal;
}

export interface StravaRefreshedTokens {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
}

/**
 * The parts of a Strava error entry that are safe to log: a small enumerated
 * vocabulary (`resource`, `field`, `code`), never free text or a token.
 */
export interface StravaErrorDetail {
  resource: string | null;
  field: string | null;
  code: string | null;
}

/**
 * Thrown when the refresh fails. The message carries only the HTTP status,
 * never the response body or any token. `details` (PR 51) holds only Strava's
 * enumerated error vocabulary, so a caller can tell a revoked grant from an
 * application-level misconfiguration without ever reading the body.
 */
export class StravaRefreshError extends Error {
  constructor(
    readonly status: number | null,
    reason: string,
    readonly details: StravaErrorDetail[] = [],
  ) {
    super(`Token refresh failed: ${reason}`);
    this.name = 'StravaRefreshError';
  }
}

/** Keep only the enumerated fields, and only if they are short identifiers. */
function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null;
}

/**
 * Parse Strava's error body, which looks like
 * `{"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}`.
 * Only `resource`/`field`/`code` are kept; `message` and anything unexpected
 * are dropped unread.
 */
export function parseStravaErrorDetails(body: unknown): StravaErrorDetail[] {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 5).map((entry) => ({
    resource: safeIdentifier((entry as { resource?: unknown })?.resource),
    field: safeIdentifier((entry as { field?: unknown })?.field),
    code: safeIdentifier((entry as { code?: unknown })?.code),
  }));
}

/** True when the token has expired or expires within the buffer. */
export function stravaTokenNeedsRefresh(
  tokenExpiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const expiresAt = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : 0;
  return Number.isNaN(expiresAt) || now >= expiresAt - STRAVA_REFRESH_BUFFER_MS;
}

export async function refreshStravaAccessToken(
  refreshToken: string,
  credentials: StravaClientCredentials,
): Promise<StravaRefreshedTokens> {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new StravaRefreshError(null, 'client not configured');
  }
  let response: Response;
  try {
    response = await credentials.fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: credentials.signal,
    });
  } catch (err) {
    // The underlying message may name internals; log it, never propagate it.
    console.error('[STRAVA_REFRESH] network error:', err);
    throw new StravaRefreshError(null, 'network error');
  }

  if (!response.ok) {
    // The body is read only to classify the failure (see
    // parseStravaErrorDetails); it is never logged, stored or returned.
    let details: StravaErrorDetail[] = [];
    try {
      details = parseStravaErrorDetails(await response.json());
    } catch {
      details = [];
    }
    throw new StravaRefreshError(response.status, `HTTP ${response.status}`, details);
  }

  let body: Partial<StravaRefreshedTokens> | null = null;
  try {
    body = await response.json() as Partial<StravaRefreshedTokens> | null;
  } catch {
    // A non-JSON 200 body: V8's SyntaxError quotes the body, so it is dropped.
    throw new StravaRefreshError(response.status, 'malformed response');
  }
  if (!body || typeof body.access_token !== 'string' || typeof body.expires_at !== 'number') {
    throw new StravaRefreshError(response.status, 'malformed response');
  }
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : refreshToken,
    expires_at: body.expires_at,
  };
}
