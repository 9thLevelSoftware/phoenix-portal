/**
 * Unified ingress schema for mobile-sync-push.
 *
 * Why this exists
 * ---------------
 * Before this schema, the push handler performed validation via four
 * separate helpers (`syncPlatform`, `syncPayloadShape`, `localProfileId`,
 * plus dozens of inline `?? default` guards). That reactive chain grew as
 * each new production bug surfaced. This file consolidates all of it into
 * one declarative Zod schema so:
 *
 *   1. Shape coercion (missing arrays → []) is centralized.
 *   2. Every NOT-NULL-DEFAULT scalar on the DB side has its default
 *      declared once — the scatter of `?? 0` / `?? 'General'` in row
 *      builders was the root cause of the pr_count null-constraint bug.
 *   3. Malformed fields return a precise 400 with a field path
 *      (`issues[].path`), instead of the handler exploding deep in a
 *      row-builder flatMap and returning a cryptic 500.
 *   4. The TypeScript type of PushPayload is derived from the schema, so
 *      it cannot drift.
 *
 * The schema does NOT enforce DB CHECK-constraint-like enums on string
 * columns (workoutMode, strengthProfile, velocityProfile, etc.) because
 * those columns are free-form text in Postgres and enum drift would break
 * older clients on the wire. DB-level validation is the right place for
 * those, not here.
 */

// Deno edge runtime resolves "npm:" specifiers directly. Vitest maps this
// alias to the node_modules "zod" package via vitest.config.ts.
import { z } from "npm:zod@4.3.6";

// ─── Primitives ──────────────────────────────────────────────────────────

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict UUID (used for entity ids that mobile mints via generateUUID).
 */
const uuid = z
	.string()
	.regex(UUID_REGEX, "expected UUID v1–v5 hex string");

/**
 * Local profile id: either the mobile-seeded "default" sentinel or a UUID.
 * See `_shared/localProfileId.ts` for the authoritative rationale.
 */
export const localProfileIdSchema = z
	.string()
	.refine((v) => v === "default" || UUID_REGEX.test(v), {
		message: 'expected "default" or a UUID',
	});

/**
 * Platform normalizer. Accepts any input; always returns a canonical
 * "android" | "ios" | "unknown". Mirrors the prior `normalizeSyncPlatform`
 * contract but expressed declaratively.
 */
export const platformSchema = z
	.unknown()
	.transform<"android" | "ios" | "unknown">((value) => {
		if (typeof value !== "string") return "unknown";
		const normalized = value.trim().toLowerCase();
		if (!normalized) return "unknown";
		if (normalized.includes("android")) return "android";
		if (normalized.includes("ios")) return "ios";
		return "unknown";
	});

// ─── Wire timestamps ─────────────────────────────────────────────────────
// Mobile ships timestamps as ISO-8601 strings. Validate them at ingress so a
// malformed value returns a precise 400 with a field path instead of failing
// later as a Postgres timestamp error or corrupting cursor/sync comparisons.
// `Date.parse` accepts the ISO-8601 forms the Kotlin client emits (with and
// without milliseconds, with `Z` or numeric offset). We intentionally keep it
// permissive about format but strict about parseability.
const isoDatetime = z
	.string()
	.refine((v) => Number.isFinite(Date.parse(v)), {
		message: "expected an ISO-8601 datetime string",
	});

// Nullable/optional ISO datetime: undefined stays undefined, explicit null
// stays null, present strings must parse.
function nullableDatetime() {
	return isoDatetime.nullable().optional();
}

// ISO datetime with a server-side default when the field is absent/null.
function datetimeWithDefault(makeDefault: () => string) {
	return isoDatetime
		.nullish()
		.transform((v) => v ?? makeDefault());
}

// ─── Bounded numbers ─────────────────────────────────────────────────────
// Many wire numerics are physically non-negative (weights, reps, durations,
// counts, volumes). Reject negatives/non-finite at ingress so a malformed
// client cannot persist negative progress snapshots that then propagate back
// to mobile on pull.
const nonNegNumber = z.number().finite().nonnegative();
const nonNegInt = z.number().int().nonnegative();

