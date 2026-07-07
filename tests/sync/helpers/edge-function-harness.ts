/**
 * Edge Function Test Harness
 *
 * Provides utilities for testing mobile-sync-push and mobile-sync-pull Edge Functions.
 * Includes typed request/response helpers, test user management, and error handling.
 */

import {
	isMockMode,
	mockPullEndpoint,
	mockPushEndpoint,
} from "./mock-edge-functions";
import {
	getAnonClient,
	getEdgeFunctionUrl,
	getServiceClient,
	getSupabaseConfig,
} from "./supabase-test-client";

// ============================================================================
// Types
// ============================================================================

/**
 * Test user with auth credentials
 */
export interface TestUser {
	id: string;
	email: string;
	accessToken: string;
}

/**
 * Push endpoint request payload (matches mobile-sync-push interface)
 */
export interface PushPayload {
	deviceId: string;
	platform: string;
	lastSync: number;
	sessions?: SessionDto[];
	telemetry?: RepTelemetryDto[];
	routines?: RoutineDto[];
	cycles?: CycleDto[];
	rpgAttributes?: RpgAttributesDto | null;
	badges?: BadgeDto[];
	gamificationStats?: GamificationStatsDto | null;
	phaseStatistics?: PhaseStatisticsDto[];
	exerciseSignatures?: ExerciseSignatureDto[];
	assessments?: AssessmentResultDto[];
	externalActivities?: ExternalActivityDto[] | null;
	personalRecords?: PersonalRecordDto[];
	customExercises?: CustomExerciseDto[];
	profileId?: string | null;
	profileName?: string | null;
	allProfiles?: LocalProfileDto[] | null;
}

/**
 * Pull endpoint request payload (matches mobile-sync-pull interface)
 */
export interface PullRequest {
	deviceId: string;
	lastSync: number;
	profileId?: string;
	cursor?: string;
	pageSize?: number;
	knownEntityIds?: {
		sessionIds?: string[];
		routineIds?: string[];
		cycleIds?: string[];
		badgeIds?: string[];
		personalRecordIds?: string[];
	};
}

/**
 * Pull endpoint response structure
 */
export interface PullResponse {
	syncTime: number;
	nextCursor?: string;
	hasMore: boolean;
	sessions: SessionResponseDto[];
	routines: RoutineResponseDto[];
	cycles: CycleResponseDto[];
	personalRecords: PersonalRecordDto[];
	rpgAttributes: RpgAttributesResponseDto | null;
	badges: BadgeResponseDto[];
	gamificationStats: GamificationStatsResponseDto | null;
	localProfiles: LocalProfileResponseDto[];
	externalActivities: ExternalActivityResponseDto[];
	customExercises?: CustomExerciseResponseDto[];
}

/**
 * Typed result for Edge Function calls
 */
export interface EdgeFunctionResult<T> {
	success: boolean;
	status: number;
	data?: T;
	error?: {
		message: string;
		code?: string;
	};
}

// ============================================================================
// DTO Types (simplified for test harness)
// ============================================================================

export interface SessionDto {
	id: string;
	userId: string;
	name: string | null;
	startedAt: string;
	durationSeconds: number;
	totalVolume: number;
	setCount: number;
	exerciseCount: number;
	prCount: number;
	routineName: string | null;
	workoutMode: string | null;
	routineSessionId: string | null;
	notes?: string | null;
	exercises: ExerciseDto[];
	avgVelocityMps?: number | null;
	avgAsymmetryPct?: number | null;
	velocityLossPct?: number | null;
	dominantSide?: string | null;
	strengthProfile?: string | null;
	formScore?: number | null;
	deloadWarnings?: number | null;
	romViolations?: number | null;
	spotterActivations?: number | null;
	peakForceN?: number | null;
	estimatedCalories?: number | null;
	heaviestLiftKg?: number | null;
	eccentricLoad?: number | null;
	echoLevel?: number | null;
	warmupReps?: number | null;
	workingReps?: number | null;
}

export interface ExerciseDto {
	id: string;
	sessionId: string;
	exerciseId?: string | null;
	name: string;
	muscleGroup: string;
	orderIndex: number;
	sets: SetDto[];
}

