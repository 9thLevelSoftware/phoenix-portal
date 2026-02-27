import { z } from "zod";
import type { NormalizedActivity } from "./types";

// =============================================================================
// Garmin Activity Schema
// Source: https://developer.garmin.com/gc-developer-program/activity-api/
// =============================================================================

export const garminActivitySchema = z.object({
	activityId: z.number(),
	activityName: z.string().optional().default("Garmin Activity"),
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
		RUNNING: "running",
		TRAIL_RUNNING: "running",
		TREADMILL_RUNNING: "running",
		CYCLING: "cycling",
		MOUNTAIN_BIKING: "cycling",
		INDOOR_CYCLING: "cycling",
		SWIMMING: "swimming",
		OPEN_WATER_SWIMMING: "swimming",
		WALKING: "walking",
		HIKING: "hiking",
		STRENGTH_TRAINING: "strength",
		YOGA: "flexibility",
		PILATES: "flexibility",
		ROWING: "rowing",
		INDOOR_ROWING: "rowing",
		ELLIPTICAL: "cardio",
		STAIR_CLIMBING: "cardio",
		FITNESS_EQUIPMENT: "cardio",
	};
	return mapping[garminType] ?? "other";
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
		provider: "garmin",
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
 * Initiate Garmin Connect OAuth 1.0a connection via the initiate-oauth Edge Function.
 * The server generates a cryptographic CSRF state token and returns
 * the Garmin OAuth initiation URL.
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 *
 * NOTE: Garmin developer program approval may be pending.
 * This function is ready but untested until credentials are available.
 */
export async function initiateGarminConnect(
	accessToken: string,
): Promise<void> {
	const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
	if (!supabaseUrl) {
		console.error("VITE_SUPABASE_URL is not configured");
		return;
	}

	const response = await fetch(`${supabaseUrl}/functions/v1/initiate-oauth`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ provider: "garmin" }),
	});

	if (!response.ok) {
		console.error("Failed to initiate Garmin OAuth:", await response.text());
		return;
	}

	const { url } = await response.json();
	window.location.href = url;
}
