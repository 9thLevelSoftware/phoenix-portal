import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

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

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const { user_id, sync_type = 'incremental' } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ---------------------------------------------------------------
    // Fetch user's Strava tokens
    // ---------------------------------------------------------------
    const { data: integration, error: fetchError } = await supabase
      .from('user_integrations')
      .select('access_token, refresh_token, token_expires_at, last_sync_at')
      .eq('user_id', user_id)
      .eq('provider', 'strava')
      .eq('status', 'connected')
      .single();

    if (fetchError || !integration) {
      return new Response(
        JSON.stringify({ error: 'Strava integration not found or not connected' }),
        { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = integration.access_token as string;
    const refreshToken = integration.refresh_token as string;
    const tokenExpiresAt = integration.token_expires_at
      ? new Date(integration.token_expires_at).getTime()
      : 0;

    // ---------------------------------------------------------------
    // Refresh token if expired (with 60s buffer)
    // ---------------------------------------------------------------
    if (Date.now() >= tokenExpiresAt - 60_000) {
      console.log('Strava access token expired, refreshing...');
      const refreshed = await refreshAccessToken(refreshToken);

      accessToken = refreshed.access_token;

      // Persist new tokens
      await supabase
        .from('user_integrations')
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
        })
        .eq('user_id', user_id)
        .eq('provider', 'strava');
    }

    // ---------------------------------------------------------------
    // Fetch activities from Strava
    // ---------------------------------------------------------------
    const params = new URLSearchParams({ per_page: '200', page: '1' });

    // For incremental sync, only fetch activities after last sync
    if (sync_type !== 'initial' && integration.last_sync_at) {
      const afterEpoch = Math.floor(
        new Date(integration.last_sync_at as string).getTime() / 1000
      );
      params.set('after', String(afterEpoch));
    }

    const activitiesResponse = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!activitiesResponse.ok) {
      const errorText = await activitiesResponse.text();
      console.error('Strava activities fetch failed:', activitiesResponse.status, errorText);

      // Mark integration as errored if 401 (token revoked)
      if (activitiesResponse.status === 401) {
        await supabase
          .from('user_integrations')
          .update({ status: 'token_expired', error_message: 'Access token revoked or invalid' })
          .eq('user_id', user_id)
          .eq('provider', 'strava');
      }

      return new Response(
        JSON.stringify({ error: 'Failed to fetch Strava activities', details: errorText }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const rawActivities: StravaActivityRaw[] = await activitiesResponse.json();

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
              user_id,
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
    // Update last_sync_at
    // ---------------------------------------------------------------
    await supabase
      .from('user_integrations')
      .update({ last_sync_at: new Date().toISOString(), error_message: null })
      .eq('user_id', user_id)
      .eq('provider', 'strava');

    // Update sync_queue entry if one exists
    await supabase
      .from('sync_queue')
      .update({
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('user_id', user_id)
      .eq('provider', 'strava')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);

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
});