export interface SetDto {
	id: string;
	exerciseId: string;
	setNumber: number;
	targetReps: number | null;
	actualReps: number;
	weightKg: number;
	rpe: number | null;
	isPr: boolean;
	notes: string | null;
	workoutMode: string | null;
	repSummaries?: RepSummaryDto[];
}

export interface RepSummaryDto {
	id: string;
	setId: string;
	repNumber: number;
	meanVelocityMps: number | null;
	peakVelocityMps: number | null;
	meanForceN: number | null;
	peakForceN: number | null;
	powerWatts: number | null;
	romMm: number | null;
	tutMs: number | null;
	leftForceAvg: number | null;
	rightForceAvg: number | null;
	asymmetryPct: number | null;
	vbtZone: string | null;
}

export interface RepTelemetryDto {
	id: string;
	setId: string;
	timestampMs: number;
	forceN: number | null;
	velocityMps: number | null;
	positionMm: number | null;
	cable: string | null;
}

export interface RoutineDto {
	id: string;
	userId: string;
	name: string;
	description: string | null;
	exerciseCount: number;
	estimatedDuration: number | null;
	timesCompleted: number;
	isFavorite: boolean;
	exercises: RoutineExerciseDto[];
}

export interface RoutineExerciseDto {
	id: string;
	routineId: string;
	exerciseId?: string | null;
	displayName?: string | null;
	exerciseEquipment?: string | null;
	name: string;
	muscleGroup: string;
	sets: number;
	reps: number;
	weight: number;
	restSeconds: number;
	mode: string | null;
	orderIndex: number;
	supersetId?: string | null;
	supersetColor?: string | null;
	supersetOrder?: number | null;
	perSetWeights?: string | null;
	perSetRest?: string | null;
	perSetReps?: string | null;
	isAmrap?: boolean;
	prPercentage?: number | null;
	repCountTiming?: string | null;
	stopAtPosition?: string | null;
	stallDetection?: boolean | null;
	eccentricLoad?: number | null;
	echoLevel?: number | null;
	perSetEchoLevels?: number[] | null;
	warmupSets?: number | null;
}

export interface CustomExerciseDto {
	clientId: string;
	name: string;
	displayName?: string | null;
	muscleGroup: string;
	equipment?: string | null;
	defaultCableConfig: string;
}

export interface CycleDto {
	id: string;
	userId: string;
	name: string;
	description: string | null;
	durationWeeks: number;
	workoutDays: number;
	restDays: number;
	currentWeek: number;
	status: string;
	startedAt: string | null;
	lastUsedAt: string | null;
	progressionSettings?: string | null;
	deloadSettings?: string | null;
	templateId?: string | null;
	days: CycleDayDto[];
}

export interface CycleDayDto {
	id: string;
	cycleId: string;
	dayNumber: number;
	dayType: string;
	routineId: string | null;
	weightAdjustment: number | null;
	repModifier: number | null;
	restOverride: number | null;
	restType: string | null;
	notes: string | null;
}

export interface RpgAttributesDto {
	id: string;
	userId: string;
	strength: number;
	power: number;
	stamina: number;
	consistency: number;
	mastery: number;
	characterClass: string;
	level: number;
	experiencePoints: number;
}

export interface BadgeDto {
	id: string;
	badgeId: string;
	badgeName: string;
	badgeDescription: string | null;
	badgeTier: string;
	earnedAt: string;
}

export interface GamificationStatsDto {
	id: string;
	userId: string;
	totalWorkouts: number;
	totalReps: number;
	totalVolumeKg: number;
	longestStreak: number;
	currentStreak: number;
	totalTimeSeconds: number;
}

export interface PhaseStatisticsDto {
	id: string;
	sessionId: string;
	concentricKgAvg: number;
	concentricKgMax: number;
	concentricVelAvg: number;
	concentricVelMax: number;
	concentricWattAvg: number;
	concentricWattMax: number;
	eccentricKgAvg: number;
	eccentricKgMax: number;
	eccentricVelAvg: number;
	eccentricVelMax: number;
	eccentricWattAvg: number;
	eccentricWattMax: number;
}

export interface ExerciseSignatureDto {
	id: string;
	exerciseId: string;
	romMm: number;
	durationMs: number;
	symmetryRatio: number;
	velocityProfile: string;
	cableConfig: string;
	sampleCount: number;
	confidence: number;
	updatedAt: string | null;
}

