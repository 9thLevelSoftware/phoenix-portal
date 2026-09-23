import { normalizeFitbitActivity } from "./fitbit";
import { normalizeGarminActivity } from "./garmin";
import { normalizeHevyActivity } from "./hevy";
import { normalizeStravaActivity } from "./strava";
import type { IntegrationProvider, NormalizedActivity } from "./types";

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
		case "strong":
		case "liftosaur":
			throw new Error(
				`${provider} activities are imported via CSV/API and do not use the single-activity web normalizer. Use the provider-specific parser instead.`,
			);
		case "apple_health":
		case "google_health":
			throw new Error(
				`${provider} activities are synced via the mobile app and do not use the web normalizer.`,
			);
		default: {
			// Exhaustive check: adding a new IntegrationProvider without a case
			// here will fail to compile until dispatch support is added.
			const _exhaustive: never = provider;
			throw new Error(`Unknown integration provider: ${_exhaustive}`);
		}
	}
}
