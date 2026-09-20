import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { getCorsHeaders } from '../_shared/cors.ts';
import {
  checkReadBudget,
  parseRetryAfterSeconds,
  parseStravaRateLimitHeaders,
  recordStravaUsage,
  type StravaRateLimitSnapshot,
} from '../_shared/providerRateLimit.ts';
import { computeIncrementalWindow } from '../_shared/incrementalWindow.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';
import {
  completeSyncQueueEntry,
  createSyncQueueEntry,
  heartbeatSyncQueueEntry,
  noOwnedQueueRow,
  type OwnedQueueRow,
  releaseOwnedQueueRow,
  syncAlreadyQueuedResponse,
  syncQueueUnavailableResponse,
} from '../_shared/syncQueue.ts';
import { refreshStravaAccessToken, stravaTokenNeedsRefresh } from '../_shared/stravaToken.ts';
import { nextWatermark } from '../_shared/syncWatermark.ts';

/**
 * Loose Supabase client type for helper signatures. The bare
 * `ReturnType<typeof createClient>` collapses table payload types to `never`.
 */
type DbClient = SupabaseClient<any, any, any>;

/** external_activities rows per upsert request (matches hevy-sync). */
const UPSERT_CHUNK_SIZE = 100;

/**
 * Per-request ceiling for every Strava call (token refresh and each activity
 * page).
 *
 * process-sync-queue reclaims a strava task whose `started_at` is older than
 * HEARTBEAT_LEASE_MS (5 minutes). This run heartbeats on entry and after each
 * fetched page and each upsert chunk, so the longest possible silence is the
 * token refresh plus the first page (two capped requests, ~60 s worst case)
 * and, after that, one request plus the 350 ms inter-page delay — comfortably
 * under the lease. Without a timeout a single hung request could
 * outlast it, and the row would be reclaimed and re-dispatched while this run
 * was still alive.
 */
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Strava Activity Sync Edge Function
 *
 * Fetches activities from Strava API, normalizes them, and upserts to
 * external_activities. Handles token refresh when access_token is expired.
 *
 * Request body:
 *   - user_id: string
 *   - sync_type: 'initial' | 'manual' | 'incremental'
 *   - queue_id?: string (sent by process-sync-queue; the only row this run
 *     completes, and the row whose lease it heartbeats). A browser-initiated
 *     run (user JWT) instead creates its own row, directly in `processing`,
 *     and owns it the same way; a concurrent duplicate loses the
 *     `sync_queue_one_active` race and gets 409 `sync_already_queued`.
 *
 * Environment variables:
 *   - STRAVA_CLIENT_ID
 *   - STRAVA_CLIENT_SECRET
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

// ---------------------------------------------------------------------------
// Strava activity normalization (mirrors src/lib/integrations/normalize.ts)
// Duplicated here because Edge Functions run in Deno, not the Vite app.
// ---------------------------------------------------------------------------

const SPORT_TYPE_MAP: Record<string, string> = {
  Run: 'running',
  TrailRun: 'running',
  VirtualRun: 'running',
  Ride: 'cycling',
  MountainBikeRide: 'cycling',
  GravelRide: 'cycling',
  VirtualRide: 'cycling',
  Swim: 'swimming',
  Walk: 'walking',
  Hike: 'hiking',
  WeightTraining: 'strength',
  Crossfit: 'strength',
  Yoga: 'flexibility',
  Rowing: 'rowing',
  Elliptical: 'cardio',
  StairStepper: 'cardio',
};

interface StravaActivityRaw {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
  distance?: number;
  kilojoules?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  total_elevation_gain?: number;
}

interface NormalizedActivity {
  external_id: string;
  provider: string;
  name: string;
  activity_type: string;
  started_at: string;
  duration_seconds: number;
  distance_meters: number | null;
  calories: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  elevation_gain_meters: number | null;
}

function normalizeStravaActivity(raw: StravaActivityRaw): NormalizedActivity {
  return {
    external_id: String(raw.id),
    provider: 'strava',
    name: raw.name,
    activity_type: SPORT_TYPE_MAP[raw.sport_type] ?? 'other',
    started_at: raw.start_date,
    duration_seconds: raw.elapsed_time,
    distance_meters: raw.distance ?? null,
    calories: raw.kilojoules ? Math.round(raw.kilojoules * 0.239) : null,
    avg_heart_rate: raw.average_heartrate ?? null,
    max_heart_rate: raw.max_heartrate ?? null,
    elevation_gain_meters: raw.total_elevation_gain ?? null,
  };
}

