import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { errorMessage } from '../_shared/errorMessage.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
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
import { nextWatermark } from '../_shared/syncWatermark.ts';
import { isServiceRoleBearer } from '../_shared/timingSafe.ts';

/**
 * Loose Supabase client type for helper signatures. Annotating helpers with the
 * bare `ReturnType<typeof createClient>` makes table payload types resolve to
 * `never` (TS2345), so explicit `any` schema generics are required here.
 */
type DbClient = SupabaseClient<any, any, any>;

/**
 * Injection points, so handler tests never reach Fitbit, Supabase or the real
 * environment. Every field is optional; the defaults are what production runs.
 */
export interface FitbitSyncHandlerDependencies {
  env?: (key: string) => string | undefined;
  // deno-lint-ignore no-explicit-any
  createClient?: (url: string, key: string, options?: any) => DbClient;
  /** Used for Fitbit API calls; defaults to global fetch. */
  fetch?: typeof fetch;
}

interface FitbitSyncDependencies {
  env: (key: string) => string | undefined;
  // deno-lint-ignore no-explicit-any
  createClient: (url: string, key: string, options?: any) => DbClient;
  fetch: typeof fetch;
}

function resolveDeps(d: FitbitSyncHandlerDependencies): FitbitSyncDependencies {
  return {
    env: d.env ?? ((key: string) => Deno.env.get(key)),
    createClient: d.createClient ??
      // deno-lint-ignore no-explicit-any
      ((url: string, key: string, options?: any) => createClient(url, key, options)),
    fetch: d.fetch ?? ((input, init) => fetch(input, init)),
  };
}

/**
 * Fitbit's documented ceiling: 150 requests per hour, per authorized user,
 * resetting at the top of each hour.
 * https://dev.fitbit.com/build/reference/web-api/troubleshooting-guide/rate-limits/
 */
const FITBIT_HOURLY_LIMIT = 150;

/**
 * Start of the current clock hour, in UTC.
 *
 * Fitbit's quota resets on the hour, so a 429 should mark the window as having
 * begun at the last hour boundary. Stamping `now` instead would hold the user
 * out for a full hour from the moment they were throttled — up to 59 minutes
 * longer than Fitbit actually requires.
 */
function topOfCurrentHour(): string {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.toISOString();
}

interface FitbitTokens {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}

/**
 * Save in-run integration state, or a response that stops the run.
 * `null` means the save landed and the caller should continue.
 */
type FitbitStateSave = (
  values: Record<string, unknown>,
  failureCode: string,
) => Promise<Response | null>;

/**
 * Refresh Fitbit access token if expired or about to expire (<10 min remaining).
 * Fitbit uses Basic auth for token refresh, same as initial exchange.
 * Returns updated tokens, a response that stops the run (the state save was
 * refused or failed), or throws on failure after a successful state save.
 * `oauth_tokens` writes stay direct; only integration status goes through
 * `saveState`.
 */
async function refreshTokenIfNeeded(
  supabase: DbClient,
  userId: string,
  tokens: FitbitTokens,
  deps: FitbitSyncDependencies,
  saveState: FitbitStateSave,
): Promise<FitbitTokens | Response> {
  const expiresAt = new Date(tokens.token_expires_at).getTime();
  const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;

  if (expiresAt > tenMinutesFromNow) {
    return tokens; // Token still valid
  }

  console.log('Fitbit token expired or expiring soon, refreshing...');

  const basicAuth = btoa(`${deps.env('FITBIT_CLIENT_ID')}:${deps.env('FITBIT_CLIENT_SECRET')}`);

  const response = await deps.fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    // Status only. Fitbit's body can carry tokens; Strava refresh drops it
    // the same way (`_shared/stravaToken.ts`) and never writes it to a log.
    await response.body?.cancel();
    console.error('Fitbit token refresh failed:', response.status);

    // A run that no longer owns its queue row must not mark the integration
    // token_expired. The oauth response itself is not stored.
    const stopped = await saveState(
      { status: 'token_expired', error_message: 'Token refresh failed' },
      'state_save_failed',
    );
    if (stopped) return stopped;

    throw new Error(`Fitbit token refresh failed: ${response.status}`);
  }

  const refreshed = await response.json();
  const newTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  // Update stored tokens in oauth_tokens (server-only table). Fitbit rotates the
  // refresh token on every refresh, so if this write fails the stored refresh
  // token is stale and future syncs cannot refresh. Fail instead of continuing.
  const { error: tokenPersistError } = await supabase
    .from('oauth_tokens')
    .update({
      access_token: await encryptOAuthSecret(refreshed.access_token),
      refresh_token: await encryptOAuthSecret(refreshed.refresh_token),
      token_expires_at: newTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'fitbit');

  if (tokenPersistError) {
    console.error('Failed to persist refreshed Fitbit tokens:', tokenPersistError);
    const stopped = await saveState(
      { status: 'error', error_message: 'Failed to persist refreshed tokens' },
      'state_save_failed',
    );
    if (stopped) return stopped;
    throw new Error('Failed to persist refreshed Fitbit tokens');
  }

  return {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    token_expires_at: newTokenExpiresAt,
  };
}

