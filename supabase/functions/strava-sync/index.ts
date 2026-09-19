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

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshAccessToken(
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string; expires_at: number }> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
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
  createAuthClient(authorization: string): StravaSyncAuthClient;
  createAdminClient(): DbClient;
}

function defaultStravaSyncDependencies(): StravaSyncHandlerDependencies {
  return {
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
  };
}

async function stravaSyncHandler(
  req: Request,
  deps: StravaSyncHandlerDependencies,
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
    const supabaseAuth = deps.createAuthClient(authHeader);
    const { data: { user: jwtUser } } = await supabaseAuth.auth.getUser();

    if (jwtUser) {
      // Browser-initiated: use JWT-verified user ID, ignore body.user_id
      userId = jwtUser.id;
    } else {
      // Not a valid user JWT -- must be service-role call from process-sync-queue
      // Verify the caller is actually using the service role key
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
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
    const tokenExpiresAt = tokens.token_expires_at
      ? new Date(tokens.token_expires_at).getTime()
      : 0;

    // ---------------------------------------------------------------
    // Refresh token if expired (with 60s buffer)
    // ---------------------------------------------------------------
    if (Date.now() >= tokenExpiresAt - 60_000) {
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
    const toEpoch = (iso: string | Date) =>
      String(Math.floor(new Date(iso).getTime() / 1000));

    const passes: URLSearchParams[] = [];

    if (!isBackfill || newestStored?.started_at) {
      const forward = new URLSearchParams({ per_page: '200' });
      if (incrementalWindow) forward.set('after', toEpoch(incrementalWindow.after));
      passes.push(forward);
    }

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
        backward.set('before', toEpoch(oldestStored.started_at as string));
        console.log(
          `Strava backfill resuming before ${oldestStored.started_at}`,
        );
      }
      passes.push(backward);
    }

    const rawActivities: StravaActivityRaw[] = [];
    const delayBetweenPagesMs = 350;

    // Strava's quotas are application-wide (100 reads / 15 min, 1,000 / day), so
    // a single user's backfill spends budget every other user shares. Cap the
    // pages one invocation may take (across all passes), and stop early once
    // Strava's own reported usage says we are close to the ceiling.
    const MAX_PAGES_PER_RUN = 10;
    // Requests deliberately left unspent so an in-flight backfill cannot starve
    // other users' syncs (or the webhook path) of quota.
    const RESERVED_REQUESTS = 20;

    let budgetExhausted = false;
    let pageCeilingReached = false;
    let pagesUsed = 0;
    let lastSnapshot: StravaRateLimitSnapshot | null = null;

    for (const baseParams of passes) {
      let page = 1;

      while (true) {
        if (pagesUsed >= MAX_PAGES_PER_RUN) {
          pageCeilingReached = true;
          break;
        }

        const params = new URLSearchParams(baseParams);
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
              `${rawActivities.length} activities fetched before the limit`,
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

          return new Response(
            JSON.stringify({ error: 'Failed to fetch Strava activities', details: errorText }),
            { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }

        const pageActivities: StravaActivityRaw[] = await activitiesResponse.json();
        rawActivities.push(...pageActivities);

        if (pageActivities.length < 200) {
          break;
        }

        // Consult Strava's reported headroom before spending another request.
        const budget = checkReadBudget(lastSnapshot, RESERVED_REQUESTS);
        if (!budget.hasHeadroom) {
          console.warn(
            `Strava read budget reserve reached (remaining=${budget.remaining}); ` +
              'pausing pagination until the window rolls over',
          );
          budgetExhausted = true;
          break;
        }

        page++;
        await new Promise((r) => setTimeout(r, delayBetweenPagesMs));
      }

      if (budgetExhausted || pageCeilingReached) break;
    }

    // Ran out of pages (or budget) with more to request: activities remain
    // upstream. Treat exactly like a partial failure below — persist what we
    // have, withhold the last_sync_at advance, let the queue resume.
    const moreRemaining = budgetExhausted || pageCeilingReached;

    // ---------------------------------------------------------------
    // Normalize and upsert activities
    // ---------------------------------------------------------------
    const errors: string[] = [];
    let syncedCount = 0;

    for (const raw of rawActivities) {
      try {
        const normalized = normalizeStravaActivity(raw);

        const { error: upsertError } = await supabase
          .from('external_activities')
          .upsert(
            {
              user_id: userId,
              ...normalized,
              raw_data: raw,
              synced_at: new Date().toISOString(),
            },
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
    // `after` cutoff must not advance past them. Same contract as the partial
    // failure above: report retryably and let the queue resume.
    // ---------------------------------------------------------------
    if (moreRemaining) {
      // A retry is only safe to schedule if THIS run actually advanced the
      // resume point. During backfill the resume point is the oldest stored
      // activity, so persisting at least one older activity guarantees the next
      // attempt requests a strictly earlier `before` window. If nothing was
      // persisted the retry would reissue an identical request and spin until
      // the retry cap, so fail terminally with a message that says why.
      const madeProgress = syncedCount > 0;
      const partialMessage = madeProgress
        ? `Fetched ${rawActivities.length} activities before reaching the Strava ` +
          'request budget; sync will resume from this point on the next queue pass'
        : `Reached the Strava request budget without persisting any activities; ` +
          'retrying would repeat the same request. Sync stopped.';

      console.warn(partialMessage);
      await supabase
        .from('user_integrations')
        .update({ error_message: partialMessage })
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
          status: madeProgress ? 502 : 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }
      );
    }

    // ---------------------------------------------------------------
    // Update last_sync_at (all activities persisted)
    // ---------------------------------------------------------------
    await supabase
      .from('user_integrations')
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
}

export function createStravaSyncHandler(
  deps: StravaSyncHandlerDependencies = defaultStravaSyncDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => stravaSyncHandler(req, deps);
}

if (import.meta.main) {
  Deno.serve(createStravaSyncHandler());
}
