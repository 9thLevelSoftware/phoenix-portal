import { z } from "zod";
import { redirectToValidatedOAuthUrl } from "./oauthRedirect";
import type { NormalizedActivity } from "./types";

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

/**
 * Map Strava sport_type to a generic activity type.
 */
function mapStravaWireType(sportType: string): string {
	const mapping: Record<string, string> = {
		Run: "running",
		TrailRun: "running",
		VirtualRun: "running",
		Ride: "cycling",
		MountainBikeRide: "cycling",
		GravelRide: "cycling",
		VirtualRide: "cycling",
		Swim: "swimming",
		Walk: "walking",
		Hike: "hiking",
		WeightTraining: "strength",
		Crossfit: "strength",
		Yoga: "flexibility",
		Rowing: "rowing",
		Elliptical: "cardio",
		StairStepper: "cardio",
	};
	return mapping[sportType] ?? "other";
}

/**
 * Normalize a Strava API activity response into our unified format.
 */
export function normalizeStravaActivity(raw: unknown): NormalizedActivity {
	const activity = StravaActivitySchema.parse(raw);
	return {
		external_id: String(activity.id),
		provider: "strava",
		name: activity.name,
		activity_type: mapStravaWireType(activity.sport_type),
		started_at: activity.start_date,
		duration_seconds: activity.elapsed_time,
		distance_meters: activity.distance,
		calories: activity.kilojoules
			? Math.round(activity.kilojoules * 0.239)
			: null,
		avg_heart_rate: activity.average_heartrate ?? null,
		max_heart_rate: activity.max_heartrate ?? null,
		elevation_gain_meters: activity.total_elevation_gain,
	};
}

// =============================================================================
// Strava OAuth Flow
// =============================================================================

/**
 * Initiate Strava OAuth connection via the initiate-oauth Edge Function.
 * The server generates a cryptographic CSRF state token and returns
 * the Strava authorization URL.
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 */
export async function initiateStravaConnect(
	accessToken: string,
): Promise<void> {
	const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
	if (!supabaseUrl) {
		throw new Error("Supabase is not configured for OAuth redirects.");
	}

	const response = await fetch(`${supabaseUrl}/functions/v1/initiate-oauth`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ provider: "strava" }),
	});

	if (!response.ok) {
		throw new Error(
			`Failed to initiate Strava OAuth: ${await response.text()}`,
		);
	}

	const { url } = await response.json();
	redirectToValidatedOAuthUrl("strava", url);
}

// =============================================================================
// Strava sport type mapping (for client-side display)
// =============================================================================

export const STRAVA_SPORT_TYPES: Record<string, string> = {
	Run: "running",
	TrailRun: "running",
	VirtualRun: "running",
	Ride: "cycling",
	MountainBikeRide: "cycling",
	GravelRide: "cycling",
	VirtualRide: "cycling",
	Swim: "swimming",
	Walk: "walking",
	Hike: "hiking",
	WeightTraining: "strength",
	Crossfit: "strength",
	Yoga: "flexibility",
	Rowing: "rowing",
	Elliptical: "cardio",
	StairStepper: "cardio",
};