/**
 * Normalize a Fitbit activity to the Phoenix external_activities format.
 *
 * Key conversions:
 * - duration: Fitbit provides milliseconds -> convert to seconds
 * - distance: Fitbit provides km -> convert to meters
 * - logId: numeric -> string external_id
 */
function normalizeFitbitActivity(activity: Record<string, unknown>): Record<string, unknown> {
  const logId = activity.logId as number;
  const activityName = activity.activityName as string;
  const startTime = activity.startTime as string;
  const durationMs = activity.duration as number;
  const distanceKm = activity.distance as number | undefined;
  const calories = activity.calories as number | undefined;
  const avgHr = activity.averageHeartRate as number | undefined;
  const elevationGain = activity.elevationGain as number | undefined;

  return {
    external_id: String(logId),
    provider: 'fitbit',
    name: activityName ?? 'Fitbit Activity',
    activity_type: mapFitbitActivityType(activity.activityTypeId as number),
    started_at: startTime,
    duration_seconds: Math.round(durationMs / 1000),
    distance_meters: distanceKm != null ? Math.round(distanceKm * 1000) : null,
    calories: calories ?? null,
    avg_heart_rate: avgHr ?? null,
    max_heart_rate: null, // Fitbit activity list doesn't include max HR
    elevation_gain_meters: elevationGain ?? null,
  };
}

/**
 * Map Fitbit activityTypeId to a generic activity type string.
 * Fitbit uses numeric IDs for activity types.
 * See: https://dev.fitbit.com/build/reference/web-api/activity/get-all-activity-types/
 */
function mapFitbitActivityType(typeId: number): string {
  const mapping: Record<number, string> = {
    90013: 'running',     // Run
    90009: 'cycling',     // Bike
    90024: 'swimming',    // Swim
    90001: 'walking',     // Walk
    90019: 'hiking',      // Hike
    15000: 'strength',    // Sport > Weights
    15670: 'strength',    // Workout
    90030: 'flexibility', // Yoga
    90004: 'cardio',      // Elliptical
    1160:  'rowing',      // Rowing Machine
  };
  return mapping[typeId] ?? 'other';
}

/**
 * Fitbit meters 150 requests/hour for EACH authorized user, resetting at the
 * top of the hour — the quota is not shared across the application. The row is
 * therefore keyed (key='fitbit', user_id=<user>), matching the
 * `uq_rate_limit_key_user` unique index.
 *
 * This previously wrote a single user_id IS NULL row, which made every Fitbit
 * user contend for one 120/hour bucket and capped total throughput at a single
 * user's allowance no matter how many users connected.
 */
async function upsertFitbitRateLimitRow(
  supabase: DbClient,
  userId: string,
  fields: Record<string, unknown>,
) {
  const { data: existing } = await supabase
    .from('rate_limit_tracking')
    .select('id')
    .eq('key', 'fitbit')
    .eq('user_id', userId)
    .maybeSingle();
  if (!existing) {
    await supabase.from('rate_limit_tracking').insert({
      key: 'fitbit',
      provider: 'fitbit',
      user_id: userId,
      requests_this_window: 0,
      window_started_at: new Date().toISOString(),
      ...fields,
    });
  } else {
    await supabase.from('rate_limit_tracking').update(fields).eq('id', existing.id);
  }
}

/**
 * Fitbit Activity Sync Edge Function.
 *
 * Fetches activities from Fitbit API, normalizes them, and upserts to external_activities.
 * Handles pagination (offset-based) and token refresh.
 *
 * Called by the sync queue processor or manually via integration management UI.
 * The body may also carry `claim_generation` (`sync_queue.retry_count` of the
 * claim this dispatch holds). In-run `user_integrations` state writes go
 * through `save_sync_state_if_queue_owned` and must still match it.
 * `oauth_tokens` writes stay direct.
 */
