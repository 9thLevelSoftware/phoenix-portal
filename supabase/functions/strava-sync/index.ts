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
import { refreshStravaAccessToken, stravaTokenNeedsRefresh } from '../_shared/stravaToken.ts';
import { nextWatermark } from '../_shared/syncWatermark.ts';

/**
 * Loose Supabase client type for helper signatures. The bare
 * `ReturnType<typeof createClient>` collapses table payload types to `never`.
 */
type DbClient = SupabaseClient<any, any, any>;

/**
 * Strava Activity Sync Edge Function
 *
 * Fetches activities from Strava API, normalizes them, and upserts to
 * external_activities. Handles token refresh when access_token is expired.
 *
 * Request body:
 *   - user_id: string
 *   - sync_type: 'initial' | 'manual' | 'incremental'
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

async function completeSyncQueueEntry(
  supabase: DbClient,
  options: {
    userId: string;
    provider: string;
    syncType: string;
    queueId: string | null;
    calledByQueueProcessor: boolean;
  },
) {
  const targetStatus = options.calledByQueueProcessor ? 'processing' : 'pending';
  let queueId = options.queueId;

  if (queueId) {
    const { data: queueRow, error: selectError } = await supabase
      .from('sync_queue')
      .select('id')
      .eq('id', queueId)
      .eq('user_id', options.userId)
      .eq('provider', options.provider)
      .eq('status', targetStatus)
      .maybeSingle();

    if (selectError) {
      console.error(`Failed to verify ${options.provider} sync queue entry:`, selectError);
      return;
    }

    if (!queueRow) return;
    queueId = queueRow.id;
  }

  if (!queueId) {
    let query = supabase
      .from('sync_queue')
      .select('id')
      .eq('user_id', options.userId)
      .eq('provider', options.provider)
      .eq('status', targetStatus);

    if (!options.calledByQueueProcessor) {
      query = query.eq('sync_type', options.syncType);
    }

    const { data: queueRow, error: selectError } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      console.error(`Failed to find ${options.provider} sync queue entry:`, selectError);
      return;
    }

    queueId = queueRow?.id ?? null;
  }

  if (!queueId) return;

  const { error: updateError } = await supabase
    .from('sync_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', queueId)
    .eq('user_id', options.userId)
    .eq('provider', options.provider)
    .eq('status', targetStatus);

  if (updateError) {
    console.error(`Failed to complete ${options.provider} sync queue entry:`, updateError);
  }
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
  req: Request,
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
    const queueId = typeof body.queue_id === 'string' ? body.queue_id : null;
    const calledByQueueProcessor = !jwtUser;

    const supabase = deps.createClient(
      deps.env('SUPABASE_URL')!,
      deps.env('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const supabase = deps.createAdminClient();

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
      const refreshed = await refreshAccessToken(refreshToken);

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

    for (const raw of rawActivities) {
      try {
        const { error: upsertError } = await supabase
          .from('external_activities')
          .upsert(
            buildExternalActivityRow(userId, raw, new Date().toISOString()),
            { onConflict: 'user_id,provider,external_id' }
          );

        if (upsertError) {
          errors.push(`Activity ${raw.id}: ${upsertError.message}`);
        } else {
          syncedCount++;
        }
      } catch (err) {
        errors.push(`Activity ${raw.id}: ${(err as Error).message}`);
      }
    }

    // ---------------------------------------------------------------
    // If any activity failed to persist, do NOT advance last_sync_at: it is the
    // `after` cutoff for the next incremental sync, so advancing it would skip
    // the failed activities permanently. Leave the queue entry pending so the
    // processor retries (upserts are idempotent), and surface a 502.
    // ---------------------------------------------------------------
    if (errors.length > 0) {
      const failMessage = `Failed to persist ${errors.length} of ${rawActivities.length} activities`;
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
