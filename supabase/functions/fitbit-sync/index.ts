import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

const FITBIT_CLIENT_ID = Deno.env.get('FITBIT_CLIENT_ID')!;
const FITBIT_CLIENT_SECRET = Deno.env.get('FITBIT_CLIENT_SECRET')!;

interface FitbitTokens {
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}

/**
 * Refresh Fitbit access token if expired or about to expire (<10 min remaining).
 * Fitbit uses Basic auth for token refresh, same as initial exchange.
 * Returns updated tokens or throws on failure.
 */
async function refreshTokenIfNeeded(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  tokens: FitbitTokens,
): Promise<FitbitTokens> {
  const expiresAt = new Date(tokens.token_expires_at).getTime();
  const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;

  if (expiresAt > tenMinutesFromNow) {
    return tokens; // Token still valid
  }

  console.log('Fitbit token expired or expiring soon, refreshing...');

  const basicAuth = btoa(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`);

  const response = await fetch('https://api.fitbit.com/oauth2/token', {
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
    const errorBody = await response.text();
    console.error('Fitbit token refresh failed:', response.status, errorBody);

    // Mark integration as error
    await supabase
      .from('user_integrations')
      .update({ status: 'token_expired', error_message: 'Token refresh failed' })
      .eq('user_id', userId)
      .eq('provider', 'fitbit');

    throw new Error(`Fitbit token refresh failed: ${response.status}`);
  }

  const refreshed = await response.json();
  const newTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  // Update stored tokens in oauth_tokens (server-only table)
  await supabase
    .from('oauth_tokens')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: newTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'fitbit');

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
 * Fitbit Activity Sync Edge Function.
 *
 * Fetches activities from Fitbit API, normalizes them, and upserts to external_activities.
 * Handles pagination (offset-based) and token refresh.
 *
 * Called by the sync queue processor or manually via integration management UI.
 */
Deno.serve(async (req) => {
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
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
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

    const { sync_type } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Subscription gate — FLAME or higher required for integrations
    const gate = await requireSubscription(supabase, userId, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

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

    if (tokenFetchError || !tokenData) {
      return new Response(
        JSON.stringify({ error: 'Fitbit integration not found' }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    // Refresh token if needed
    const tokens = await refreshTokenIfNeeded(supabase, userId, tokenData as FitbitTokens);

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

      const activitiesResponse = await fetch(activitiesUrl.toString(), {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
        },
      });

      if (!activitiesResponse.ok) {
        const errorBody = await activitiesResponse.text();
        console.error('Fitbit activities fetch failed:', activitiesResponse.status, errorBody);

        // Handle rate limiting
        if (activitiesResponse.status === 429) {
          // Update rate limit tracking
          await supabase.from('rate_limit_tracking').upsert(
            {
              provider: 'fitbit',
              requests_this_window: 150, // Mark as exhausted
              window_started_at: new Date().toISOString(),
              last_request_at: new Date().toISOString(),
            },
            { onConflict: 'provider' },
          );

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

    // Update last_sync_at
    await supabase
      .from('user_integrations')
      .update({
        last_sync_at: new Date().toISOString(),
        status: 'connected',
        error_message: null,
      })
      .eq('user_id', userId)
      .eq('provider', 'fitbit');

    // Update rate limit tracking
    await supabase.from('rate_limit_tracking').upsert(
      {
        provider: 'fitbit',
        last_request_at: new Date().toISOString(),
      },
      { onConflict: 'provider' },
    );

    await supabase
      .from('sync_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .in('status', ['pending', 'processing']);

    return new Response(
      JSON.stringify({ success: true, synced: totalSynced }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Fitbit sync error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