/**
 * Keys in a Strava activity payload that describe *where* the activity
 * happened: `map` is the encoded polyline of the whole route, and
 * `start_latlng` / `end_latlng` are its endpoints — which, for most people, is
 * their home address.
 *
 * F-095 / FP-5: nothing in the portal reads any of them. `normalizeStravaActivity`
 * above takes name, type, time, distance, calories, heart rate and elevation and
 * never touches the route, and no query, export or view selects these keys out
 * of `raw_data`. Keeping them means holding location data we have no use for,
 * inside a JSONB blob that the GDPR export and every `external_activities` read
 * carry along.
 *
 * Migration 20260920004800 strips the same three keys from rows already stored.
 */
export const STRAVA_LOCATION_KEYS = [
  'map',
  'start_latlng',
  'end_latlng',
] as const;

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

interface StravaClientCredentials {
  fetch: typeof fetch;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Optional abort signal (e.g. a timeout). */
  signal?: AbortSignal;
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

interface StravaRefreshedTokens {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
}

/**
 * Thrown when the refresh fails. `status` is Strava's HTTP status (null for a
 * network error or missing client config). `reason` is one of a fixed set of
 * strings and `details` holds only Strava's enumerated error vocabulary, so
 * neither the response body nor any token can reach a log, a stored
 * `error_message` or an HTTP response.
 *
 * Same shape as PR 54's `_shared/stravaToken.ts` (`refreshStravaAccessToken` /
 * `StravaRefreshError`), plus `details`: when both land, keep `details` (the
 * refresh-token classification below needs it) and delete this copy.
 */
class StravaRefreshError extends Error {
  constructor(
    readonly status: number | null,
    reason: string,
    readonly details: StravaErrorDetail[] = [],
  ) {
    super(reason);
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
function parseStravaErrorDetails(body: unknown): StravaErrorDetail[] {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 5).map((entry) => ({
    resource: safeIdentifier((entry as { resource?: unknown })?.resource),
    field: safeIdentifier((entry as { field?: unknown })?.field),
    code: safeIdentifier((entry as { code?: unknown })?.code),
  }));
}

async function refreshAccessToken(
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
 * Drop the location keys from a raw Strava activity. Returns a copy; the input
 * is untouched. Top-level only, which is the whole surface the
 * `/athlete/activities` list endpoint returns these on — detailed
 * `segment_efforts` are not requested by this function.
export function stripStravaLocationData(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...raw };
  for (const key of STRAVA_LOCATION_KEYS) {
    delete stripped[key];
  }
  return stripped;
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
function isRevokedGrant(err: StravaRefreshError): boolean {
  if (err.status !== 400 && err.status !== 401) return false;
  return err.details.some(
    (detail) => detail.resource === 'RefreshToken' || detail.field === 'refresh_token',
  );
}

/**
 * Whether `oauth_tokens.refresh_token` is still the token this run used.
 *
 * Strava revokes the previous refresh token on every rotation, so a run that
 * loses a concurrent refresh race is handed the same 400 as a genuinely
 * revoked grant. Re-reading the row separates the two. On a read failure the
 * answer is "no", which routes to the non-destructive retry branch.
 */
async function storedRefreshTokenMatches(
  supabase: DbClient,
  userId: string,
  usedRefreshToken: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'strava')
    .maybeSingle();

  if (error || !data) {
    console.error('[STRAVA_REFRESH] could not re-read stored refresh token:', error);
    return false;
  }
  const stored = (await decryptOAuthSecret(data.refresh_token as string)) ?? '';
  if (stored !== usedRefreshToken) {
    console.warn(
      '[STRAVA_REFRESH] stored refresh token changed during this run; ' +
        'another sync refreshed it, so the grant is not revoked',
    );
    return false;
  }
  return true;
}

/** Enumerated classification inputs, safe to log. */
function describeRefreshFailure(err: StravaRefreshError): string {
  const details = err.details
    .map((d) => `${d.resource ?? '?'}/${d.field ?? '?'}/${d.code ?? '?'}`)
    .join(',');
  return `status=${err.status ?? 'none'} reason=${err.message} errors=[${details}]`;
 * The exact row written to `external_activities`. Extracted so a test can
 * assert what gets stored without standing up the whole handler.
export function buildExternalActivityRow(
  raw: StravaActivityRaw,
  syncedAt: string,
): Record<string, unknown> {
    user_id: userId,
    ...normalizeStravaActivity(raw),
    raw_data: stripStravaLocationData(raw as unknown as Record<string, unknown>),
    synced_at: syncedAt,
// ---------------------------------------------------------------------------
// Token refresh (shared with the disconnect path: _shared/stravaToken.ts)
// ---------------------------------------------------------------------------
function refreshAccessToken(refreshToken: string) {
  return refreshStravaAccessToken(refreshToken, {
    fetch: (input, init) => fetch(input, init),
    clientId: Deno.env.get('STRAVA_CLIENT_ID'),
    clientSecret: Deno.env.get('STRAVA_CLIENT_SECRET'),
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

// Guarded by `import.meta.main` at the bottom so the exported helpers above can
// be imported by a test without this module binding a port.
const stravaSyncHandler = async (req: Request): Promise<Response> => {
export interface StravaSyncDependencies {
  env: (key: string) => string | undefined;
  // deno-lint-ignore no-explicit-any
  createClient: (url: string, key: string, options?: any) => DbClient;
  /** Used for Strava API calls. */
  fetch: typeof fetch;
  now: () => Date;
}

function defaultStravaSyncDependencies(): StravaSyncDependencies {
  return {
    env: (key) => Deno.env.get(key),
    createClient: (url, key, options) => createClient(url, key, options),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
  };
}

export function createStravaSyncHandler(
  dependencies: StravaSyncDependencies = defaultStravaSyncDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => stravaSync(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createStravaSyncHandler());
}

async function stravaSync(req: Request, deps: StravaSyncDependencies): Promise<Response> {
  // A browser-initiated run owns the row it created: hand it back when the run
  // ends badly, so the user's next manual sync is not refused with a 409 until
  // the lease expires. Queue-dispatched rows deliberately stay `processing`
  // for process-sync-queue to re-run (PR 51).
  const owned: OwnedQueueRow = noOwnedQueueRow();
  const response = await runStravaSync(req, deps, owned);
  if (!response.ok) await releaseOwnedQueueRow(owned);
  return response;
}

async function runStravaSync(
  req: Request,
  deps: StravaSyncDependencies,
  owned: OwnedQueueRow,
export interface StravaSyncAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
export interface StravaSyncHandlerDependencies {
  createAuthClient(authorization: string): StravaSyncAuthClient;
  createAdminClient(): DbClient;
  /** Pause between Strava pages. Injectable so tests need not wait. */
  sleep?(ms: number): Promise<void>;
function defaultStravaSyncDependencies(): StravaSyncHandlerDependencies {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } } },
      ) as unknown as StravaSyncAuthClient;
    },
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
    },
async function stravaSyncHandler(
  deps: StravaSyncHandlerDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Parse request body first (needed for both auth paths)
    const body = await req.json();

    // ---- Auth: Dual-path (browser JWT or service-role key) ----
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    let userId: string;

    // Try JWT auth first (browser-initiated calls)
    const supabaseAuth = deps.createClient(
      deps.env('SUPABASE_URL')!,
      deps.env('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAuth = deps.createAuthClient(authHeader);
    const { data: { user: jwtUser } } = await supabaseAuth.auth.getUser();

    if (jwtUser) {
      // Browser-initiated: use JWT-verified user ID, ignore body.user_id
      userId = jwtUser.id;
    } else {
      // Not a valid user JWT -- must be service-role call from process-sync-queue
      // Verify the caller is actually using the service role key
      const serviceRoleKey = deps.env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

      if (!isServiceRole || !body.user_id) {
        return new Response(
          JSON.stringify({ error: 'Not authenticated' }),
          { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      userId = body.user_id;
    }

    const sync_type = body.sync_type ?? 'incremental';
    const calledByQueueProcessor = !jwtUser;
    // The dispatched row (queue path only): a browser caller's `queue_id` is
    // ignored — it may name any row at all — and replaced by its own below.
    const dispatchedQueueId =
      calledByQueueProcessor && typeof body.queue_id === 'string' ? body.queue_id : null;
    // The row this run owns and leases.
    let ownedQueueId = dispatchedQueueId;

    const supabase = deps.createClient(
      deps.env('SUPABASE_URL')!,
      deps.env('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const supabase = deps.createAdminClient();

    // Renew the lease immediately: the processor claimed this row before it
    // called us, and the work below (subscription check, token refresh, page
    // fetches) must not be counted against that claim's clock.
    await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now());

    // Subscription gate — FLAME or higher required for integrations
    const gate = await requireSubscription(supabase, userId, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    // Browser-initiated: take a queue row of our own so this run is visible to
    // the portal, holds a lease, and blocks a concurrent duplicate sync.
    if (!calledByQueueProcessor) {
      const created = await createSyncQueueEntry(supabase, {
        userId,
        provider: 'strava',
        syncType: typeof sync_type === 'string' ? sync_type : 'manual',
        now: deps.now(),
      });
      if (created.conflict) return syncAlreadyQueuedResponse(cors);
      if (!created.queueId) return syncQueueUnavailableResponse(cors);
      ownedQueueId = created.queueId;
      owned.supabase = supabase;
      owned.queueId = ownedQueueId;
      owned.userId = userId;
    }

    // ---------------------------------------------------------------
    // Fetch user's Strava tokens from oauth_tokens (server-only table)
    // ---------------------------------------------------------------
    const { data: tokens, error: tokenError } = await supabase
      .from('oauth_tokens')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', userId)
      .eq('provider', 'strava')
      .single();

    const { data: integration } = await supabase
      .from('user_integrations')
      .select('last_sync_at, status')
      .eq('user_id', userId)
      .eq('provider', 'strava')
      .single();

    if (tokenError || !tokens || integration?.status !== 'connected') {
      return new Response(
        JSON.stringify({ error: 'Strava integration not found or not connected' }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = (await decryptOAuthSecret(tokens.access_token as string)) ?? '';
    let refreshToken = (await decryptOAuthSecret(tokens.refresh_token as string)) ?? '';

    // ---------------------------------------------------------------
    // Refresh token if expired (with 60s buffer)
    // ---------------------------------------------------------------
    if (stravaTokenNeedsRefresh(tokens.token_expires_at as string | null)) {
      console.log('Strava access token expired, refreshing...');
      let refreshed: StravaRefreshedTokens;
      try {
        refreshed = await refreshAccessToken(refreshToken, {
          fetch: deps.fetch,
          clientId: deps.env('STRAVA_CLIENT_ID'),
          clientSecret: deps.env('STRAVA_CLIENT_SECRET'),
          signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        const refreshError = err instanceof StravaRefreshError
          ? err
          : new StravaRefreshError(null, 'unexpected error');
        // Classification inputs only: statuses and Strava's enumerated error
        // vocabulary. Never the response body.
        console.error(`[STRAVA_REFRESH] ${describeRefreshFailure(refreshError)}`);

        // Migration 20260920005200 serializes all processing rows for this
        // user/provider, including browser runs. The re-read below remains a
        // rolling-deploy defense: an older handler that did not own a row may
        // still have exchanged the token before the index-aware release lands.
        // Downgrade only while the rejected token is still the stored one.
        const revoked = isRevokedGrant(refreshError)
          && await storedRefreshTokenMatches(supabase, userId, refreshToken);

        if (revoked) {
          // The grant is gone: surface it so the card asks the user to
          // reconnect, and fail the queue task terminally (401 is not in
          // process-sync-queue's retryable set).
          await supabase
            .from('user_integrations')
            .update({
              status: 'token_expired',
              error_message: 'Strava authorization expired or was revoked. Reconnect Strava to resume syncing.',
            })
            .eq('user_id', userId)
            .eq('provider', 'strava');

          return new Response(
            JSON.stringify({ error: 'Strava authorization expired or was revoked', code: 'token_expired' }),
            { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }

        // Everything else — a Strava 5xx, a 429, an application-level 400/401
        // (wrong client id/secret), a network error, an unparseable body, or a
        // lost rotation race — keeps the integration connected and returns 502
        // so the queue retries. A misconfigured app must never disconnect
        // users: correcting the secret then fixes everyone at once.
        await supabase
          .from('user_integrations')
          .update({ error_message: 'Strava token refresh failed; will retry' })
          .eq('user_id', userId)
          .eq('provider', 'strava');

        return new Response(
          JSON.stringify({ error: 'Strava token refresh failed', code: 'refresh_failed' }),
          { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      accessToken = refreshed.access_token;
      // Strava rotates refresh tokens on every refresh call; keep the in-memory
      // copy in sync with what we persist so any subsequent refresh in this
      // invocation uses the rotated value, not the now-revoked original.
      refreshToken = refreshed.refresh_token ?? refreshToken;

      // Persist new tokens in oauth_tokens (server-only table). Strava revokes
      // the previous refresh token on rotation, so if this write fails the stored
      // refresh token is now stale and every future sync would fail to refresh.
      // Fail the sync instead of continuing with an unpersisted rotated token.
      const { error: tokenUpdateError } = await supabase
        .from('oauth_tokens')
        .update({
          access_token: await encryptOAuthSecret(refreshed.access_token),
          refresh_token: await encryptOAuthSecret(refreshToken),
          token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('provider', 'strava');

      if (tokenUpdateError) {
        console.error('Failed to persist rotated Strava tokens:', tokenUpdateError);
        // Keep status 'connected' (do NOT downgrade): this handler refuses to
        // sync unless status === 'connected', and the 500 below is requeued for
        // retry. Downgrading would make the retry return a non-retryable 404.
        await supabase
          .from('user_integrations')
          .update({ error_message: 'Failed to persist refreshed tokens' })
          .eq('user_id', userId)
          .eq('provider', 'strava');

        return new Response(
          JSON.stringify({ error: 'Failed to persist refreshed Strava tokens' }),
          { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ---------------------------------------------------------------
    // Fetch activities from Strava
    // ---------------------------------------------------------------
    const baseParams = new URLSearchParams({ per_page: '200' });
    // Captured before the first request: an incremental run fetches
    // everything after the old watermark up to (at least) this instant, so
    // this — not the end of the run — is where the next window must start.
    const syncStartedAt = deps.now().toISOString();
    // Capture the new watermark BEFORE fetching: anything Strava records while
    // this run is in flight falls inside the next window instead of behind it.
    const syncStartedAt = new Date().toISOString();

    // Strava's `after`/`before` filter on activity START time, while
    // last_sync_at is wall-clock sync time. The incremental window therefore
    // reaches back a lookback from the earlier of the watermark and the newest
    // stored start (see _shared/incrementalWindow.ts), so late uploads that
    // started before the last sync are still picked up. Upserts are idempotent,
    // so the overlap is free.
    const { data: newestStored } = await supabase
      .from('external_activities')
      .select('started_at')
      .eq('user_id', userId)
      .eq('provider', 'strava')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const incrementalWindow = computeIncrementalWindow({
      lastWatermark: integration.last_sync_at as string | null,
      maxStoredStartedAt: (newestStored?.started_at as string | null | undefined) ?? null,
    });

    // Modes:
    //
    // Incremental (last_sync_at set): one forward pass from the window.
    //
    // Backfill (`initial`, or no watermark yet): Strava returns activities
    //   newest-first, so each page walks further into the past. A run that hits
    //   the page ceiling stops partway; the oldest Strava activity already
    //   stored IS how far back we got, so passing it as `before` makes each
    //   retry continue from there.
    //
    //   When rows are already stored (a reconnect after disconnect, a re-auth
    //   after a revoked token, or a resumed backfill), a forward pass from the
    //   incremental window runs FIRST. Without it, the interval between the old
    //   last_sync_at and now would never be requested: the backward pass only
    //   fetches activities older than anything stored.
    const isBackfill = sync_type === 'initial' || !integration.last_sync_at;
    const previousWatermark = (integration.last_sync_at as string | null) ?? null;
    const toEpoch = (iso: string | Date) =>
      String(Math.floor(new Date(iso).getTime() / 1000));

    // Strava's quotas are application-wide (100 reads / 15 min, 1,000 / day), so
    // a single user's backfill spends budget every other user shares. Cap the
    // pages one invocation may take (across all passes), and stop early once
    // Strava's own reported usage says we are close to the ceiling.
    const MAX_PAGES_PER_RUN = 10;
    // Pages the forward pass may not use when a backward pass follows, so a
    // large reconnect gap cannot starve an incomplete backfill of progress.
    const BACKWARD_RESERVED_PAGES = 2;
    // Requests deliberately left unspent so an in-flight backfill cannot starve
    // other users' syncs (or the webhook path) of quota.
    const RESERVED_REQUESTS = 20;
    const delayBetweenPagesMs = 350;

    type PassDirection = 'forward' | 'backward';
    const passes: Array<{ direction: PassDirection; params: URLSearchParams; maxPages: number }> = [];

    if (!isBackfill || newestStored?.started_at) {
      const forward = new URLSearchParams({ per_page: '200' });
      if (incrementalWindow) forward.set('after', toEpoch(incrementalWindow.after));
      passes.push({
        direction: 'forward',
        params: forward,
        maxPages: isBackfill ? MAX_PAGES_PER_RUN - BACKWARD_RESERVED_PAGES : MAX_PAGES_PER_RUN,
      });
    }

    let oldestStoredMs: number | null = null;
    if (isBackfill) {
      const backward = new URLSearchParams({ per_page: '200' });
      const { data: oldestStored } = await supabase
        .from('external_activities')
        .select('started_at')
        .eq('user_id', userId)
        .eq('provider', 'strava')
        .order('started_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (oldestStored?.started_at) {
        // `before` is exclusive; the boundary activity is already stored, and
        // upserts are idempotent even if Strava treats it as inclusive.
        oldestStoredMs = new Date(oldestStored.started_at as string).getTime();
        backward.set('before', toEpoch(oldestStored.started_at as string));
        console.log(
          `Strava backfill resuming before ${oldestStored.started_at}`,
        );
      }
      passes.push({ direction: 'backward', params: backward, maxPages: MAX_PAGES_PER_RUN });
    }

    // Per pass: whether it reached a short (final) page, and the start times of
    // everything it fetched, in response order.
    const passResults = new Map<PassDirection, { complete: boolean; startsMs: number[] }>();
    // Keyed by Strava id: the forward and backward windows can overlap, and a
    // page boundary can repeat an activity; each one is upserted once.
    const fetchedById = new Map<number, StravaActivityRaw>();

    let budgetExhausted = false;
    let pagesUsed = 0;
    let lastSnapshot: StravaRateLimitSnapshot | null = null;

    while (page <= MAX_PAGES_PER_RUN) {
      const params = new URLSearchParams(baseParams);
      params.set('page', String(page));

      let activitiesResponse: Response;
      try {
        activitiesResponse = await deps.fetch(
          `https://www.strava.com/api/v3/athlete/activities?${params}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
          }
        );
      } catch {
        // AbortSignal timeouts, DNS failures and connection resets are
        // transient provider failures. 502 is in process-sync-queue's retry
        // set; a 500 would terminally fail the task.
        console.error('Strava activities request failed before a response');
        return new Response(
          JSON.stringify({
            error: 'Failed to fetch Strava activities',
            code: 'activities_fetch_failed',
          }),
          { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }

      // Record what Strava reports about our quota on every response, success
      // or failure — a 429 is exactly when this information matters most.
      lastSnapshot = parseStravaRateLimitHeaders(activitiesResponse.headers);
      await recordStravaUsage(supabase, lastSnapshot);
      // Renew the lease per page: the fetch phase is otherwise silent, and a
      // reclaimed row would be dispatched a second time while this run lives.
      await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now());

      if (activitiesResponse.status === 429) {
        const retryAfter = parseRetryAfterSeconds(activitiesResponse.headers);
        console.warn(
          `Strava rate limited; retry-after=${retryAfter ?? 'unspecified'}s, ` +
            `${rawActivities.length} activities fetched before the limit`,
        );
        // Stop cleanly rather than erroring: activities already fetched are
        // persisted below, and last_sync_at is withheld so the queue retry
        // resumes from the same cutoff.
      const activitiesResponse = await deps.fetch(
        `https://www.strava.com/api/v3/athlete/activities?${params}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
    const reserveReached = (snapshot: StravaRateLimitSnapshot | null) => {
      if (!snapshot) return false;
      const budget = checkReadBudget(snapshot, RESERVED_REQUESTS);
      if (budget.hasHeadroom) return false;
      console.warn(
        `Strava read budget reserve reached (remaining=${budget.remaining}); ` +
          'pausing pagination until the window rolls over',
      );
      return true;
    };
    for (const pass of passes) {
      // Re-check headroom before opening another pass, not only between pages.
      if (reserveReached(lastSnapshot)) {
        budgetExhausted = true;
        break;
      }

      const result = { complete: false, startsMs: [] as number[] };
      passResults.set(pass.direction, result);
      let page = 1;

      while (page <= pass.maxPages && pagesUsed < MAX_PAGES_PER_RUN) {
        const params = new URLSearchParams(pass.params);
        params.set('page', String(page));

        const activitiesResponse = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?${params}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        pagesUsed++;

        // Record what Strava reports about our quota on every response, success
        // or failure — a 429 is exactly when this information matters most.
        lastSnapshot = parseStravaRateLimitHeaders(activitiesResponse.headers);
        await recordStravaUsage(supabase, lastSnapshot);

        if (activitiesResponse.status === 429) {
          const retryAfter = parseRetryAfterSeconds(activitiesResponse.headers);
          console.warn(
            `Strava rate limited; retry-after=${retryAfter ?? 'unspecified'}s, ` +
              `${fetchedById.size} activities fetched before the limit`,
          );
          // Stop cleanly rather than erroring: activities already fetched are
          // persisted below and the queue retry resumes once quota frees up.
          budgetExhausted = true;
          break;
        }

        if (!activitiesResponse.ok) {
          const errorText = await activitiesResponse.text();
          console.error('Strava activities fetch failed:', activitiesResponse.status, errorText);

          if (activitiesResponse.status === 401) {
            await supabase
              .from('user_integrations')
              .update({ status: 'token_expired', error_message: 'Access token revoked or invalid' })
              .eq('user_id', userId)
              .eq('provider', 'strava');
          }

          return new Response(
            JSON.stringify({ error: 'Failed to fetch Strava activities', details: errorText }),
            { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }

        const pageActivities: StravaActivityRaw[] = await activitiesResponse.json();
        for (const activity of pageActivities) {
          fetchedById.set(activity.id, activity);
          result.startsMs.push(new Date(activity.start_date).getTime());
        }

        if (pageActivities.length < 200) {
          result.complete = true;
          break;
        }

        // Consult Strava's reported headroom before spending another request.
        if (reserveReached(lastSnapshot)) {
          budgetExhausted = true;
          break;
        }

        page++;
        await sleep(delayBetweenPagesMs);
      }

      if (budgetExhausted) break;
    }

    // A pass that never started, or stopped on a full page (page ceiling or
    // budget), leaves activities upstream.
    const passIncomplete = (direction: PassDirection) =>
      passes.some((pass) => pass.direction === direction) &&
      passResults.get(direction)?.complete !== true;
    const forwardIncomplete = passIncomplete('forward');
    const backwardIncomplete = passIncomplete('backward');
    const moreRemaining = forwardIncomplete || backwardIncomplete;

    const rawActivities = [...fetchedById.values()];

    // ---------------------------------------------------------------
    // Normalize and upsert activities
    // ---------------------------------------------------------------
    const errors: string[] = [];
    // Activities written this run. Includes re-saves of rows already stored
    // (the lookback overlap is intentional), but never counts one twice.
    let syncedCount = 0;
    let failedCount = 0;

    // Pages are offset-based, so an activity uploaded mid-run shifts the page
    // boundaries and can repeat one activity on the next page. A multi-row
    // upsert rejects two rows sharing a conflict key ("ON CONFLICT DO UPDATE
    // command cannot affect row a second time"), which would fail the whole
    // chunk, so collapse duplicates first, keeping the last copy seen.
    const deduped = new Map<string, StravaActivityRaw>();
    for (const raw of rawActivities) deduped.set(String(raw.id), raw);
    const uniqueActivities = [...deduped.values()];

    // Upsert in chunks (the hevy-sync pattern) rather than one round trip per
    // activity: a 2,000-activity backfill page set would otherwise take 2,000
    // requests. After each chunk the queue row's lease is renewed so
    // process-sync-queue does not reclaim a run that is still making progress.
    const syncedAt = deps.now().toISOString();
    for (let i = 0; i < uniqueActivities.length; i += UPSERT_CHUNK_SIZE) {
      const chunkRaw = uniqueActivities.slice(i, i + UPSERT_CHUNK_SIZE);
      const rangeLabel = `Activities ${i}-${i + chunkRaw.length - 1}`;
      try {
        const rows = chunkRaw.map((raw) => ({
          user_id: userId,
          ...normalizeStravaActivity(raw),
          raw_data: raw,
          synced_at: syncedAt,
        }));

        const { error: upsertError } = await supabase
          .from('external_activities')
          .upsert(rows, { onConflict: 'user_id,provider,external_id' });
          .upsert(
            buildExternalActivityRow(userId, raw, new Date().toISOString()),
            { onConflict: 'user_id,provider,external_id' }
          );

        if (upsertError) {
          failedCount += chunkRaw.length;
          errors.push(`${rangeLabel}: ${upsertError.message}`);
        } else {
          syncedCount += chunkRaw.length;
        }
      } catch (err) {
        failedCount += chunkRaw.length;
        errors.push(`${rangeLabel}: ${(err as Error).message}`);
      }
      await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now());
    }

    // ---------------------------------------------------------------
    // If any activity failed to persist, do NOT advance last_sync_at: it is the
    // `after` cutoff for the next incremental sync, so advancing it would skip
    // the failed activities permanently. Leave the queue entry pending so the
    // processor retries (upserts are idempotent), and surface a 502.
    // ---------------------------------------------------------------
    if (errors.length > 0) {
      const failMessage = `Failed to persist ${failedCount} of ${uniqueActivities.length} activities`;
      // Keep status 'connected' so the queued 502 retry can re-enter this
      // handler (it rejects any non-connected integration with a 404). We only
      // record the error and withhold the last_sync_at advance.
      await supabase
        .from('user_integrations')
        .update({ error_message: failMessage })
        .eq('user_id', userId)
        .eq('provider', 'strava');

      return new Response(
        JSON.stringify({ error: failMessage, synced_count: syncedCount, errors }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ---------------------------------------------------------------
    // Pagination stopped short of the end (page ceiling or rate-limit reserve).
    // Everything fetched IS persisted, but activities remain upstream, so the
    // watermark may only move to what was fully read. Report retryably and
    // let the queue resume from the moved resume point.
    // ---------------------------------------------------------------
    if (moreRemaining) {
      // Forward resume point. The forward window is anchored on
      // min(last_sync_at, newest stored start). Rows persisted above raise the
      // newest stored start, but last_sync_at must move too or min() pins the
      // window in place and every retry re-reads the same pages.
      //   - Forward pass complete: its whole window is read; the pre-fetch
      //     watermark is safe.
      //   - Forward pass truncated: only safe to advance to the newest fetched
      //     start when the pages came back in ascending start order (then
      //     everything before it was read). Strava is believed to return
      //     ascending order when `after` is set (A-008, provisional), but this
      //     is checked rather than assumed; otherwise nothing is advanced.
      // last_sync_at is only written when it was already set: while it is null
      // the anchor is the newest stored start, which advances by itself, and
      // setting it would end an unfinished backfill for non-initial syncs.
      let forwardResumeAt: string | null = null;
      let forwardProgress = false;
      const forwardResult = passResults.get('forward');
      const forwardAnchorMs = incrementalWindow?.anchor.getTime() ?? null;

      if (forwardResult?.complete) {
        if (previousWatermark !== null) forwardResumeAt = syncStartedAt;
      } else if (forwardResult && forwardResult.startsMs.length > 0) {
        const starts = forwardResult.startsMs;
        const ascending = starts.every((ms, i) => i === 0 || ms >= starts[i - 1]);
        const newestFetchedMs = starts[starts.length - 1];
        if (!ascending) {
          console.warn(
            'Strava forward pass returned activities out of start order; ' +
              'not advancing the incremental watermark',
          );
        } else if (forwardAnchorMs === null || newestFetchedMs > forwardAnchorMs) {
          forwardProgress = true;
          if (previousWatermark !== null) {
            forwardResumeAt = new Date(newestFetchedMs).toISOString();
          }
        }
      }

      // Backward resume point: the oldest stored start. It moved if this run
      // persisted anything older than it.
      const backwardStarts = passResults.get('backward')?.startsMs ?? [];
      const backwardProgress =
        backwardStarts.length > 0 &&
        (oldestStoredMs === null ||
          backwardStarts.reduce((min, ms) => Math.min(min, ms), Infinity) < oldestStoredMs);

      const madeProgress = forwardProgress || backwardProgress;
      // A rate limit (429 or the reserve) is transient: the retry after the
      // window rolls over does something different even if nothing moved.
      const retryable = budgetExhausted || madeProgress;
      const partialMessage = retryable
        ? `Fetched ${rawActivities.length} activities before reaching the Strava ` +
          'request budget; sync will resume from this point on the next queue pass'
        : 'Reached the Strava page limit without moving the sync resume point; ' +
          'retrying would repeat the same request. Sync stopped.';

      console.warn(partialMessage);
      await supabase
        .from('user_integrations')
        .update(
          forwardResumeAt
            ? { last_sync_at: forwardResumeAt, error_message: partialMessage }
            : { error_message: partialMessage },
        )
        .eq('user_id', userId)
        .eq('provider', 'strava');

      return new Response(
        JSON.stringify({
          error: partialMessage,
          synced_count: syncedCount,
          partial: true,
        }),
        {
          // 502 is retryable per process-sync-queue's RETRYABLE_STATUSES; 500 is
          // not. Only ask for a retry when the next attempt will do something
          // different from this one.
          status: retryable ? 502 : 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // ---------------------------------------------------------------
    // Advance last_sync_at (all activities persisted) — only to the end of a
    // window fetched contiguously from the previous watermark:
    //  - incremental/manual with a watermark: [last_sync_at, syncStartedAt];
    //  - first backfill (no watermark): runs newest-first and may resume
    //    across queue passes, so the contiguous window ends at the newest
    //    activity stored, not at this run's clock (activities uploaded
    //    between the first and the final backfill pass are then fetched by
    //    the next incremental, idempotently);
    //  - `initial` against an existing watermark only reached further into
    //    the past, so the watermark stays put (see _shared/syncWatermark.ts).
    // ---------------------------------------------------------------
    let contiguousUpTo = syncStartedAt;
    if (!integration.last_sync_at) {
      const { data: newestStored } = await supabase
        .from('external_activities')
        .select('started_at')
        .eq('user_id', userId)
        .eq('provider', 'strava')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const newestMs = newestStored?.started_at
        ? Date.parse(newestStored.started_at as string)
        : Number.NaN;
      if (Number.isFinite(newestMs) && newestMs < Date.parse(syncStartedAt)) {
        contiguousUpTo = new Date(newestMs).toISOString();
      }
    }
    const watermark = nextWatermark({
      syncType: sync_type,
      previous: integration.last_sync_at as string | null,
      contiguousUpTo,
    });
    await supabase
      .from('user_integrations')
      .update({
        ...(watermark ? { last_sync_at: watermark } : {}),
        status: 'connected',
        error_message: null,
      })
      .update({ last_sync_at: syncStartedAt, status: 'connected', error_message: null })
      .eq('user_id', userId)
      .eq('provider', 'strava');

    // Complete only the row this run owns. Never sweep every pending row:
    // a second queued task (a kept `initial`) must still run.
    await completeSyncQueueEntry(supabase, {
      userId,
      provider: 'strava',
      queueId: ownedQueueId,
    });

    return new Response(
      JSON.stringify({ synced_count: syncedCount, errors }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Strava sync error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
};

if (import.meta.main) {
  Deno.serve(stravaSyncHandler);
}
export function createStravaSyncHandler(
  deps: StravaSyncHandlerDependencies = defaultStravaSyncDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => stravaSyncHandler(req, deps);
}
  Deno.serve(createStravaSyncHandler());
}
