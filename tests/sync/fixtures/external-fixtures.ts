/**
 * External Activity Fixtures for Beta Sync Validation
 *
 * These factories create valid DTO shapes for external integration activities
 * from Strava, Fitbit, and Garmin.
 *
 * Key features:
 * - Provider-specific activity types
 * - Heart rate and calorie data
 * - Distance and elevation metrics
 * - Raw data passthrough for provider-specific fields
 */

import type { Database, Json } from "@/lib/database.types";

// Type alias
type ExternalActivityRow =
	Database["public"]["Tables"]["external_activities"]["Row"];
type ExternalActivityInsert =
	Database["public"]["Tables"]["external_activities"]["Insert"];

// Default test user and timestamp
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_TIMESTAMP = "2026-04-12T10:00:00.000Z";

// Supported providers
export const PROVIDERS = ["strava", "fitbit", "garmin"] as const;
export type Provider = (typeof PROVIDERS)[number];

// Activity types by provider
export const ACTIVITY_TYPES = {
	strava: [
		"Ride",
		"Run",
		"Swim",
		"Walk",
		"Hike",
		"WeightTraining",
		"Workout",
		"Crossfit",
		"VirtualRide",
		"VirtualRun",
	],
	fitbit: [
		"Run",
		"Walk",
		"Bike",
		"Swim",
		"Weights",
		"Workout",
		"Elliptical",
		"Treadmill",
		"Aerobic Workout",
	],
	garmin: [
		"running",
		"cycling",
		"swimming",
		"walking",
		"hiking",
		"strength_training",
		"cardio",
		"indoor_cycling",
		"indoor_running",
	],
} as const;

export type StravaActivityType = (typeof ACTIVITY_TYPES.strava)[number];
export type FitbitActivityType = (typeof ACTIVITY_TYPES.fitbit)[number];
export type GarminActivityType = (typeof ACTIVITY_TYPES.garmin)[number];

let uuidCounter = 5000;
function generateTestUuid(seed: number): string {
	const hex = seed.toString(16).padStart(8, "0");
	return `${hex.slice(0, 8)}-0000-4000-8000-${hex.padStart(12, "0")}`;
}

function nextTestUuid(): string {
	return generateTestUuid(uuidCounter++);
}

/**
 * Generate a realistic external ID for a provider.
 */
function generateExternalId(provider: Provider): string {
	const timestamp = Date.now();
	switch (provider) {
		case "strava":
			return `${timestamp}${Math.floor(Math.random() * 1000000)}`;
		case "fitbit":
			return `${Math.floor(Math.random() * 100000000000)}`;
		case "garmin":
			return `${timestamp}`;
	}
}

/**
 * Create an external activity fixture.
 *
 * @param overrides - Partial activity data to override defaults
 * @returns A valid ExternalActivityRow shape
 */
export function createExternalActivityFixture(
	overrides: Partial<ExternalActivityRow> = {},
): ExternalActivityRow {
	const id = overrides.id ?? nextTestUuid();
	const provider = (overrides.provider ?? "strava") as Provider;

	return {
		id,
		user_id: overrides.user_id ?? DEFAULT_USER_ID,
		provider,
		external_id: overrides.external_id ?? generateExternalId(provider),
		name: "Morning Workout",
		activity_type: "WeightTraining",
		started_at: DEFAULT_TIMESTAMP,
		duration_seconds: 3600, // 1 hour
		calories: 450,
		distance_meters: null,
		elevation_gain_meters: null,
		avg_heart_rate: 135,
		max_heart_rate: 165,
		synced_at: DEFAULT_TIMESTAMP,
		raw_data: null,
		...overrides,
	} satisfies ExternalActivityRow;
}

/**
 * Create a Strava-specific activity fixture.
 */
