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
import { completeSyncQueueEntry, heartbeatSyncQueueEntry } from '../_shared/syncQueue.ts';
import { nextWatermark } from '../_shared/syncWatermark.ts';
import {
  refreshStravaAccessToken,
  StravaRefreshError,
  type StravaRefreshedTokens,
  stravaTokenNeedsRefresh,
} from '../_shared/stravaToken.ts';

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
 *     completes, and the row whose lease it heartbeats)
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

// ---------------------------------------------------------------------------
// Token refresh (shared with the disconnect path: _shared/stravaToken.ts)
// ---------------------------------------------------------------------------

/**
 * The refresh itself, `StravaRefreshError` and `parseStravaErrorDetails` live
 * in `_shared/stravaToken.ts` (PR 54), shared with the disconnect path; PR 51's
 * `details` were folded in there. Only the classification helpers, which are
 * specific to this handler's retry/downgrade decision, stay local.
 */
const refreshAccessToken = refreshStravaAccessToken;

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

export interface StravaSyncAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface StravaSyncHandlerDependencies {
  /**
   * Optional when `env` + `createClient` are supplied instead (PR 31's
   * injection shape); the defaults below are built from those.
   */
  createAuthClient?(authorization: string): StravaSyncAuthClient;
  createAdminClient?(): DbClient;
  /** Pause between Strava pages. Injectable so tests need not wait. */
  sleep?(ms: number): Promise<void>;
  /** PR 31 injection points, used when the two factories are omitted. */
  env?: (key: string) => string | undefined;
  // deno-lint-ignore no-explicit-any
  createClient?: (url: string, key: string, options?: any) => DbClient;
  /** Used for Strava API calls; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Wall clock; defaults to `new Date()`. */
  now?: () => Date;
}

type ResolvedStravaSyncDeps = Required<StravaSyncHandlerDependencies>;

/**
 * Fill in every injection point so the handler body never has to branch. Two
 * fixture styles reach this handler: the client factories (PR 49/54 tests) and
 * `env` + `createClient` (PR 31/51 tests). Either one, or neither, is enough.
 */
function resolveDeps(d: StravaSyncHandlerDependencies): ResolvedStravaSyncDeps {
  const env = d.env ?? ((key: string) => Deno.env.get(key));
  const make = d.createClient ??
    // deno-lint-ignore no-explicit-any
    ((url: string, key: string, options?: any) => createClient(url, key, options));
  return {
    env,
    createClient: make,
    fetch: d.fetch ?? ((input, init) => fetch(input, init)),
    now: d.now ?? (() => new Date()),
    sleep: d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    createAuthClient: d.createAuthClient ??
      ((authorization: string) =>
        make(
          env('SUPABASE_URL')!,
          env('SUPABASE_ANON_KEY')!,
          { global: { headers: { Authorization: authorization } } },
        ) as unknown as StravaSyncAuthClient),
    createAdminClient: d.createAdminClient ??
      (() => make(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)),
  };
}

async function stravaSyncHandler(
  req: Request,
  deps: ResolvedStravaSyncDeps,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  const sleep = deps.sleep;

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
    const queueId = typeof body.queue_id === 'string' ? body.queue_id : null;
    const calledByQueueProcessor = !jwtUser;
    // Only the queue path holds a lease on a sync_queue row.
    const leaseQueueId = calledByQueueProcessor ? queueId : null;

    const supabase = deps.createAdminClient();

    // Renew the lease immediately: the processor claimed this row before it
    // called us, and the work below (subscription check, token refresh, page
    // fetches) must not be counted against that claim's clock.
    await heartbeatSyncQueueEntry(supabase, leaseQueueId, userId, deps.now());

    // Subscription gate — FLAME or higher required for integrations
    const gate = await requireSubscription(supabase, userId, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

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

        // A lost rotation race looks exactly like a revoked grant: the other
        // run has already exchanged (and thereby revoked) the token this run
        // read. Downgrade only while the rejected token is still the stored
        // one; otherwise the grant is alive and this run simply lost.
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
    // Capture the new watermark BEFORE fetching: anything Strava records while
    // this run is in flight falls inside the next window instead of behind it.
    const syncStartedAt = (deps.now()).toISOString();

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

        const activitiesResponse = await deps.fetch(
          `https://www.strava.com/api/v3/athlete/activities?${params}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            // PR 51: a hung provider request must not outlast the queue lease.
            signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
          }
        );
        pagesUsed++;

        // Record what Strava reports about our quota on every response, success
        // or failure — a 429 is exactly when this information matters most.
        lastSnapshot = parseStravaRateLimitHeaders(activitiesResponse.headers);
        await recordStravaUsage(supabase, lastSnapshot);
        // PR 51: renew the lease per page. The fetch phase is otherwise
        // silent, and a reclaimed row would be dispatched a second time while
        // this run is still alive.
        await heartbeatSyncQueueEntry(supabase, leaseQueueId, userId, deps.now());

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
      await heartbeatSyncQueueEntry(supabase, leaseQueueId, userId, deps.now());
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
      // Re-read AFTER persisting this run's rows: the newest stored start is
      // what the resumable backfill has actually reached.
      const { data: newestStoredAfterRun } = await supabase
        .from('external_activities')
        .select('started_at')
        .eq('user_id', userId)
        .eq('provider', 'strava')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const newestMs = newestStoredAfterRun?.started_at
        ? Date.parse(newestStoredAfterRun.started_at as string)
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
      .eq('user_id', userId)
      .eq('provider', 'strava');

    await completeSyncQueueEntry(supabase, {
      userId,
      provider: 'strava',
      syncType: sync_type,
      queueId,
      calledByQueueProcessor,
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
}

export function createStravaSyncHandler(
  deps: StravaSyncHandlerDependencies = {},
): (req: Request) => Promise<Response> {
  const resolved = resolveDeps(deps);
  return (req) => stravaSyncHandler(req, resolved);
}

if (import.meta.main) {
  Deno.serve(createStravaSyncHandler());
}
