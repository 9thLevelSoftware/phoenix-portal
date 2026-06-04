import { z } from "zod";
import { redirectToValidatedOAuthUrl } from "./oauthRedirect";
import type { NormalizedActivity } from "./types";

// =============================================================================
// Fitbit Activity Schema
// Source: https://dev.fitbit.com/build/reference/web-api/activity/get-activity-log-list/
// =============================================================================

export const fitbitActivitySchema = z.object({
	logId: z.number(),
	activityName: z.string(),
	activityTypeId: z.number(),
	startTime: z.string(),
	duration: z.number(), // milliseconds
	distance: z.number().optional(),
	distanceUnit: z.string().optional(),
	calories: z.number().optional(),
	averageHeartRate: z.number().optional(),
	elevationGain: z.number().optional(),
	steps: z.number().optional(),
});

export type FitbitActivity = z.infer<typeof fitbitActivitySchema>;

/**
 * Map Fitbit activityTypeId to a generic activity type string.
 * Fitbit uses numeric IDs for activity types.
 * See: https://dev.fitbit.com/build/reference/web-api/activity/get-all-activity-types/
 */
function mapFitbitActivityType(typeId: number): string {
	const mapping: Record<number, string> = {
		90013: "running", // Run
		90009: "cycling", // Bike
		90024: "swimming", // Swim
		90001: "walking", // Walk
		90019: "hiking", // Hike
		15000: "strength", // Sport > Weights
		15670: "strength", // Workout
		90030: "flexibility", // Yoga
		90004: "cardio", // Elliptical
		1160: "rowing", // Rowing Machine
	};
	return mapping[typeId] ?? "other";
}

/**
 * Normalize a Fitbit API activity response into the unified NormalizedActivity format.
 * Validates with Zod and converts units:
 * - duration: milliseconds -> seconds
 * - distance: km -> meters
 */
export function normalizeFitbitActivity(raw: unknown): NormalizedActivity {
	const activity = fitbitActivitySchema.parse(raw);
	return {
		external_id: String(activity.logId),
		provider: "fitbit",
		name: activity.activityName,
		activity_type: mapFitbitActivityType(activity.activityTypeId),
		started_at: activity.startTime,
		// Fitbit provides duration in milliseconds, convert to seconds
		duration_seconds: Math.round(activity.duration / 1000),
		// Fitbit provides distance in km, convert to meters
		distance_meters:
			activity.distance != null ? Math.round(activity.distance * 1000) : null,
		calories: activity.calories ?? null,
		avg_heart_rate: activity.averageHeartRate ?? null,
		max_heart_rate: null, // Fitbit activity list doesn't include max HR per activity
		elevation_gain_meters: activity.elevationGain ?? null,
	};
}

/**
 * Initiate Fitbit OAuth 2.0 connection via the initiate-oauth Edge Function.
 * The server generates a cryptographic CSRF state token and returns
 * the Fitbit authorization URL.
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 */
export async function initiateFitbitConnect(
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
		body: JSON.stringify({ provider: "fitbit" }),
	});

	if (!response.ok) {
		throw new Error(
			`Failed to initiate Fitbit OAuth: ${await response.text()}`,
		);
	}

	const { url } = await response.json();
	redirectToValidatedOAuthUrl("fitbit", url);
}