// Non-negative scalar with a NOT-NULL-DEFAULT fallback (nullish → default).
function nonNegNumberDefault(fallback: number) {
	return nonNegNumber.nullish().transform((v) => v ?? fallback);
}
function nonNegIntDefault(fallback: number) {
	return nonNegInt.nullish().transform((v) => v ?? fallback);
}

// Helper: coerce missing (undefined/null) to [] for backward compat, but
// reject a non-array non-null value (object/string/number) with a 400 and a
// field path. Silently dropping a mis-typed sync section is dangerous because
// the client can advance its local sync timestamp after the server discarded
// the data.
function arrayOf<T extends z.ZodTypeAny>(item: T) {
	return z
		.unknown()
		.superRefine((v, ctx) => {
			if (v === undefined || v === null) return;
			if (!Array.isArray(v)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "expected an array",
				});
			}
		})
		.transform((v) => (Array.isArray(v) ? v : []))
		.pipe(z.array(item));
}

// Helper: optional-nullable scalar that stays undefined on absent, null on
// explicit null. Use for DB columns that are NULLABLE.
function nullableField<T extends z.ZodTypeAny>(item: T) {
	return item.nullable().optional();
}

// ─── Nested DTOs ─────────────────────────────────────────────────────────

const repSummarySchema = z.object({
	id: uuid,
	setId: uuid,
	repNumber: nonNegInt,
	meanVelocityMps: nullableField(z.number()),
	peakVelocityMps: nullableField(z.number()),
	meanForceN: nullableField(z.number()),
	peakForceN: nullableField(z.number()),
	powerWatts: nullableField(z.number()),
	romMm: nullableField(nonNegNumber),
	tutMs: nullableField(nonNegNumber),
	leftForceAvg: nullableField(z.number()),
	rightForceAvg: nullableField(z.number()),
	asymmetryPct: nullableField(z.number()),
	vbtZone: nullableField(z.string()),
});

const setSchema = z.object({
	id: uuid,
	exerciseId: uuid,
	setNumber: z.number().int(),
	targetReps: nullableField(nonNegInt),
	// DB defaults below — nullish coerces to the default so an explicit NULL
	// in the payload doesn't bypass DEFAULT on INSERT.
	actualReps: nonNegIntDefault(0),
	weightKg: nonNegNumberDefault(0),
	rpe: nullableField(z.number().int()),
	isPr: z.boolean().nullish().transform((v) => v ?? false),
	// Send-only PR derivation hints (see PortalSetDto Kotlin doc).
	prType: nullableField(z.string()),
	prPhase: nullableField(z.string()),
	prVolume: nullableField(nonNegNumber),
	notes: nullableField(z.string()),
	workoutMode: nullableField(z.string()),
	repSummaries: arrayOf(repSummarySchema).default([]),
});

const exerciseSchema = z.object({
	id: uuid,
	sessionId: uuid,
	exerciseId: nullableField(z.string()),
	name: z.string(),
	muscleGroup: z.string().nullish().transform((v) => v ?? "General"),
	orderIndex: nonNegIntDefault(0),
	// Mobile-provided canonical estimated 1RM (per-cable kg). Optional for
	// backward compat; absent → server recomputes (see exerciseProgressRows).
	estimatedOneRepMaxKg: nullableField(nonNegNumber),
	// Velocity-based (VBT) estimated 1RM (per-cable kg). Brand-new, optional,
	// stored verbatim alongside estimatedOneRepMaxKg (never recomputed). Absent
	// on legacy payloads → null column. Issue #517 Phase 6.
	velocityEstimatedOneRepMaxKg: nullableField(nonNegNumber),
	sets: arrayOf(setSchema).default([]),
});

