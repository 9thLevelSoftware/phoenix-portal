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

// Helper: coerce missing/null/non-array to [] before item-level validation.
function arrayOf<T extends z.ZodTypeAny>(item: T) {
	return z
		.unknown()
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
	repNumber: z.number().int(),
	meanVelocityMps: nullableField(z.number()),
	peakVelocityMps: nullableField(z.number()),
	meanForceN: nullableField(z.number()),
	peakForceN: nullableField(z.number()),
	powerWatts: nullableField(z.number()),
	romMm: nullableField(z.number()),
	tutMs: nullableField(z.number()),
	leftForceAvg: nullableField(z.number()),
	rightForceAvg: nullableField(z.number()),
	asymmetryPct: nullableField(z.number()),
	vbtZone: nullableField(z.string()),
});

const setSchema = z.object({
	id: uuid,
	exerciseId: uuid,
	setNumber: z.number().int(),
	targetReps: nullableField(z.number().int()),
	// DB defaults below — nullish coerces to the default so an explicit NULL
	// in the payload doesn't bypass DEFAULT on INSERT.
	actualReps: z.number().int().nullish().transform((v) => v ?? 0),
	weightKg: z.number().nullish().transform((v) => v ?? 0),
	rpe: nullableField(z.number().int()),
	isPr: z.boolean().nullish().transform((v) => v ?? false),
	// Send-only PR derivation hints (see PortalSetDto Kotlin doc).
	prType: nullableField(z.string()),
	prPhase: nullableField(z.string()),
	prVolume: nullableField(z.number()),
	notes: nullableField(z.string()),
	workoutMode: nullableField(z.string()),
	repSummaries: arrayOf(repSummarySchema).default([]),
});

const exerciseSchema = z.object({
	id: uuid,
	sessionId: uuid,
	name: z.string(),
	muscleGroup: z.string().nullish().transform((v) => v ?? "General"),
	orderIndex: z.number().int().nullish().transform((v) => v ?? 0),
	sets: arrayOf(setSchema).default([]),
});

const sessionSchema = z.object({
	id: uuid,
	userId: z.string(),
	name: nullableField(z.string()),
	startedAt: z
		.string()
		.nullish()
		.transform((v) => v ?? new Date().toISOString()),
	updatedAt: nullableField(z.string()),
	// DB NOT-NULL-DEFAULT numeric columns: coerce nullish → 0.
	durationSeconds: z.number().int().nullish().transform((v) => v ?? 0),
	totalVolume: z.number().nullish().transform((v) => v ?? 0),
	setCount: z.number().int().nullish().transform((v) => v ?? 0),
	exerciseCount: z.number().int().nullish().transform((v) => v ?? 0),
	prCount: z.number().int().nullish().transform((v) => v ?? 0),
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
	deloadWarnings: nullableField(z.number().int()),
	romViolations: nullableField(z.number().int()),
	spotterActivations: nullableField(z.number().int()),
	peakForceN: nullableField(z.number()),
	estimatedCalories: nullableField(z.number()),
	heaviestLiftKg: nullableField(z.number()),
	eccentricLoad: nullableField(z.number().int()),
	echoLevel: nullableField(z.number().int()),
	warmupReps: nullableField(z.number().int()),
	workingReps: nullableField(z.number().int()),
});

const repTelemetrySchema = z.object({
	id: uuid,
	setId: uuid,
	timestampMs: z.number(),
	forceN: nullableField(z.number()),
	velocityMps: nullableField(z.number()),
	positionMm: nullableField(z.number()),
	cable: nullableField(z.string()),
});

const routineExerciseSchema = z.object({
	id: uuid,
	routineId: uuid,
	name: z.string(),
	muscleGroup: z.string().nullish().transform((v) => v ?? "General"),
	sets: z.number().int().nullish().transform((v) => v ?? 3),
	reps: z.number().int().nullish().transform((v) => v ?? 10),
	weight: z.number().nullish().transform((v) => v ?? 0),
	restSeconds: z.number().int().nullish().transform((v) => v ?? 90),
	mode: z.string().nullish().transform((v) => v ?? "OLD_SCHOOL"),
	orderIndex: z.number().int().nullish().transform((v) => v ?? 0),
	supersetId: nullableField(z.string()),
	supersetColor: nullableField(z.string()),
	supersetOrder: nullableField(z.number().int()),
	perSetWeights: nullableField(z.string()),
	perSetRest: nullableField(z.string()),
	isAmrap: z.boolean().nullish().transform((v) => v ?? false),
	isBodyweight: z.boolean().nullish().transform((v) => v ?? false),
	prPercentage: nullableField(z.number()),
	repCountTiming: nullableField(z.string()),
	stopAtPosition: nullableField(z.string()),
	stallDetection: z.boolean().nullish().transform((v) => v ?? false),
	eccentricLoad: nullableField(z.string()),
	echoLevel: nullableField(z.string()),
	perSetEchoLevels: nullableField(z.string()),
	warmupSets: nullableField(z.string()),
});

