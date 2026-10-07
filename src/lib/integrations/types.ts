export type IntegrationProvider =
	| "strava"
	| "fitbit"
	| "garmin"
	| "hevy"
	| "liftosaur"
	| "strong"
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
	}
> = {
	strava: {
		name: "Strava",
		icon: "Activity",
		description: "Running, cycling, and outdoor activities",
	},
	fitbit: {
		name: "Fitbit",
		icon: "Watch",
		description: "Activity and recovery data",
	},
	garmin: {
		name: "Garmin",
		icon: "Watch",
		description: "GPS activities and health metrics",
	},
	hevy: {
		name: "Hevy",
		icon: "Dumbbell",
		description: "Strength training workouts",
	},
	liftosaur: {
		name: "Liftosaur",
		icon: "Dumbbell",
		description: "Scriptable workout tracking",
	},
	strong: {
		name: "Strong",
		icon: "Dumbbell",
		description: "Strength training via CSV import",
	},
	apple_health: {
		name: "Apple Health",
		icon: "Apple",
		description: "Synced via Phoenix iOS app",
	},
	google_health: {
		name: "Google Health Connect",
		icon: "Smartphone",
		description: "Synced via Phoenix Android app",
	},
};
