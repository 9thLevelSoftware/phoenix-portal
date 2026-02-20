export type IntegrationProvider =
	| "strava"
	| "fitbit"
	| "garmin"
	| "hevy"
	| "apple_health"
	| "google_health";

export type IntegrationStatus =
	| "connected"
	| "disconnected"
	| "error"
	| "token_expired";

export interface UserIntegration {
	id: string;
	user_id: string;
	provider: IntegrationProvider;
	provider_user_id: string | null;
	connected_at: string;
	last_sync_at: string | null;
	status: IntegrationStatus;
	error_message: string | null;
}

export interface NormalizedActivity {
	external_id: string;
	provider: IntegrationProvider;
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

export interface ExternalActivity extends NormalizedActivity {
	id: string;
	user_id: string;
	raw_data: unknown;
	synced_at: string;
}

// Provider metadata for UI display
export const PROVIDER_METADATA: Record<
	IntegrationProvider,
	{
		name: string;
		icon: string;
		description: string;
		oauthRequired: boolean;
		mobileOnly: boolean;
	}
> = {
	strava: {
		name: "Strava",
		icon: "Activity",
		description: "Running, cycling, and outdoor activities",
		oauthRequired: true,
		mobileOnly: false,
	},
	fitbit: {
		name: "Fitbit",
		icon: "Watch",
		description: "Activity and recovery data",
		oauthRequired: true,
		mobileOnly: false,
	},
	garmin: {
		name: "Garmin",
		icon: "Watch",
		description: "GPS activities and health metrics",
		oauthRequired: true,
		mobileOnly: false,
	},
	hevy: {
		name: "Hevy",
		icon: "Dumbbell",
		description: "Strength training workouts",
		oauthRequired: false,
		mobileOnly: false,
	},
	apple_health: {
		name: "Apple Health",
		icon: "Apple",
		description: "Synced via Phoenix iOS app",
		oauthRequired: false,
		mobileOnly: true,
	},
	google_health: {
		name: "Google Health Connect",
		icon: "Smartphone",
		description: "Synced via Phoenix Android app",
		oauthRequired: false,
		mobileOnly: true,
	},
};