export interface AssessmentResultDto {
	id: string;
	exerciseId: string;
	estimatedOneRepMaxKg: number;
	loadVelocityData: string;
	assessmentSessionId: string | null;
	userOverrideKg: number | null;
	createdAt: string;
}

export interface ExternalActivityDto {
	id?: string;
	externalId: string;
	provider: string;
	name: string;
	activityType: string;
	startedAt: string;
	durationSeconds: number;
	distanceMeters?: number | null;
	calories?: number | null;
	avgHeartRate?: number | null;
	maxHeartRate?: number | null;
	elevationGainMeters?: number | null;
	rawData?: string | null;
	syncedAt?: string;
}

export interface LocalProfileDto {
	id: string;
	name: string;
	colorIndex: number;
}

// Response DTOs (from pull endpoint)
export interface SessionResponseDto extends Omit<SessionDto, "exercises"> {
	exercises: ExerciseResponseDto[];
}

export interface ExerciseResponseDto extends Omit<ExerciseDto, "sets"> {
	sets: SetResponseDto[];
}

export interface SetResponseDto extends Omit<SetDto, "repSummaries"> {
	repSummaries: RepSummaryDto[];
}

export interface RoutineResponseDto extends RoutineDto {}
export interface CycleResponseDto extends CycleDto {}
export interface PersonalRecordDto {
	id: string;
	userId: string;
	exerciseName: string;
	exerciseId?: string | null;
	muscleGroup: string;
	recordType: string;
	value: number;
	volume?: number | null;
	weightKg: number | null;
	reps: number | null;
	workoutPhase: string | null;
	sessionId: string | null;
	achievedAt: string;
	updatedAt: string;
	localProfileId?: string | null;
	workoutMode?: string | null;
}
export interface RpgAttributesResponseDto extends RpgAttributesDto {
	updatedAt: string;
}
export interface BadgeResponseDto extends BadgeDto {
	userId: string;
}
export interface GamificationStatsResponseDto extends GamificationStatsDto {
	updatedAt: string;
}
export interface LocalProfileResponseDto {
	id: string;
	name: string;
	color_index: number;
	device_id: string;
	created_at: string;
	updated_at: string;
}
export interface ExternalActivityResponseDto {
	id: string;
	externalId: string;
	provider: string;
	name: string;
	activityType: string;
	startedAt: string;
	durationSeconds: number;
	distanceMeters: number | null;
	calories: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	elevationGainMeters: number | null;
	rawData: string | null;
}

export interface CustomExerciseResponseDto extends CustomExerciseDto {}

// ============================================================================
// Test User Management
// ============================================================================

/**
 * Create a test user with Supabase Auth
 * Returns user ID and access token for authenticated requests
 */
