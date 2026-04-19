import type { IntegrationProvider, NormalizedActivity } from "./types";
import { normalizeFitbitActivity } from "./fitbit";
import { normalizeGarminActivity } from "./garmin";
import { normalizeHevyActivity } from "./hevy";
import { normalizeStravaActivity } from "./strava";

export {
	normalizeFitbitActivity,
	normalizeGarminActivity,
	normalizeHevyActivity,
	normalizeStravaActivity,
};

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