const routineSchema = z.object({
	id: uuid,
	userId: z.string(),
	name: z.string(),
	description: z.string().nullish().transform((v) => v ?? ""),
	exerciseCount: z.number().int().nullish().transform((v) => v ?? 0),
	estimatedDuration: z.number().nullish().transform((v) => v ?? 0),
	timesCompleted: z.number().int().nullish().transform((v) => v ?? 0),
	isFavorite: z.boolean().nullish().transform((v) => v ?? false),
	updatedAt: nullableField(z.string()),
	exercises: arrayOf(routineExerciseSchema).default([]),
});

const cycleDaySchema = z.object({
	id: uuid,
	cycleId: uuid,
	dayNumber: z.number().int(),
	dayType: z.string().nullish().transform((v) => v ?? "workout"),
	routineId: nullableField(z.string()),
	weightAdjustment: z.number().nullish().transform((v) => v ?? 0),
	repModifier: z.number().int().nullish().transform((v) => v ?? 0),
	restOverride: nullableField(z.number().int()),
	restType: nullableField(z.string()),
	notes: nullableField(z.string()),
});

const cycleSchema = z.object({
	id: uuid,
	userId: z.string(),
	name: z.string(),
	description: nullableField(z.string()),
	durationWeeks: z.number().int().nullish().transform((v) => v ?? 4),
	workoutDays: z.number().int().nullish().transform((v) => v ?? 0),
	restDays: z.number().int().nullish().transform((v) => v ?? 0),
	currentWeek: z.number().int().nullish().transform((v) => v ?? 1),
	status: z.string().nullish().transform((v) => v ?? "draft"),
	startedAt: nullableField(z.string()),
	lastUsedAt: nullableField(z.string()),
	updatedAt: nullableField(z.string()),
	progressionSettings: nullableField(z.string()),
	deloadSettings: nullableField(z.string()),
	days: arrayOf(cycleDaySchema).default([]),
});

const rpgAttributesSchema = z.object({
	userId: z.string(),
	strength: z.number().int().nullish().transform((v) => v ?? 0),
	power: z.number().int().nullish().transform((v) => v ?? 0),
	stamina: z.number().int().nullish().transform((v) => v ?? 0),
	consistency: z.number().int().nullish().transform((v) => v ?? 0),
	mastery: z.number().int().nullish().transform((v) => v ?? 0),
	characterClass: nullableField(z.string()),
	level: z.number().int().nullish().transform((v) => v ?? 1),
	experiencePoints: z.number().int().nullish().transform((v) => v ?? 0),
});

const badgeSchema = z.object({
	userId: z.string(),
	badgeId: z.string(),
	badgeName: z.string(),
	badgeDescription: nullableField(z.string()),
	badgeTier: z.string().nullish().transform((v) => v ?? "bronze"),
	earnedAt: z
		.string()
		.nullish()
		.transform((v) => v ?? new Date().toISOString()),
});

const gamificationStatsSchema = z.object({
	userId: z.string(),
	totalWorkouts: z.number().int().nullish().transform((v) => v ?? 0),
	totalReps: z.number().int().nullish().transform((v) => v ?? 0),
	totalVolumeKg: z.number().nullish().transform((v) => v ?? 0),
	longestStreak: z.number().int().nullish().transform((v) => v ?? 0),
	currentStreak: z.number().int().nullish().transform((v) => v ?? 0),
	totalTimeSeconds: z.number().int().nullish().transform((v) => v ?? 0),
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
	romMm: z.number().nullish().transform((v) => v ?? 0),
	durationMs: z.number().nullish().transform((v) => v ?? 0),
	symmetryRatio: z.number().nullish().transform((v) => v ?? 0.5),
	velocityProfile: z.string().nullish().transform((v) => v ?? "LINEAR"),
	cableConfig: z.string().nullish().transform((v) => v ?? "DUAL_SYMMETRIC"),
	sampleCount: z.number().int().nullish().transform((v) => v ?? 1),
	confidence: z.number().nullish().transform((v) => v ?? 0),
	updatedAt: nullableField(z.string()),
});

const assessmentResultSchema = z.object({
	id: uuid,
	exerciseId: z.string(),
	estimatedOneRepMaxKg: z.number(),
	loadVelocityData: z.string(),
	assessmentSessionId: nullableField(z.string()),
	userOverrideKg: nullableField(z.number()),
	createdAt: z.string(),
});

const localProfileSchema = z.object({
	id: localProfileIdSchema,
	name: z.string(),
	colorIndex: z.number().int().nullish().transform((v) => v ?? 0),
});

const externalActivitySchema = z.object({
	id: uuid.optional(),
	externalId: z.string(),
	provider: z.string(),
	name: z.string(),
	activityType: z.string().nullish().transform((v) => v ?? "strength"),
	startedAt: z.string(),
	durationSeconds: z.number().int().nullish().transform((v) => v ?? 0),
	distanceMeters: nullableField(z.number()),
	calories: nullableField(z.number().int()),
	avgHeartRate: nullableField(z.number().int()),
	maxHeartRate: nullableField(z.number().int()),
	elevationGainMeters: nullableField(z.number()),
	rawData: nullableField(z.string()),
	syncedAt: nullableField(z.string()),
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
	profileId: localProfileIdSchema.nullable().optional(),
	profileName: nullableField(z.string()),
	// allProfiles stays nullable (the handler branches on null vs array).
	allProfiles: z.array(localProfileSchema).nullable().optional(),
});

export type PushPayloadParsed = z.infer<typeof pushPayloadSchema>;

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
