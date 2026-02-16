import { z } from 'zod';
import type { NormalizedActivity } from './types';

// =============================================================================
// Garmin Activity Schema
// Source: https://developer.garmin.com/gc-developer-program/activity-api/
// =============================================================================

export const garminActivitySchema = z.object({
  activityId: z.number(),
  activityName: z.string().optional().default('Garmin Activity'),
  activityType: z.string(),
  startTimeInSeconds: z.number(), // Unix epoch seconds
  startTimeOffsetInSeconds: z.number().optional().default(0),
  durationInSeconds: z.number(),
  distanceInMeters: z.number().optional(),
  activeKilocalories: z.number().optional(),
  averageHeartRateInBeatsPerMinute: z.number().optional(),
  maxHeartRateInBeatsPerMinute: z.number().optional(),
  elevationGainInMeters: z.number().optional(),
});

export type GarminActivity = z.infer<typeof garminActivitySchema>;

/**
 * Map Garmin activity type string to a generic activity type.
 * Garmin uses uppercase descriptive string types.
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
 * Normalize a Garmin API activity response into the unified NormalizedActivity format.
 * Validates with Zod.
 *
 * Garmin already uses metric units (meters, seconds), so minimal conversion needed.
 * - startTimeInSeconds: epoch seconds -> ISO string
 * - distanceInMeters: already in meters (no conversion)
 * - durationInSeconds: already in seconds (no conversion)
 */
export function normalizeGarminActivity(raw: unknown): NormalizedActivity {
  const activity = garminActivitySchema.parse(raw);

  // Convert epoch seconds to ISO string, accounting for timezone offset
  const startedAt = new Date(
    (activity.startTimeInSeconds + activity.startTimeOffsetInSeconds) * 1000,
  ).toISOString();

  return {
    external_id: String(activity.activityId),
    provider: 'garmin',
    name: activity.activityName,
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

/**
 * Initiate Garmin Connect OAuth 1.0a connection flow.
 *
 * Unlike OAuth 2.0, OAuth 1.0a requires a server-side request token step first.
 * We redirect to the garmin-oauth Edge Function which handles the full 3-legged flow:
 * 1. Edge Function gets request token from Garmin
 * 2. Edge Function redirects user to Garmin authorization
 * 3. Garmin redirects back to Edge Function callback
 * 4. Edge Function exchanges for access token and stores
 *
 * NOTE: Garmin developer program approval may be pending.
 * This function is ready but untested until credentials are available.
 */
export function initiateGarminConnect(userId: string): void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  // Redirect to the garmin-oauth Edge Function which handles the OAuth 1.0a initiation
  window.location.href = `${supabaseUrl}/functions/v1/garmin-oauth?user_id=${encodeURIComponent(userId)}`;
}