export async function createTestUser(
	email?: string,
	password?: string,
): Promise<TestUser> {
	if (isMockMode()) {
		// Return mock user when mocks are enabled
		return {
			id: `mock-user-${Date.now()}`,
			email: email || `test-${Date.now()}@test.local`,
			accessToken: "mock-access-token",
		};
	}

	const client = getAnonClient();
	const testEmail =
		email ||
		`sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
	const testPassword =
		password || `TestPass123!${Math.random().toString(36).slice(2)}`;

	const { data, error } = await client.auth.signUp({
		email: testEmail,
		password: testPassword,
	});

	if (error) {
		throw new Error(`Failed to create test user: ${error.message}`);
	}

	if (!data.user || !data.session) {
		throw new Error(
			"User created but no session returned - email confirmation may be required",
		);
	}

	return {
		id: data.user.id,
		email: testEmail,
		accessToken: data.session.access_token,
	};
}

/**
 * Clean up test user and all associated data
 * Uses service role client to bypass RLS
 */
export async function cleanupTestUser(userId: string): Promise<void> {
	if (isMockMode()) {
		// No cleanup needed for mock users
		return;
	}

	const serviceClient = getServiceClient();

	try {
		// Delete in order respecting foreign key constraints
		// 1. Delete rep_summaries (via sets -> exercises -> sessions)
		// 2. Delete sets (via exercises -> sessions)
		// 3. Delete exercises (via sessions)
		// 4. Delete workout sessions
		// 5. Delete routines and their exercises
		// 6. Delete cycles and their days
		// 7. Delete other user data
		// 8. Delete auth user

		// Get session IDs first
		const { data: sessions } = await serviceClient
			.from("workout_sessions")
			.select("id")
			.eq("user_id", userId);

		if (sessions && sessions.length > 0) {
			const sessionIds = sessions.map((s) => s.id);

			// Get exercise IDs
			const { data: exercises } = await serviceClient
				.from("exercises")
				.select("id")
				.in("session_id", sessionIds);

			if (exercises && exercises.length > 0) {
				const exerciseIds = exercises.map((e) => e.id);

				// Get set IDs
				const { data: sets } = await serviceClient
					.from("sets")
					.select("id")
					.in("exercise_id", exerciseIds);

				if (sets && sets.length > 0) {
					const setIds = sets.map((s) => s.id);

					// Delete rep summaries
					await serviceClient
						.from("rep_summaries")
						.delete()
						.in("set_id", setIds);

					// Delete telemetry
					await serviceClient
						.from("rep_telemetry")
						.delete()
						.in("set_id", setIds);
				}

				// Delete sets
				await serviceClient
					.from("sets")
					.delete()
					.in("exercise_id", exerciseIds);
			}

			// Delete exercises
			await serviceClient
				.from("exercises")
				.delete()
				.in("session_id", sessionIds);
		}

		// Delete workout sessions
		await serviceClient.from("workout_sessions").delete().eq("user_id", userId);

		// Delete routine exercises then routines
		const { data: routines } = await serviceClient
			.from("routines")
			.select("id")
			.eq("user_id", userId);

		if (routines && routines.length > 0) {
			const routineIds = routines.map((r) => r.id);
			await serviceClient
				.from("routine_exercises")
				.delete()
				.in("routine_id", routineIds);
		}
		await serviceClient.from("routines").delete().eq("user_id", userId);

		// Delete cycle days then cycles
		const { data: cycles } = await serviceClient
			.from("training_cycles")
			.select("id")
			.eq("user_id", userId);

		if (cycles && cycles.length > 0) {
			const cycleIds = cycles.map((c) => c.id);
			await serviceClient.from("cycle_days").delete().in("cycle_id", cycleIds);
		}
		await serviceClient.from("training_cycles").delete().eq("user_id", userId);

		// Delete other user data
		await serviceClient.from("personal_records").delete().eq("user_id", userId);
		await serviceClient.from("rpg_attributes").delete().eq("user_id", userId);
		await serviceClient.from("earned_badges").delete().eq("user_id", userId);
		await serviceClient
			.from("gamification_stats")
			.delete()
			.eq("user_id", userId);
		await serviceClient.from("phase_statistics").delete().eq("user_id", userId);
		await serviceClient
			.from("exercise_signatures")
			.delete()
			.eq("user_id", userId);
		await serviceClient
			.from("assessment_results")
			.delete()
			.eq("user_id", userId);
		await serviceClient
			.from("external_activities")
			.delete()
			.eq("user_id", userId);
		await serviceClient.from("local_profiles").delete().eq("user_id", userId);

		// Delete the auth user
		await serviceClient.auth.admin.deleteUser(userId);
	} catch (err) {
		console.warn(`Error during test user cleanup (${userId}):`, err);
		// Don't throw - cleanup is best effort
	}
}

// ============================================================================
// Edge Function Callers
// ============================================================================

/**
 * Call the mobile-sync-push Edge Function
 *
 * @param payload - Push payload with workout data
 * @param authToken - User's JWT access token
 * @returns Typed result with success status and response data
 */
export async function callPushEndpoint(
	payload: PushPayload,
	authToken: string,
): Promise<EdgeFunctionResult<{ success: boolean; syncTime?: number }>> {
	if (isMockMode()) {
		return mockPushEndpoint(payload, authToken);
	}

	const url = getEdgeFunctionUrl("mobile-sync-push");

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authToken}`,
			},
			body: JSON.stringify(payload),
		});

		const data = await response.json();

		if (!response.ok) {
			return {
				success: false,
				status: response.status,
				error: {
					message: data.error || `HTTP ${response.status}`,
					code: data.code,
				},
			};
		}

		return {
			success: true,
			status: response.status,
			data,
		};
	} catch (err) {
		return {
			success: false,
			status: 0,
			error: {
				message: err instanceof Error ? err.message : "Network error",
				code: "NETWORK_ERROR",
			},
		};
	}
}