const sessionSchema = z.object({
	id: uuid,
	userId: z.string(),
	name: nullableField(z.string()),
	startedAt: datetimeWithDefault(() => new Date().toISOString()),
	updatedAt: nullableDatetime(),
	// DB NOT-NULL-DEFAULT numeric columns: coerce nullish → 0.
	durationSeconds: nonNegIntDefault(0),
	totalVolume: nonNegNumberDefault(0),
	setCount: nonNegIntDefault(0),
	exerciseCount: nonNegIntDefault(0),
	prCount: nonNegIntDefault(0),
	routineName: nullableField(z.string()),
	workoutMode: nullableField(z.string()),
	routineSessionId: nullableField(z.string()),
	notes: nullableField(z.string()),
	exercises: arrayOf(exerciseSchema).default([]),
	// Session enrichment (all nullable in DB).
	avgVelocityMps: nullableField(z.number()),
	avgAsymmetryPct: nullableField(z.number()),
	velocityLossPct: nullableField(z.number()),
	dominantSide: nullableField(z.string()),
	strengthProfile: nullableField(z.string()),
	formScore: nullableField(z.number().int()),
	deloadWarnings: nullableField(nonNegInt),
	romViolations: nullableField(nonNegInt),
	spotterActivations: nullableField(nonNegInt),
	peakForceN: nullableField(nonNegNumber),
	estimatedCalories: nullableField(nonNegNumber),
	heaviestLiftKg: nullableField(nonNegNumber),
	eccentricLoad: nullableField(z.number().int()),
	echoLevel: nullableField(z.number().int()),
	warmupReps: nullableField(nonNegInt),
	workingReps: nullableField(nonNegInt),
});

const repTelemetrySchema = z.object({
	id: uuid,
	setId: uuid,
	timestampMs: nonNegNumber,
	forceN: nullableField(z.number()),
	velocityMps: nullableField(z.number()),
	positionMm: nullableField(z.number()),
	cable: nullableField(z.string()),
});

const routineExerciseSchema = z.object({
	id: uuid,
	routineId: uuid,
	exerciseId: nullableField(z.string()),
	name: z.string(),
	muscleGroup: z.string().nullish().transform((v) => v ?? "General"),
	sets: nonNegIntDefault(3),
	reps: nonNegIntDefault(10),
	weight: nonNegNumberDefault(0),
	restSeconds: nonNegIntDefault(90),
	mode: z.string().nullish().transform((v) => v ?? "OLD_SCHOOL"),
	orderIndex: nonNegIntDefault(0),
	supersetId: nullableField(z.string()),
	supersetColor: nullableField(z.string()),
	supersetOrder: nullableField(nonNegInt),
	perSetWeights: nullableField(z.string()),
	perSetRest: nullableField(z.string()),
	perSetReps: nullableField(z.string()),
	isAmrap: z.boolean().nullish().transform((v) => v ?? false),
	isBodyweight: z.boolean().nullish().transform((v) => v ?? false),
	prPercentage: nullableField(z.number()),
	repCountTiming: nullableField(z.string()),
	stopAtPosition: nullableField(z.string()),
	stallDetection: z.boolean().nullish().transform((v) => v ?? true),
	eccentricLoad: nullableField(z.string()),
	echoLevel: nullableField(z.string()),
	perSetEchoLevels: nullableField(z.string()),
	warmupSets: nullableField(z.string()),
});

const customExerciseSchema = z.object({
	clientId: z.string().min(1),
	name: z.string().trim().min(1),
	displayName: nullableField(z.string()),
	muscleGroup: z.string().nullish().transform((v) => v ?? "General"),
	equipment: nullableField(z.string()),
	defaultCableConfig: z.string().nullish().transform((v) => v ?? "DOUBLE"),
});

const routineSchema = z.object({
	id: uuid,
	userId: z.string(),
	name: z.string(),
	description: z.string().nullish().transform((v) => v ?? ""),
	exerciseCount: nonNegIntDefault(0),
	estimatedDuration: nonNegNumberDefault(0),
	timesCompleted: nonNegIntDefault(0),
	isFavorite: z.boolean().nullish().transform((v) => v ?? false),
	updatedAt: nullableDatetime(),
	exercises: arrayOf(routineExerciseSchema).default([]),
});

