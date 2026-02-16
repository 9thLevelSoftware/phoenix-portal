import { z } from 'zod';
import type { NormalizedActivity } from './types';

// =============================================================================
// Re-export the normalizer from normalize.ts for convenience
// =============================================================================

export { normalizeStravaActivity } from './normalize';

// =============================================================================
// Strava Activity Zod Schema (v3 API response validation)
// Source: https://developers.strava.com/docs/reference/#api-Activities
// =============================================================================

export const StravaActivitySchema = z.object({
  id: z.number(),
  name: z.string(),
  sport_type: z.string(),
  start_date: z.string(),
  elapsed_time: z.number(),
  distance: z.number().optional().default(0),
  kilojoules: z.number().nullable().optional(),
  average_heartrate: z.number().nullable().optional(),
  max_heartrate: z.number().nullable().optional(),
  total_elevation_gain: z.number().optional().default(0),
});

export type StravaActivity = z.infer<typeof StravaActivitySchema>;

// =============================================================================
// Strava OAuth Flow
// =============================================================================

/**
 * Initiate Strava OAuth connection by redirecting the user to Strava's
 * authorization page. After authorization, Strava redirects to our
 * strava-oauth Edge Function with the authorization code.
 *
 * @param userId - The authenticated user's ID, passed as OAuth state parameter
 */
export function initiateStravaConnect(userId: string): void {
  const clientId = import.meta.env.VITE_STRAVA_CLIENT_ID;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  if (!clientId) {
    console.error('VITE_STRAVA_CLIENT_ID is not configured');
    return;
  }

  if (!supabaseUrl) {
    console.error('VITE_SUPABASE_URL is not configured');
    return;
  }

  // The redirect_uri points to our strava-oauth Edge Function
  const redirectUri = `${supabaseUrl}/functions/v1/strava-oauth`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'activity:read_all',
    state: userId,
    approval_prompt: 'auto',
  });

  window.location.href = `https://www.strava.com/oauth/authorize?${params}`;
}

// =============================================================================
// Strava sport type mapping (for client-side display)
// =============================================================================

export const STRAVA_SPORT_TYPES: Record<string, string> = {
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
