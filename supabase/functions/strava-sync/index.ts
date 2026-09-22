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
import { checkManualSyncRateLimit } from '../_shared/manualSyncRateLimit.ts';
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
import { computeIncrementalWindow } from '../_shared/incrementalWindow.ts';
import { nextWatermark } from '../_shared/syncWatermark.ts';
import { isServiceRoleBearer } from '../_shared/timingSafe.ts';

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

/**
 * Drop the location keys from a raw Strava activity. Returns a copy; the input
 * is untouched. Top-level only, which is the whole surface the
 * `/athlete/activities` list endpoint returns these on — detailed
 * `segment_efforts` are not requested by this function.
 */
export function stripStravaLocationData(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...raw };
  for (const key of STRAVA_LOCATION_KEYS) {
    delete stripped[key];
  }
  return stripped;
}

/**
 * The exact row written to `external_activities`. Extracted so a test can
 * assert what gets stored without standing up the whole handler.
 */
export function buildExternalActivityRow(
  userId: string,
  raw: StravaActivityRaw,
  syncedAt: string,
): Record<string, unknown> {
  return {
    user_id: userId,
    ...normalizeStravaActivity(raw),
    raw_data: stripStravaLocationData(raw as unknown as Record<string, unknown>),
    synced_at: syncedAt,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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
): Promise<Response> {
  const cors = getCorsHeaders(req);

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
    const { data: { user: jwtUser } } = await supabaseAuth.auth.getUser();

    if (jwtUser) {
      // Browser-initiated: use JWT-verified user ID, ignore body.user_id
      userId = jwtUser.id;
    } else {
      // Not a valid user JWT -- must be service-role call from process-sync-queue.
      // Verify the caller is actually using the service role key, in constant
      // time so the comparison leaks neither the key's bytes nor its length.
      const isServiceRole = isServiceRoleBearer(
        authHeader,
        deps.env('SUPABASE_SERVICE_ROLE_KEY'),
      );

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

    // Cap browser-initiated invocations per user: they hit Strava's
    // application-wide read quota. Keyed on the JWT-verified id, so an
    // unauthenticated caller never reaches this point and nobody can spend
    // another user's budget. The queue path (service role) is deliberately
    // exempt — process-sync-queue has its own per-provider budget, tracked
    // under the separate `strava` key. See _shared/manualSyncRateLimit.ts for
    // what the bucket does and does not count.
    if (jwtUser) {
      const rateCheck = await checkManualSyncRateLimit(
        supabase,
        { provider: 'strava', userId },
        cors,
      );
      if (!rateCheck.allowed) return rateCheck.response!;
    }

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
    const tokenExpiresAt = tokens.token_expires_at
      ? new Date(tokens.token_expires_at).getTime()
      : 0;

    // ---------------------------------------------------------------
    // Refresh token if expired (with 60s buffer)
    // ---------------------------------------------------------------
    if (Date.now() >= tokenExpiresAt - 60_000) {
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
    // Fetch activities from Strava (two-pass: forward gap-fill + backward backfill)
    // ---------------------------------------------------------------
    // Capture the new watermark BEFORE fetching: an incremental run fetches
    // everything after the old watermark up to (at least) this instant, so
    // this — not the end of the run — is where the next window must start.
    const syncStartedAt = deps.now().toISOString();

    // Newest stored activity anchors the incremental window (lookback below).
    const { data: newestStored } = await supabase
      .from('external_activities')
      .select('started_at')
      .eq('user_id', userId)
      .eq('provider', 'strava')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Lookback window: `after = min(lastWatermark, newestStored) - 72h`. A late
    // upload whose started_at falls before the old watermark is then still
    // fetched. Returns null when neither anchor is set (pure first backfill).
    const incrementalWindow = computeIncrementalWindow({
      lastWatermark: integration.last_sync_at as string | null,
      maxStoredStartedAt: (newestStored?.started_at as string | null | undefined) ?? null,
    });

    const isBackfill = sync_type === 'initial' || !integration.last_sync_at;
    const previousWatermark = (integration.last_sync_at as string | null) ?? null;
    const toEpoch = (iso: string | Date) =>
      String(Math.floor(new Date(iso).getTime() / 1000));

    const MAX_PAGES_PER_RUN = 10;
    // Pages reserved for the backward pass so a large forward gap cannot starve
    // the backfill of its pages.
    const BACKWARD_RESERVED_PAGES = 2;
    // Requests deliberately left unspent so an in-flight backfill cannot starve
    // other users' syncs (or the webhook path) of quota.
    const RESERVED_REQUESTS = 20;
    const delayBetweenPagesMs = 350;

    type PassDirection = 'forward' | 'backward';
    const passes: Array<{ direction: PassDirection; params: URLSearchParams; maxPages: number }> = [];

    // Forward pass: gap-fill since the incremental window. Runs for every
    // incremental, and for a backfill whenever rows are already stored (the
    // reconnect gap is [last_sync_at, now] and must not be skipped).
    if (!isBackfill || newestStored?.started_at) {
      const forward = new URLSearchParams({ per_page: '200' });
      if (incrementalWindow) forward.set('after', toEpoch(incrementalWindow.after));
      passes.push({
        direction: 'forward',
        params: forward,
        maxPages: isBackfill ? MAX_PAGES_PER_RUN - BACKWARD_RESERVED_PAGES : MAX_PAGES_PER_RUN,
      });
    }

    // Backward pass: walk into the past from the oldest stored activity (or
    // from the present when nothing is stored). `before` is exclusive; the
    // boundary activity is already stored, and upserts are idempotent even if
    // Strava treats it as inclusive.
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
        oldestStoredMs = new Date(oldestStored.started_at as string).getTime();
        backward.set('before', toEpoch(oldestStored.started_at as string));
        console.log(`Strava backfill resuming before ${oldestStored.started_at}`);
      }
      passes.push({ direction: 'backward', params: backward, maxPages: MAX_PAGES_PER_RUN });
    }

    const passResults = new Map<PassDirection, { complete: boolean; startsMs: number[] }>();
    // Dedupes across passes: a reconnect gap and a backfill can both return the
    // same activity when the gap reaches past the oldest stored row.
    const fetchedById = new Map<string, StravaActivityRaw>();

    let budgetExhausted = false;
    let pagesUsed = 0;
    let lastSnapshot: StravaRateLimitSnapshot | null = null;

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
        pagesUsed++;

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
              `${fetchedById.size} activities fetched before the limit`,
          );
          // Stop cleanly rather than erroring: activities already fetched are
          // persisted below, and last_sync_at is withheld so the queue retry
          // resumes from the same cutoff.
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

          // The provider's body is logged above and never returned: it is
          // attacker-influenced text that would otherwise be echoed to the
          // browser and copied into sync_queue.error_message by the processor.
          return new Response(
            JSON.stringify({
              error: 'Failed to fetch Strava activities',
              code: `provider_fetch_failed_${activitiesResponse.status}`,
            }),
            { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }

        const pageActivities: StravaActivityRaw[] = await activitiesResponse.json();
        for (const activity of pageActivities) {
          fetchedById.set(String(activity.id), activity);
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
        await new Promise((r) => setTimeout(r, delayBetweenPagesMs));
      }
      if (budgetExhausted) break;
    }

    const passIncomplete = (direction: PassDirection) =>
      passes.some((pass) => pass.direction === direction) &&
      passResults.get(direction)?.complete !== true;
    // Either pass stopped short of its end (page ceiling, budget reserve, 429).
    const moreRemaining = passIncomplete('forward') || passIncomplete('backward');
    const rawActivities = [...fetchedById.values()];

    // ---------------------------------------------------------------
    // Normalize and upsert activities
    // ---------------------------------------------------------------
    const errors: string[] = [];
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
        const rows = chunkRaw.map((raw) =>
          buildExternalActivityRow(userId, raw, syncedAt)
        );

        const { error: upsertError } = await supabase
          .from('external_activities')
          .upsert(rows, { onConflict: 'user_id,provider,external_id' });

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
      // `errors` carries raw Postgres/driver text (constraint names, column
      // names, sometimes row values). Log it, never return it.
      console.error('Strava activity persistence failures:', errors);
      // Keep status 'connected' so the queued 502 retry can re-enter this
      // handler (it rejects any non-connected integration with a 404). We only
      // record the error and withhold the last_sync_at advance.
      await supabase
        .from('user_integrations')
        .update({ error_message: failMessage })
        .eq('user_id', userId)
        .eq('provider', 'strava');

      return new Response(
        JSON.stringify({
          error: failMessage,
          code: 'persist_failed',
          synced_count: syncedCount,
          failed_count: failedCount,
        }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ---------------------------------------------------------------
    // A pass stopped short of its end (page ceiling, budget reserve, 429).
    // Everything fetched IS persisted, but activities remain upstream, so the
    // watermark must not advance past them. Report retryably and let the queue
    // resume from the forward pass's newest fully-read start.
    // ---------------------------------------------------------------
    if (moreRemaining) {
      // Forward resume point: the newest activity the forward pass actually
      // read (only when its start times are in ascending order — Strava
      // returns newest-first for `before` pages, and an out-of-order forward
      // page means we cannot say what the contiguous window covered).
      let forwardResumeAt: string | null = null;
      let forwardProgress = false;
      const forwardResult = passResults.get('forward');
      const forwardAnchorMs = incrementalWindow?.anchor.getTime() ?? null;

      if (forwardResult?.complete) {
        // Forward finished; the gap is covered. Keep the old watermark so the
        // next incremental still reaches back over the lookback window.
        // (Only a complete run may advance past the anchor.)
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
          // Only advance when there WAS a prior watermark: a first backfill's
          // resume point is the oldest stored row (the `before` cursor), not
          // the forward window.
          if (previousWatermark !== null) {
            forwardResumeAt = new Date(newestFetchedMs).toISOString();
          }
        }
      }

      // Backward progress: the backward pass fetched at least one activity
      // older than the oldest previously stored, so the next `before` cursor
      // will be strictly earlier.
      const backwardStarts = passResults.get('backward')?.startsMs ?? [];
      const backwardProgress =
        backwardStarts.length > 0 &&
        (oldestStoredMs === null ||
          backwardStarts.reduce((min, ms) => Math.min(min, ms), Infinity) < oldestStoredMs);

      // A retry is only safe when this run actually advanced a resume point.
      // If neither pass moved, the next attempt would reissue identical
      // requests and spin until the retry cap — fail terminally instead.
      const madeProgress = forwardProgress || backwardProgress;
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
    // window fetched contiguously:
    //  - complete run against an EXISTING watermark: the forward pass (when
    //    present) covered [lookback, syncStartedAt], so the watermark may
    //    advance to this run's start. This supersedes _shared/syncWatermark.ts's
    //    `initial` carve-out, which assumed a single-pass backfill-only initial
    //    that never reached into [last_sync_at, now]. Two-pass fills that gap,
    //    so advancing is safe and the next incremental still overlaps via
    //    the 72h lookback.
    //  - first backfill (no watermark): runs newest-first and may resume
    //    across queue passes, so the contiguous window ends at the newest
    //    activity stored, not at this run's clock (activities uploaded
    //    between the first and the final backfill pass are then fetched by
    //    the next incremental, idempotently).
    // ---------------------------------------------------------------
    let watermark: string | null;
    if (previousWatermark !== null) {
      // Complete run with a prior watermark: forward (if any) covered through
      // this instant. SyncStartedAt is the safe upper bound.
      watermark = syncStartedAt;
    } else {
      // First backfill: newest stored activity is how far the contiguous
      // window reaches. Never the clock — that would skip uploads that landed
      // during the backfill. Re-query: the pre-fetch snapshot was empty.
      const { data: newestAfterBackfill } = await supabase
        .from('external_activities')
        .select('started_at')
        .eq('user_id', userId)
        .eq('provider', 'strava')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const newestMs = newestAfterBackfill?.started_at
        ? Date.parse(newestAfterBackfill.started_at as string)
        : Number.NaN;
      const contiguousUpTo =
        Number.isFinite(newestMs) && newestMs < Date.parse(syncStartedAt)
          ? new Date(newestMs).toISOString()
          : syncStartedAt;
      watermark = nextWatermark({
        syncType: sync_type,
        previous: previousWatermark,
        contiguousUpTo,
      });
    }
    await supabase
      .from('user_integrations')
      .update({
        ...(watermark ? { last_sync_at: watermark } : {}),
        status: 'connected',
        error_message: null,
      })
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
    // Whatever threw (a driver error, a provider parse failure) is logged
    // here and summarised to the caller as a stable code: its message can
    // carry DB internals or provider text.
    console.error('Strava sync error:', err);
    return new Response(
      JSON.stringify({ error: 'Strava sync failed', code: 'internal_error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}