const cycleDaySchema = z.object({
	id: uuid,
	cycleId: uuid,
	dayNumber: z.number().int(),
	dayType: z.string().nullish().transform((v) => v ?? "workout"),
	routineId: nullableField(z.string()),
	// weightAdjustment / repModifier are signed deltas (a deload can reduce
	// load/reps), so they are NOT constrained to non-negative.
	weightAdjustment: z.number().finite().nullish().transform((v) => v ?? 0),
	repModifier: z.number().int().nullish().transform((v) => v ?? 0),
	restOverride: nullableField(nonNegInt),
	restType: nullableField(z.string()),
	notes: nullableField(z.string()),
});

const cycleSchema = z.object({
	id: uuid,
	userId: z.string(),
	name: z.string(),
	description: nullableField(z.string()),
	durationWeeks: nonNegIntDefault(4),
	workoutDays: nonNegIntDefault(0),
	restDays: nonNegIntDefault(0),
	currentWeek: nonNegIntDefault(1),
	status: z.string().nullish().transform((v) => v ?? "draft"),
	startedAt: nullableDatetime(),
	lastUsedAt: nullableDatetime(),
	updatedAt: nullableDatetime(),
	progressionSettings: nullableField(z.string()),
	deloadSettings: nullableField(z.string()),
	days: arrayOf(cycleDaySchema).default([]),
});

// RPG attributes are integer columns in Postgres, but mobile can ship finite
// floats (computed scores). The documented contract (_shared/rpgSchema.ts) is
// that float rounding at the push write is the defensive boundary — so accept
// any finite non-negative number and round it here rather than rejecting the
// payload before the rounding can run (Finding F339).
const rpgInt = (fallback: number) =>
	z
		.number()
		.finite()
		.nonnegative()
		.nullish()
		.transform((v) => (v == null ? fallback : Math.round(v)));

const rpgAttributesSchema = z.object({
	userId: z.string(),
	strength: rpgInt(0),
	power: rpgInt(0),
	stamina: rpgInt(0),
	consistency: rpgInt(0),
	mastery: rpgInt(0),
	characterClass: nullableField(z.string()),
	level: rpgInt(1),
	experiencePoints: rpgInt(0),
});

const badgeSchema = z.object({
	userId: z.string(),
	badgeId: z.string(),
	badgeName: z.string(),
	badgeDescription: nullableField(z.string()),
	badgeTier: z.string().nullish().transform((v) => v ?? "bronze"),
	earnedAt: datetimeWithDefault(() => new Date().toISOString()),
});

const gamificationStatsSchema = z.object({
	userId: z.string(),
	totalWorkouts: nonNegIntDefault(0),
	totalReps: nonNegIntDefault(0),
	totalVolumeKg: nonNegNumberDefault(0),
	longestStreak: nonNegIntDefault(0),
	currentStreak: nonNegIntDefault(0),
	totalTimeSeconds: nonNegIntDefault(0),
});

const phaseStatisticsSchema = z.object({
	id: uuid,
	sessionId: uuid,
	concentricKgAvg: z.number().nullish().transform((v) => v ?? 0),
	concentricKgMax: z.number().nullish().transform((v) => v ?? 0),
	concentricVelAvg: z.number().nullish().transform((v) => v ?? 0),
	concentricVelMax: z.number().nullish().transform((v) => v ?? 0),
	concentricWattAvg: z.number().nullish().transform((v) => v ?? 0),
	concentricWattMax: z.number().nullish().transform((v) => v ?? 0),
	eccentricKgAvg: z.number().nullish().transform((v) => v ?? 0),
	eccentricKgMax: z.number().nullish().transform((v) => v ?? 0),
	eccentricVelAvg: z.number().nullish().transform((v) => v ?? 0),
	eccentricVelMax: z.number().nullish().transform((v) => v ?? 0),
	eccentricWattAvg: z.number().nullish().transform((v) => v ?? 0),
	eccentricWattMax: z.number().nullish().transform((v) => v ?? 0),
});

