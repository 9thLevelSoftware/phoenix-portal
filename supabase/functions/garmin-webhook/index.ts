import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Garmin Connect webhook handler for activity push notifications.
 *
 * Garmin sends POST requests to this endpoint when a user completes an activity.
 * The webhook payload contains activity summaries that we normalize and store.
 *
 * Garmin push notifications include:
 * - activities: Array of activity summaries
 * - activityDetails: Detailed activity data (if configured)
 *
 * NOTE: Garmin developer program approval may be pending.
 * This function is ready but untested until webhook registration is complete.
 */

/**
 * Garmin webhook activity payload types.
 * Based on Garmin Connect Activity API documentation.
 */
interface GarminWebhookPayload {
  activities?: GarminActivitySummary[];
  activityDetails?: GarminActivitySummary[];
}

interface GarminActivitySummary {
  userId: string; // Garmin user ID
  userAccessToken: string; // OAuth access token for this user
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeInSeconds: number; // Unix epoch seconds
  startTimeOffsetInSeconds: number;
  durationInSeconds: number;
  distanceInMeters?: number;
  activeKilocalories?: number;
  averageHeartRateInBeatsPerMinute?: number;
  maxHeartRateInBeatsPerMinute?: number;
  elevationGainInMeters?: number;
  summary?: Record<string, unknown>;
}

/**
 * Map Garmin activity type string to a generic activity type.
 * Garmin uses descriptive string types.
 */
function mapGarminActivityType(garminType: string): string {
  const mapping: Record<string, string> = {
    RUNNING: 'running',
    TRAIL_RUNNING: 'running',
    TREADMILL_RUNNING: 'running',
    CYCLING: 'cycling',
    MOUNTAIN_BIKING: 'cycling',
    INDOOR_CYCLING: 'cycling',
    SWIMMING: 'swimming',
    OPEN_WATER_SWIMMING: 'swimming',
    WALKING: 'walking',
    HIKING: 'hiking',
    STRENGTH_TRAINING: 'strength',
    YOGA: 'flexibility',
    PILATES: 'flexibility',
    ROWING: 'rowing',
    INDOOR_ROWING: 'rowing',
    ELLIPTICAL: 'cardio',
    STAIR_CLIMBING: 'cardio',
    FITNESS_EQUIPMENT: 'cardio',
  };
  return mapping[garminType] ?? 'other';
}

/**
 * Normalize a Garmin activity summary to Phoenix external_activities format.
 * Garmin already uses metric units, so minimal conversion needed.
 */
function normalizeGarminWebhookActivity(
  activity: GarminActivitySummary,
): Record<string, unknown> {
  // Convert epoch seconds to ISO string
  const startedAt = new Date(
    (activity.startTimeInSeconds + (activity.startTimeOffsetInSeconds ?? 0)) * 1000,
  ).toISOString();

  return {
    external_id: String(activity.activityId),
    provider: 'garmin',
    name: activity.activityName ?? 'Garmin Activity',
    activity_type: mapGarminActivityType(activity.activityType),
    started_at: startedAt,
    duration_seconds: activity.durationInSeconds,
    distance_meters: activity.distanceInMeters ?? null,
    calories: activity.activeKilocalories ?? null,
    avg_heart_rate: activity.averageHeartRateInBeatsPerMinute ?? null,
    max_heart_rate: activity.maxHeartRateInBeatsPerMinute ?? null,
    elevation_gain_meters: activity.elevationGainInMeters ?? null,
  };
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Garmin sends GET for webhook verification (ping)
  if (req.method === 'GET') {
    return new Response('OK', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }

  // Only accept POST for activity push notifications
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const payload: GarminWebhookPayload = await req.json();
    const activities = payload.activities ?? payload.activityDetails ?? [];

    if (activities.length === 0) {
      // Acknowledge receipt even if no activities (could be a ping or other event)
      return new Response(
        JSON.stringify({ received: true, processed: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let processed = 0;
    let errors = 0;

    for (const activity of activities) {
      try {
        // Look up the Phoenix user_id by Garmin provider_user_id
        const { data: integration, error: lookupError } = await supabase
          .from('user_integrations')
          .select('user_id')
          .eq('provider', 'garmin')
          .eq('provider_user_id', activity.userId)
          .eq('status', 'connected')
          .single();

        if (lookupError || !integration) {
          console.warn(
            `Garmin webhook: no connected user found for Garmin userId ${activity.userId}`,
          );
          errors++;
          continue;
        }

        const normalized = normalizeGarminWebhookActivity(activity);

        const { error: upsertError } = await supabase
          .from('external_activities')
          .upsert(
            {
              user_id: integration.user_id,
              ...normalized,
              raw_data: activity,
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,provider,external_id' },
          );

        if (upsertError) {
          console.error('Garmin webhook: failed to upsert activity:', upsertError);
          errors++;
          continue;
        }

        // Update last_sync_at for this user's Garmin integration
        await supabase
          .from('user_integrations')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('user_id', integration.user_id)
          .eq('provider', 'garmin');

        processed++;
      } catch (activityError) {
        console.error('Garmin webhook: error processing activity:', activityError);
        errors++;
      }
    }

    // Always return 200 to acknowledge receipt (Garmin may retry on non-200)
    return new Response(
      JSON.stringify({ received: true, processed, errors }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Garmin webhook error:', err);
    // Return 200 even on error to prevent Garmin from retrying endlessly
    // Log the error for debugging
    return new Response(
      JSON.stringify({ received: true, error: 'Processing error' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