/**
 * Call the mobile-sync-pull Edge Function
 *
 * @param lastSync - Unix timestamp (ms) of last sync, 0 for initial sync
 * @param authToken - User's JWT access token
 * @param options - Additional pull options
 * @returns Typed result with synced data
 */
export async function callPullEndpoint(
	lastSync: number,
	authToken: string,
	options?: {
		deviceId?: string;
		profileId?: string;
		cursor?: string;
		pageSize?: number;
		knownEntityIds?: PullRequest["knownEntityIds"];
	},
): Promise<EdgeFunctionResult<PullResponse>> {
	if (isMockMode()) {
		return mockPullEndpoint(lastSync, authToken, options);
	}

	const url = getEdgeFunctionUrl("mobile-sync-pull");

	const payload: PullRequest = {
		deviceId: options?.deviceId || `test-device-${Date.now()}`,
		lastSync,
		profileId: options?.profileId,
		cursor: options?.cursor,
		pageSize: options?.pageSize,
		knownEntityIds: options?.knownEntityIds,
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authToken}`,
			},
			body: JSON.stringify(payload),
		});

		const data = await response.json();

		if (!response.ok) {
			return {
				success: false,
				status: response.status,
				error: {
					message: data.error || `HTTP ${response.status}`,
					code: data.code,
				},
			};
		}

		return {
			success: true,
			status: response.status,
			data,
		};
	} catch (err) {
		return {
			success: false,
			status: 0,
			error: {
				message: err instanceof Error ? err.message : "Network error",
				code: "NETWORK_ERROR",
			},
		};
	}
}

// ============================================================================
// Test Data Builders
// ============================================================================

/**
 * Generate a unique ID for test data
 */
export function generateTestId(): string {
	return `test-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a minimal valid push payload for testing
 */
export function createMinimalPushPayload(
	userId: string,
	overrides?: Partial<PushPayload>,
): PushPayload {
	return {
		deviceId: `test-device-${Date.now()}`,
		platform: "android",
		lastSync: 0,
		sessions: [],
		telemetry: [],
		routines: [],
		cycles: [],
		rpgAttributes: null,
		badges: [],
		gamificationStats: null,
		phaseStatistics: [],
		exerciseSignatures: [],
		assessments: [],
		...overrides,
	};
}

/**
 * Create a test workout session
 */
export function createTestSession(
	userId: string,
	overrides?: Partial<SessionDto>,
): SessionDto {
	const sessionId = generateTestId();
	return {
		id: sessionId,
		userId,
		name: "Test Workout",
		startedAt: new Date().toISOString(),
		durationSeconds: 3600,
		totalVolume: 5000,
		setCount: 10,
		exerciseCount: 3,
		prCount: 0,
		routineName: null,
		workoutMode: "OLD_SCHOOL",
		routineSessionId: null,
		exercises: [],
		...overrides,
	};
}

/**
 * Create a test exercise
 */
export function createTestExercise(
	sessionId: string,
	orderIndex: number = 0,
	overrides?: Partial<ExerciseDto>,
): ExerciseDto {
	return {
		id: generateTestId(),
		sessionId,
		name: "Bench Press",
		muscleGroup: "chest",
		orderIndex,
		sets: [],
		...overrides,
	};
}

/**
 * Create a test set
 */
export function createTestSet(
	exerciseId: string,
	setNumber: number = 1,
	overrides?: Partial<SetDto>,
): SetDto {
	return {
		id: generateTestId(),
		exerciseId,
		setNumber,
		targetReps: 10,
		actualReps: 10,
		weightKg: 50,
		rpe: 7,
		isPr: false,
		notes: null,
		workoutMode: "OLD_SCHOOL",
		repSummaries: [],
		...overrides,
	};
}

/**
 * Create a test routine
 */
export function createTestRoutine(
	userId: string,
	overrides?: Partial<RoutineDto>,
): RoutineDto {
	return {
		id: generateTestId(),
		userId,
		name: "Test Routine",
		description: "A test routine",
		exerciseCount: 0,
		estimatedDuration: 60,
		timesCompleted: 0,
		isFavorite: false,
		exercises: [],
		...overrides,
	};
}