const exerciseSignatureSchema = z.object({
	id: uuid,
	exerciseId: z.string(),
	romMm: nonNegNumberDefault(0),
	durationMs: nonNegNumberDefault(0),
	symmetryRatio: z.number().finite().nullish().transform((v) => v ?? 0.5),
	velocityProfile: z.string().nullish().transform((v) => v ?? "LINEAR"),
	cableConfig: z.string().nullish().transform((v) => v ?? "DUAL_SYMMETRIC"),
	sampleCount: nonNegIntDefault(1),
	confidence: nonNegNumberDefault(0),
	updatedAt: nullableDatetime(),
});

const assessmentResultSchema = z.object({
	id: uuid,
	exerciseId: z.string(),
	estimatedOneRepMaxKg: nonNegNumber,
	loadVelocityData: z.string(),
	assessmentSessionId: nullableField(z.string()),
	userOverrideKg: nullableField(nonNegNumber),
	createdAt: isoDatetime,
});

const localProfileSchema = z.object({
	id: localProfileIdSchema,
	name: z.string(),
	colorIndex: nonNegIntDefault(0),
});

const externalActivitySchema = z.object({
	id: uuid.optional(),
	externalId: z.string(),
	provider: z.string(),
	name: z.string(),
	activityType: z.string().nullish().transform((v) => v ?? "strength"),
	startedAt: isoDatetime,
	durationSeconds: nonNegIntDefault(0),
	distanceMeters: nullableField(nonNegNumber),
	calories: nullableField(nonNegInt),
	avgHeartRate: nullableField(nonNegInt),
	maxHeartRate: nullableField(nonNegInt),
	elevationGainMeters: nullableField(nonNegNumber),
	rawData: nullableField(z.string()),
	syncedAt: nullableDatetime(),
});

const personalRecordSchema = z.object({
	id: uuid.optional(),
	userId: nullableField(z.string()),
	exerciseName: z.string(),
	exerciseId: nullableField(z.string()),
	muscleGroup: z.string().nullish().transform((v) => v ?? "General"),
	recordType: z.string().nullish().transform((v) => v ?? "1RM"),
	value: nullableField(nonNegNumber),
	volume: nullableField(nonNegNumber),
	weightKg: nullableField(nonNegNumber),
	reps: nullableField(nonNegInt),
	workoutPhase: z.string().nullish().transform((v) => v ?? "COMBINED"),
	sessionId: nullableField(uuid),
	achievedAt: datetimeWithDefault(() => new Date().toISOString()),
	updatedAt: nullableDatetime(),
	localProfileId: localProfileIdSchema.nullable().optional(),
	// Accepted for wire compatibility; personal_records has no workout_mode
	// column, so the push handler can only preserve this through session_id.
	workoutMode: nullableField(z.string()),
});

// ─── Top-level ───────────────────────────────────────────────────────────

export const pushPayloadSchema = z.object({
	deviceId: z.string().min(1, "deviceId is required"),
	platform: platformSchema,
	lastSync: z.number().nullish().transform((v) => v ?? 0),
	sessions: arrayOf(sessionSchema).default([]),
	telemetry: arrayOf(repTelemetrySchema).default([]),
	routines: arrayOf(routineSchema).default([]),
	deletedRoutineIds: arrayOf(uuid).default([]),
	cycles: arrayOf(cycleSchema).default([]),
	deletedCycleIds: arrayOf(uuid).default([]),
	rpgAttributes: rpgAttributesSchema.nullable().optional(),
	badges: arrayOf(badgeSchema).default([]),
	gamificationStats: gamificationStatsSchema.nullable().optional(),
	phaseStatistics: arrayOf(phaseStatisticsSchema).default([]),
	exerciseSignatures: arrayOf(exerciseSignatureSchema).default([]),
	assessments: arrayOf(assessmentResultSchema).default([]),
	externalActivities: arrayOf(externalActivitySchema).nullable().optional(),
	personalRecords: arrayOf(personalRecordSchema).default([]),
	customExercises: arrayOf(customExerciseSchema).default([]),
	profileId: localProfileIdSchema.nullable().optional(),
	profileName: nullableField(z.string()),
	// allProfiles stays nullable (the handler branches on null vs array).
	allProfiles: z.array(localProfileSchema).nullable().optional(),
});