async function runFitbitSync(
  req: Request,
  owned: OwnedQueueRow,
  deps: FitbitSyncDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);

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
    let ownedQueueId = dispatchedQueueId;

    const supabase = deps.createClient(
      deps.env('SUPABASE_URL')!,
      deps.env('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Cap browser-initiated invocations per user. Keyed on the JWT-verified
    // id, so nobody can spend another user's budget; the queue path (service
    // role) is exempt and has its own budget under the `fitbit` key.
    if (jwtUser) {
      const rateCheck = await checkManualSyncRateLimit(
        supabase,
        { provider: 'fitbit', userId },
        cors,
      );
      if (!rateCheck.allowed) return rateCheck.response!;
    }

    // Subscription gate — FLAME or higher required for integrations
    const gate = await requireSubscription(supabase, userId, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    if (!calledByQueueProcessor) {
      const created = await createSyncQueueEntry(supabase, {
        userId,
        provider: 'fitbit',
        syncType: sync_type,
      });
      if (created.conflict) return syncAlreadyQueuedResponse(cors);
      if (!created.queueId) return syncQueueUnavailableResponse(cors);
      ownedQueueId = created.queueId;
      owned.supabase = supabase;
      owned.queueId = ownedQueueId;
      owned.userId = userId;
    }

    // The claim generation of this run's row. process-sync-queue's stale-
    // lease reclaim increments retry_count before another worker takes the
    // same id, so a state save that also matches retry_count cannot be made
    // by a worker whose lease was reclaimed. process-sync-queue passes the
    // generation it claimed; a row this run created itself starts at 0. Only
    // a dispatcher that predates claim_generation makes the run read it (and
    // fail retryably if it cannot).
    let ownedAttempt: number | null = null;
    if (dispatchedQueueId && Number.isInteger(body.claim_generation)) {
      ownedAttempt = body.claim_generation as number;
    } else if (dispatchedQueueId) {
      const { data: claimRow, error: claimError } = await supabase
        .from('sync_queue')
        .select('retry_count')
        .eq('id', dispatchedQueueId)
        .eq('user_id', userId)
        .maybeSingle();
      if (claimError) {
        console.error('Failed to read the sync queue claim:', claimError);
        return new Response(
          JSON.stringify({ error: 'Sync temporarily unavailable', code: 'queue_claim_unreadable' }),
          { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      ownedAttempt = Number((claimRow as { retry_count?: number } | null)?.retry_count ?? 0);
    } else if (ownedQueueId) {
      ownedAttempt = 0;
    }

    const notOwned = () =>
      new Response(
        JSON.stringify({
          error: "Sync queue entry is no longer this run's",
          code: 'queue_not_owned',
        }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } },
      );

    // Sync state is saved only while this run still owns its queue row,
    // atomically under the row lock (20260924150000). A disconnect or a
    // lease reclaim between a check and the write can no longer be undone.
    // A run with no queue row (p_queue_id null) always saves — that is the
    // RPC's contract, so a dispatch that never had a row still records state.
    const saveStateIfOwned = async (values: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc('save_sync_state_if_queue_owned', {
        p_user_id: userId,
        p_provider: 'fitbit',
        p_queue_id: ownedQueueId ?? null,
        p_attempt: ownedAttempt,
        p_state: values,
      });
      return { owned: data !== false, error };
    };

    const stopUnlessStateSaved = async (
      values: Record<string, unknown>,
      failureCode: string,
    ): Promise<Response | null> => {
      const save = await saveStateIfOwned(values);
      if (save.error) {
        // No plain follow-up write: that is the window this RPC exists to close.
        console.error('Fitbit sync state save failed:', save.error);
        return new Response(
          JSON.stringify({ error: 'Fitbit sync failed; will retry', code: failureCode }),
          { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
        );
      }
      if (!save.owned) return notOwned();
      return null;
    };

    // Get user's Fitbit tokens from oauth_tokens (server-only table)
    const { data: tokenData, error: tokenFetchError } = await supabase
      .from('oauth_tokens')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .single();

    const { data: integration } = await supabase
      .from('user_integrations')
      .select('last_sync_at, status')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .single();

    if (tokenFetchError || !tokenData || integration?.status !== 'connected') {
      return new Response(
        JSON.stringify({ error: 'Fitbit integration not found or not connected' }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const rawTok = tokenData as FitbitTokens;
    const decrypted: FitbitTokens = {
      access_token: (await decryptOAuthSecret(rawTok.access_token)) ?? '',
      refresh_token: (await decryptOAuthSecret(rawTok.refresh_token)) ?? '',
      token_expires_at: rawTok.token_expires_at,
    };

    // Refresh token if needed. A refused or failed state save stops the run
    // before any activity fetch; a refresh that saved its state still throws
    // and lands in the handler's 500 below.
    const refreshed = await refreshTokenIfNeeded(
      supabase,
      userId,
      decrypted,
      deps,
      stopUnlessStateSaved,
    );
    if (refreshed instanceof Response) return refreshed;
    const tokens = refreshed;

    // Captured before fetching: the next incremental window starts here.
    const syncStartedAt = new Date().toISOString();

    // Determine the starting date for activity fetch
    // For initial sync: go back 90 days. For incremental: since last sync.
    const afterDate = sync_type === 'initial' || !integration?.last_sync_at
      ? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : (integration.last_sync_at as string).split('T')[0];

    // Fetch activities with pagination
    let offset = 0;
    const limit = 100;
    let totalSynced = 0;
    let hasMore = true;

    while (hasMore) {
      const activitiesUrl = new URL('https://api.fitbit.com/1/user/-/activities/list.json');
      activitiesUrl.searchParams.set('afterDate', afterDate);
      activitiesUrl.searchParams.set('sort', 'asc');
      activitiesUrl.searchParams.set('offset', String(offset));
      activitiesUrl.searchParams.set('limit', String(limit));

      const activitiesResponse = await deps.fetch(activitiesUrl.toString(), {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      });

      await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId);

      if (!activitiesResponse.ok) {
        // Status only, same as token refresh above. The body is cancelled
        // unread so it cannot reach a log.
        await activitiesResponse.body?.cancel();
        console.error('Fitbit activities fetch failed:', activitiesResponse.status);

        // Handle rate limiting
        if (activitiesResponse.status === 429) {
          await upsertFitbitRateLimitRow(supabase, userId, {
            requests_this_window: FITBIT_HOURLY_LIMIT,
            // Fitbit resets on the hour, not on a rolling window from the 429.
            // Anchoring to the top of the current hour releases this user at
            // the real reset instead of blocking them for a further hour.
            window_started_at: topOfCurrentHour(),
            last_request_at: new Date().toISOString(),
          });

          return new Response(
            JSON.stringify({ error: 'Rate limited', synced: totalSynced }),
            { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } },
          );
        }

        throw new Error(`Fitbit API error: ${activitiesResponse.status}`);
      }

      const data = await activitiesResponse.json();
      const activities = data.activities ?? [];

      if (activities.length === 0) {
        hasMore = false;
        break;
      }

      // Normalize and upsert activities
      const normalized = activities.map((activity: Record<string, unknown>) => ({
        user_id: userId,
        ...normalizeFitbitActivity(activity),
        raw_data: activity,
        synced_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from('external_activities')
        .upsert(normalized, { onConflict: 'user_id,provider,external_id' });

      if (upsertError) {
        console.error('Failed to upsert Fitbit activities:', upsertError);
        throw new Error(`Activity upsert failed: ${upsertError.message}`);
      }

      totalSynced += activities.length;
      offset += limit;

      // Fitbit pagination: if fewer than limit returned, no more pages
      if (activities.length < limit) {
        hasMore = false;
      }
    }

    // Update last_sync_at. An `initial` against an existing watermark fetched
    // the last 90 days, not necessarily everything since last_sync_at, so it
    // leaves the watermark alone (no window may be skipped; see
    // _shared/syncWatermark.ts).
    const watermark = nextWatermark({
      syncType: sync_type,
      previous: (integration?.last_sync_at as string | null) ?? null,
      contiguousUpTo: syncStartedAt,
    });
    // Saved only while this run still owns its queue row.
    const stopped = await stopUnlessStateSaved(
      {
        ...(watermark ? { last_sync_at: watermark } : {}),
        status: 'connected',
        error_message: null,
      },
      'watermark_save_failed',
    );
    if (stopped) return stopped;

    await upsertFitbitRateLimitRow(supabase, userId, {
      last_request_at: new Date().toISOString(),
    });

    // Complete only the row this run owns, and only in the claim generation
    // the state save just matched. Never sweep every pending row: a second
    // queued task (a kept `initial`) must still run.
    const completed = await completeSyncQueueEntry(supabase, {
      userId,
      provider: 'fitbit',
      queueId: ownedQueueId,
      claimGeneration: ownedAttempt,
    });
    if (!completed) {
      return new Response(
        JSON.stringify({
          error: 'Failed to complete the sync queue entry',
          code: 'queue_complete_failed',
        }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, synced: totalSynced }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    // `errorMessage` is a deliberate passthrough of `.message`, which for a
    // driver error carries constraint/column/relation names and for a parse
    // failure carries a slice of the provider's body. Log it, return a code.
    console.error('Fitbit sync error:', err);
    return new Response(
      JSON.stringify({ error: 'Fitbit sync failed', code: 'internal_error' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
}

export function createFitbitSyncHandler(
  dependencies: FitbitSyncHandlerDependencies = {},
): (req: Request) => Promise<Response> {
  const deps = resolveDeps(dependencies);
  return async (req) => {
    const owned = noOwnedQueueRow();
    const response = await runFitbitSync(req, owned, deps);
    if (!response.ok) await releaseOwnedQueueRow(owned);
    return response;
  };
}

if (import.meta.main) {
  Deno.serve(createFitbitSyncHandler());
}
