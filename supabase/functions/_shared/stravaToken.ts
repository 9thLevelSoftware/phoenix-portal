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
const STRAVA_REFRESH_BUFFER_MS = 60_000;

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
interface StravaErrorDetail {
  resource: string | null;
  field: string | null;
  code: string | null;
}

/**
 * Thrown when the refresh fails. `message` is always
 * `Token refresh failed: ${reason}` and carries only that fixed reason, never
 * the response body or any token. `reason` is the bare string (what
 * `strava-sync` logs after `reason=`). `details` holds only Strava's
 * enumerated error vocabulary so a caller can tell a revoked grant from a
 * transient or application-level failure.
 */
export class StravaRefreshError extends Error {
  constructor(
    readonly status: number | null,
    readonly reason: string,
    readonly details: StravaErrorDetail[] = [],
  ) {
    super(`Token refresh failed: ${reason}`);
    this.name = 'StravaRefreshError';
  }

  /**
   * Whether the refresh failed because THIS USER's grant is gone.
   *
   * Strava answers with 400/401 for application-level problems too — a wrong
   * `client_secret` or `client_id` gives `resource: "Application"` — so the
   * status alone cannot be trusted: classifying an operator misconfiguration as
   * a revoked grant would move every Strava user to `token_expired` (and they
   * could not reconnect, since the OAuth exchange uses the same bad secret).
   *
   * Only an error that names the refresh token is treated as revoked. An
   * unrecognised body, a missing body, a 429, a network error and a missing
   * client config all fall through to the retryable branch, which keeps the
   * user connected.
   */
  isRevokedGrant(): boolean {
    if (this.status !== 400 && this.status !== 401) return false;
    return this.details.some(
      (detail) => detail.resource === 'RefreshToken' || detail.field === 'refresh_token',
    );
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

/**
 * Keep only the enumerated fields, and only if they are short identifiers.
 * Strava's vocabulary words are well under 32 characters; its tokens are 40
 * hex characters, so the cap keeps an echoed token out of the logs.
 */
function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
}

/**
 * Parse Strava's error body, which looks like
 * `{"message":"Bad Request","errors":[{"resource":"RefreshToken","field":"refresh_token","code":"invalid"}]}`.
 * Only `resource`/`field`/`code` are kept; `message` and anything unexpected
 * are dropped unread.
 */
function parseStravaErrorDetails(body: unknown): StravaErrorDetail[] {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 5).map((entry) => ({
    resource: safeIdentifier((entry as { resource?: unknown })?.resource),
    field: safeIdentifier((entry as { field?: unknown })?.field),
    code: safeIdentifier((entry as { code?: unknown })?.code),
  }));
}

export async function refreshStravaAccessToken(
  refreshToken: string,
  credentials: StravaClientCredentials,
): Promise<StravaRefreshedTokens> {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new StravaRefreshError(null, 'client not configured');
  }
  // A rejected fetch (DNS, abort, the caller's timeout) propagates. Callers
  // that want a fixed reason wrap it; this function does not, so the abort
  // signal stays observable.
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
    // The body is read only to classify the failure; it is never logged,
    // stored or returned. A non-JSON body has no enumerated errors. Anything
    // other than a parse failure (an abort while reading) still propagates.
    let details: StravaErrorDetail[] = [];
    try {
      details = parseStravaErrorDetails(await response.json());
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      details = [];
    }
    throw new StravaRefreshError(response.status, `HTTP ${response.status}`, details);
  }

  let body: Partial<StravaRefreshedTokens> | null = null;
  try {
    body = await response.json() as Partial<StravaRefreshedTokens> | null;
  } catch (err) {
    // A non-JSON 200 body: V8's SyntaxError quotes the body, so it is dropped.
    // Any other rejection, including an abort, propagates.
    if (!(err instanceof SyntaxError)) throw err;
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