export type PushPayloadParsed = z.infer<typeof pushPayloadSchema>;

export interface PushPayloadDuplicateReport {
	table: string;
	ids: string[];
}

interface PushPayloadForDuplicateCheck {
	sessions?: Array<{
		id: string;
		exercises?: Array<{
			id: string;
			sets?: Array<{
				id: string;
				repSummaries?: Array<{ id: string }>;
			}>;
		}>;
	}>;
	telemetry?: Array<{ id: string }>;
	routines?: Array<{
		id: string;
		exerciseCount?: number;
		exercises?: Array<{ id: string }>;
	}>;
	cycles?: Array<{
		id: string;
		days?: Array<{ cycleId: string; dayNumber: number }>;
	}>;
	phaseStatistics?: Array<{ sessionId: string }>;
	exerciseSignatures?: Array<{ exerciseId: string }>;
	assessments?: Array<{ exerciseId: string; createdAt: string }>;
	badges?: Array<{ badgeId: string }>;
	externalActivities?: Array<{
		id?: string;
		provider: string;
		externalId: string;
	}> | null;
	customExercises?: Array<{ clientId: string }>;
	allProfiles?: Array<{ id: string }> | null;
}

function duplicateValues(values: string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of values) {
		// Normalize to lowercase: PostgreSQL UUID type is case-insensitive, so
		// "ABC-123" and "abc-123" collide on the same conflict target. iOS
		// NSUUID.UUIDString() returns uppercase; Android UUID.randomUUID()
		// returns lowercase. If the same session is synced from both platforms
		// or if IDs are mixed-case for any reason, the pre-flight check must
		// catch the collision before the upsert hits PostgreSQL.
		const normalized = value.toLowerCase();
		if (seen.has(normalized)) {
			duplicates.add(value);
		} else {
			seen.add(normalized);
		}
	}
	return [...duplicates].sort();
}

function reportDuplicate(
	reports: PushPayloadDuplicateReport[],
	table: string,
	values: string[],
) {
	const ids = duplicateValues(values.filter((v) => v.length > 0));
	if (ids.length > 0) {
		reports.push({ table, ids });
	}
}

/**
 * Detect duplicate conflict keys before mobile-sync-push performs any writes.
 *
 * PostgreSQL rejects a single INSERT ... ON CONFLICT DO UPDATE statement when
 * two input rows hit the same conflict target. Returning a deterministic 400
 * here prevents partial writes before the bulk upsert fails.
 */