export function createStravaActivityFixture(
	activityType: StravaActivityType = "WeightTraining",
	overrides: Partial<ExternalActivityRow> = {},
): ExternalActivityRow {
	const isCardio = [
		"Ride",
		"Run",
		"Swim",
		"Walk",
		"Hike",
		"VirtualRide",
		"VirtualRun",
	].includes(activityType);

	return createExternalActivityFixture({
		provider: "strava",
		activity_type: activityType,
		name: `${activityType} Session`,
		distance_meters: isCardio ? 10000 : null, // 10km for cardio
		elevation_gain_meters: isCardio ? 150 : null,
		raw_data: {
			id: generateExternalId("strava"),
			type: activityType,
			athlete: { id: 12345678 },
			moving_time: 3400,
			elapsed_time: 3600,
			total_elevation_gain: 150,
			average_speed: isCardio ? 2.8 : null, // m/s
			max_speed: isCardio ? 4.2 : null,
			has_heartrate: true,
			suffer_score: 85,
			workout_type: activityType === "WeightTraining" ? 10 : null,
		} as Json,
		...overrides,
	});
}

/**
 * Create a Fitbit-specific activity fixture.
 */
export function createFitbitActivityFixture(
	activityType: FitbitActivityType = "Weights",
	overrides: Partial<ExternalActivityRow> = {},
): ExternalActivityRow {
	const isCardio = [
		"Run",
		"Walk",
		"Bike",
		"Swim",
		"Elliptical",
		"Treadmill",
	].includes(activityType);

	return createExternalActivityFixture({
		provider: "fitbit",
		activity_type: activityType,
		name: `${activityType} Activity`,
		distance_meters: isCardio ? 8000 : null,
		elevation_gain_meters: null, // Fitbit doesn't track elevation consistently
		raw_data: {
			logId: Number(generateExternalId("fitbit")),
			activityTypeId: 15000 + Math.floor(Math.random() * 1000),
			activityName: activityType,
			activeDuration: 3400000, // milliseconds
			steps: isCardio ? 9500 : null,
			calories: 450,
			caloriesLink:
				"https://api.fitbit.com/1/user/-/activities/calories/date/2026-04-12.json",
			heartRateZones: [
				{ name: "Fat Burn", minutes: 15, caloriesOut: 120 },
				{ name: "Cardio", minutes: 25, caloriesOut: 200 },
				{ name: "Peak", minutes: 10, caloriesOut: 130 },
			],
		} as Json,
		...overrides,
	});
}

/**
 * Create a Garmin-specific activity fixture.
 */
export function createGarminActivityFixture(
	activityType: GarminActivityType = "strength_training",
	overrides: Partial<ExternalActivityRow> = {},
): ExternalActivityRow {
	const isCardio = [
		"running",
		"cycling",
		"swimming",
		"walking",
		"hiking",
		"indoor_cycling",
		"indoor_running",
	].includes(activityType);

	return createExternalActivityFixture({
		provider: "garmin",
		activity_type: activityType,
		name: `Garmin ${activityType.replace("_", " ")}`,
		distance_meters: isCardio ? 12000 : null,
		elevation_gain_meters: isCardio ? 200 : null,
		raw_data: {
			activityId: Number(generateExternalId("garmin")),
			activityType: {
				typeKey: activityType,
				parentTypeId: 17,
				isHidden: false,
			},
			timeZoneId: 90,
			duration: 3600,
			elapsedDuration: 3650,
			movingDuration: 3400,
			elevationGain: isCardio ? 200 : 0,
			elevationLoss: isCardio ? 195 : 0,
			averageHR: 135,
			maxHR: 165,
			averageSpeed: isCardio ? 3.3 : null,
			maxSpeed: isCardio ? 4.8 : null,
			aerobicTrainingEffect: 3.2,
			anaerobicTrainingEffect: 2.1,
			trainingEffectLabel: "IMPROVING",
			activityTrainingLoad: 125,
			moderateIntensityMinutes: 20,
			vigorousIntensityMinutes: 35,
		} as Json,
		...overrides,
	});
}

