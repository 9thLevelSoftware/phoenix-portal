import { z } from "zod";
import type { IntegrationProvider, NormalizedActivity } from "./types";

// =============================================================================
// Strava Activity Schema (v3 API)
// Source: https://developers.strava.com/docs/reference/#api-Activities
// =============================================================================

const stravaActivitySchema = z.object({
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

type StravaActivity = z.infer<typeof stravaActivitySchema>;

/**
 * Map Strava sport_type to a generic activity type.
 * Strava has ~70+ sport types; we normalize to common categories.
 */
function mapStravaType(sportType: string): string {
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
 * Validates with Zod and converts units to metric.
 */
export function normalizeStravaActivity(raw: unknown): NormalizedActivity {
	const activity = stravaActivitySchema.parse(raw);
	return {
		external_id: String(activity.id),
		provider: "strava",
		name: activity.name,
		activity_type: mapStravaType(activity.sport_type),
		started_at: activity.start_date,
		duration_seconds: activity.elapsed_time,
		distance_meters: activity.distance,
		// Strava reports energy in kilojoules; convert to kcal (1 kJ = 0.239 kcal)
		calories: activity.kilojoules
			? Math.round(activity.kilojoules * 0.239)
			: null,
		avg_heart_rate: activity.average_heartrate ?? null,
		max_heart_rate: activity.max_heartrate ?? null,
		elevation_gain_meters: activity.total_elevation_gain,
	};
}

// Fitbit normalizer is now fully implemented in fitbit.ts
export { normalizeFitbitActivity } from "./fitbit";

// Garmin normalizer is now fully implemented in garmin.ts
export { normalizeGarminActivity } from "./garmin";

// Hevy normalizer is now fully implemented in hevy.ts
export { normalizeHevyActivity } from "./hevy";

/**
 * Unified normalizer dispatcher.
 * Routes raw activity data to the appropriate provider-specific normalizer.
 */
export function normalizeActivity(
	provider: IntegrationProvider,
	raw: unknown,
): NormalizedActivity {
	switch (provider) {
		case "strava":
			return normalizeStravaActivity(raw);
		case "fitbit":
			return normalizeFitbitActivity(raw);
		case "garmin":
			return normalizeGarminActivity(raw);
		case "hevy":
			return normalizeHevyActivity(raw);
		case "apple_health":
		case "google_health":
			throw new Error(
				`${provider} activities are synced via the mobile app and do not use the web normalizer.`,
			);
		default:
			throw new Error(`Unknown integration provider: ${provider}`);
	}
}