export function findPushPayloadDuplicateConflictKeys(
	payload: PushPayloadForDuplicateCheck,
): PushPayloadDuplicateReport[] {
	const reports: PushPayloadDuplicateReport[] = [];

	reportDuplicate(
		reports,
		"workout_sessions",
		(payload.sessions ?? []).map((session) => session.id),
	);
	reportDuplicate(
		reports,
		"exercises",
		(payload.sessions ?? []).flatMap((session) =>
			(session.exercises ?? []).map((exercise) => exercise.id),
		),
	);
	reportDuplicate(
		reports,
		"sets",
		(payload.sessions ?? []).flatMap((session) =>
			(session.exercises ?? []).flatMap((exercise) =>
				(exercise.sets ?? []).map((set) => set.id),
			),
		),
	);
	reportDuplicate(
		reports,
		"rep_summaries",
		(payload.sessions ?? []).flatMap((session) =>
			(session.exercises ?? []).flatMap((exercise) =>
				(exercise.sets ?? []).flatMap((set) =>
					(set.repSummaries ?? []).map((summary) => summary.id),
				),
			),
		),
	);
	reportDuplicate(
		reports,
		"rep_telemetry",
		(payload.telemetry ?? []).map((point) => point.id),
	);
	reportDuplicate(
		reports,
		"routines",
		(payload.routines ?? []).map((routine) => routine.id),
	);
	reportDuplicate(
		reports,
		"routine_exercises",
		(payload.routines ?? []).flatMap((routine) =>
			(routine.exercises ?? []).map((exercise) => exercise.id),
		),
	);
	reportDuplicate(
		reports,
		"training_cycles",
		(payload.cycles ?? []).map((cycle) => cycle.id),
	);
	reportDuplicate(
		reports,
		"cycle_days",
		(payload.cycles ?? []).flatMap((cycle) =>
			(cycle.days ?? []).map((day) => `${day.cycleId}:${day.dayNumber}`),
		),
	);
	reportDuplicate(
		reports,
		"session_phase_statistics",
		(payload.phaseStatistics ?? []).map((stats) => stats.sessionId),
	);
	reportDuplicate(
		reports,
		"exercise_signatures",
		(payload.exerciseSignatures ?? []).map((signature) => signature.exerciseId),
	);
	reportDuplicate(
		reports,
		"vbt_assessments",
		(payload.assessments ?? []).map(
			(assessment) => `${assessment.exerciseId}:${assessment.createdAt}`,
		),
	);
	reportDuplicate(
		reports,
		"earned_badges",
		(payload.badges ?? []).map((badge) => badge.badgeId),
	);
	reportDuplicate(
		reports,
		"external_activities.id",
		(payload.externalActivities ?? []).flatMap((activity) =>
			activity.id ? [activity.id] : [],
		),
	);
	reportDuplicate(
		reports,
		"external_activities",
		(payload.externalActivities ?? []).map(
			(activity) => `${activity.provider}:${activity.externalId}`,
		),
	);
	reportDuplicate(
		reports,
		"exercise_catalog",
		(payload.customExercises ?? []).map((exercise) => exercise.clientId),
	);
	reportDuplicate(
		reports,
		"local_profiles",
		(payload.allProfiles ?? []).map((profile) => profile.id),
	);

	return reports;
}

export function formatPushPayloadDuplicateError(
	duplicates: PushPayloadDuplicateReport[],
): {
	error: string;
	duplicates: PushPayloadDuplicateReport[];
} {
	const first = duplicates[0];
	return {
		error: first
			? `Duplicate IDs in push payload: ${first.table} contains duplicate key(s): ${first.ids.join(", ")}`
			: "Duplicate IDs in push payload",
		duplicates,
	};
}

export function findPushPayloadIncompleteRoutines(
	payload: PushPayloadForDuplicateCheck,
): string[] {
	return (payload.routines ?? [])
		.filter(
			(routine) =>
				(routine.exerciseCount ?? 0) > 0 &&
				(routine.exercises ?? []).length === 0,
		)
		.map((routine) => routine.id)
		.sort();
}

export function formatPushPayloadIncompleteRoutinesError(
	routineIds: string[],
): {
	error: string;
	routineIds: string[];
} {
	return {
		error: `Incomplete routine payload: routine(s) with nonzero exerciseCount omitted exercises: ${routineIds.join(", ")}`,
		routineIds,
	};
}

/**
 * Format a Zod error for the response body. Returns a short summary plus
 * a list of `{path, message}` entries so mobile debugging doesn't require
 * looking at function logs.
 */
export function formatPushPayloadError(err: z.ZodError): {
	error: string;
	issues: Array<{ path: string; message: string }>;
} {
	const issues = err.issues.slice(0, 25).map((i) => ({
		path: i.path.map((p) => String(p)).join(".") || "(root)",
		message: i.message,
	}));
	return {
		error: "Invalid push payload",
		issues,
	};
}