/**
 * Create external activities for all providers.
 */
export function createExternalActivityFixturesForAllProviders(
	userId: string = DEFAULT_USER_ID,
): ExternalActivityRow[] {
	return [
		createStravaActivityFixture("WeightTraining", { user_id: userId }),
		createFitbitActivityFixture("Weights", { user_id: userId }),
		createGarminActivityFixture("strength_training", { user_id: userId }),
	];
}

/**
 * Create a variety of activities for a single provider.
 */
export function createProviderActivitySeries(
	provider: Provider,
	userId: string = DEFAULT_USER_ID,
	count: number = 5,
): ExternalActivityRow[] {
	const activities: ExternalActivityRow[] = [];
	const types = ACTIVITY_TYPES[provider];

	for (let i = 0; i < count; i++) {
		const activityType = types[i % types.length];
		const dayOffset = i * 2; // Every 2 days
		const startDate = new Date(DEFAULT_TIMESTAMP);
		startDate.setDate(startDate.getDate() - dayOffset);

		let activity: ExternalActivityRow;

		switch (provider) {
			case "strava":
				activity = createStravaActivityFixture(
					activityType as StravaActivityType,
					{
						user_id: userId,
						started_at: startDate.toISOString(),
						name: `${activityType} Day ${i + 1}`,
					},
				);
				break;
			case "fitbit":
				activity = createFitbitActivityFixture(
					activityType as FitbitActivityType,
					{
						user_id: userId,
						started_at: startDate.toISOString(),
						name: `${activityType} Day ${i + 1}`,
					},
				);
				break;
			case "garmin":
				activity = createGarminActivityFixture(
					activityType as GarminActivityType,
					{
						user_id: userId,
						started_at: startDate.toISOString(),
						name: `${activityType.replace("_", " ")} Day ${i + 1}`,
					},
				);
				break;
		}

		activities.push(activity);
	}

	return activities;
}

/**
 * Create a weight training activity that could correlate with Phoenix workouts.
 */
export function createCorrelatedWeightActivity(
	provider: Provider,
	phoenixSessionTimestamp: string,
	userId: string = DEFAULT_USER_ID,
): ExternalActivityRow {
	// Timestamp within 30 minutes of Phoenix session
	const externalTime = new Date(phoenixSessionTimestamp);
	externalTime.setMinutes(
		externalTime.getMinutes() + Math.floor(Math.random() * 30) - 15,
	);

	switch (provider) {
		case "strava":
			return createStravaActivityFixture("WeightTraining", {
				user_id: userId,
				started_at: externalTime.toISOString(),
				name: "Phoenix Session",
				duration_seconds: 3600,
				calories: 450,
			});
		case "fitbit":
			return createFitbitActivityFixture("Weights", {
				user_id: userId,
				started_at: externalTime.toISOString(),
				name: "Weight Training",
				duration_seconds: 3600,
				calories: 450,
			});
		case "garmin":
			return createGarminActivityFixture("strength_training", {
				user_id: userId,
				started_at: externalTime.toISOString(),
				name: "Strength Session",
				duration_seconds: 3600,
				calories: 450,
			});
	}
}

/**
 * Create activities with heart rate data for analysis.
 */
export function createHeartRateActivityFixture(
	provider: Provider,
	avgHr: number,
	maxHr: number,
	overrides: Partial<ExternalActivityRow> = {},
): ExternalActivityRow {
	return createExternalActivityFixture({
		provider,
		activity_type:
			provider === "strava" ? "Run" : provider === "fitbit" ? "Run" : "running",
		avg_heart_rate: avgHr,
		max_heart_rate: maxHr,
		...overrides,
	});
}

/**
 * Create insert-ready version of fixture.
 */
export function toExternalActivityInsert(
	row: ExternalActivityRow,
): ExternalActivityInsert {
	const { id, synced_at, ...rest } = row;
	return rest;
}
