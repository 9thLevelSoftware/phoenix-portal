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
 * Thrown when the refresh fails. The message carries only the HTTP status,
 * never the response body or any token.
 */
export class StravaRefreshError extends Error {
  constructor(readonly status: number | null, reason: string) {
    super(`Token refresh failed: ${reason}`);
    this.name = 'StravaRefreshError';
  }
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
  const response = await credentials.fetch(STRAVA_TOKEN_URL, {
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

  if (!response.ok) {
    await response.body?.cancel();
    throw new StravaRefreshError(response.status, `HTTP ${response.status}`);
  }

  const body = await response.json() as Partial<StravaRefreshedTokens> | null;
  if (!body || typeof body.access_token !== 'string' || typeof body.expires_at !== 'number') {
    throw new StravaRefreshError(response.status, 'malformed response');
  }
  return {
    access_token: body.access_token,
    refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : refreshToken,
    expires_at: body.expires_at,
  };
}
