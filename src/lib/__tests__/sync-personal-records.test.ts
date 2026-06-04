import { describe, expect, it } from "vitest";
import {
	buildDedicatedPersonalRecordRows,
	buildPersonalRecordRows,
	buildPersonalRecordRowsForPush,
	personalRecordIdentityKey,
} from "../../../supabase/functions/_shared/personalRecordRow.ts";

/**
 * These tests lock in the NOT-NULL-DEFAULT guards for personal_records.
 * The DB columns muscle_group, record_type, unit, and workout_phase all
 * have DEFAULTs but are listed explicitly in the INSERT, so an explicit
 * NULL would bypass DEFAULT and fail the NOT-NULL constraint. The helper
 * must coerce missing values to the schema defaults before the insert.
 */

const USER_ID = "00000000-0000-0000-0000-000000000001";
const PROFILE_ID = "default";

type Overrides = Partial<{
	isPr: boolean;
	prType: string | null;
	prPhase: string | null;
	prVolume: number | null;
	exerciseId: string | null;
	muscleGroup: string | null;
	weightKg: number;
	actualReps: number;
}>;

function baseSession(overrides: Overrides = {}) {
	// `in` check preserves explicit-null overrides (used by the "DB defaults"
	// test); `??` would collapse null back to the fallback and defeat the
	// test intent.
	const muscleGroup =
		"muscleGroup" in overrides ? overrides.muscleGroup : "Legs";
	const prType = "prType" in overrides ? overrides.prType : undefined;
	const prPhase = "prPhase" in overrides ? overrides.prPhase : undefined;
	const prVolume = "prVolume" in overrides ? overrides.prVolume : undefined;
	return {
		startedAt: "2026-04-20T12:00:00.000Z",
		exercises: [
			{
				name: "Squat",
				exerciseId: overrides.exerciseId,
				muscleGroup,
				sets: [
					{
						isPr: overrides.isPr ?? true,
						prType,
						prPhase,
						prVolume,
						weightKg: overrides.weightKg ?? 100,
						actualReps: overrides.actualReps ?? 5,
					},
				],
			},
		],
	};
}

describe("buildPersonalRecordRows", () => {
	it("skips sets that are not PRs", () => {
		const out = buildPersonalRecordRows(
			[baseSession({ isPr: false })],
			USER_ID,
			PROFILE_ID,
		);
		expect(out).toEqual([]);
	});

	it("applies DB defaults when optional fields are null", () => {
		const out = buildPersonalRecordRows(
			[baseSession({ prType: null, prPhase: null, muscleGroup: null })],
			USER_ID,
			PROFILE_ID,
		);
		expect(out).toHaveLength(1);
		// biome-ignore lint/style/noNonNullAssertion: length asserted above
		const row = out[0]!;
		expect(row.record_type).toBe("1RM");
		expect(row.workout_phase).toBe("COMBINED");
		expect(row.muscle_group).toBe("General");
		expect(row.unit).toBe("kg");
	});

	it("preserves non-null overrides", () => {
		const out = buildPersonalRecordRows(
			[
				baseSession({
					prType: "MAX_VOLUME",
					prPhase: "CONCENTRIC",
					muscleGroup: "Quads",
					prVolume: 1500,
				}),
			],
			USER_ID,
			PROFILE_ID,
		);
		// biome-ignore lint/style/noNonNullAssertion: single-element array access in test
		const row = out[0]!;
		expect(row.record_type).toBe("MAX_VOLUME");
		expect(row.workout_phase).toBe("CONCENTRIC");
		expect(row.muscle_group).toBe("Quads");
		expect(row.unit).toBe("kg×reps");
		expect(row.value).toBe(1500);
	});

	it("computes MAX_VOLUME fallback from weight × reps when prVolume missing", () => {
		const out = buildPersonalRecordRows(
			[
				baseSession({
					prType: "MAX_VOLUME",
					prVolume: null,
					weightKg: 50,
					actualReps: 10,
				}),
			],
			USER_ID,
			PROFILE_ID,
		);
		expect(out[0]?.value).toBe(500);
	});

	it("uses weightKg as value for non-MAX_VOLUME record types", () => {
		const out = buildPersonalRecordRows(
			[baseSession({ prType: "1RM", weightKg: 120 })],
			USER_ID,
			PROFILE_ID,
		);
		expect(out[0]?.value).toBe(120);
		expect(out[0]?.unit).toBe("kg");
	});

	it("passes through achieved_at from session.startedAt unchanged", () => {
		const out = buildPersonalRecordRows([baseSession()], USER_ID, PROFILE_ID);
		expect(out[0]?.achieved_at).toBe("2026-04-20T12:00:00.000Z");
	});

	it("accepts null localProfileId (pre-multi-profile clients)", () => {
		const out = buildPersonalRecordRows([baseSession()], USER_ID, null);
		expect(out[0]?.local_profile_id).toBeNull();
	});

	it("preserves catalog exercise IDs on derived rows", () => {
		const out = buildPersonalRecordRows(
			[baseSession({ exerciseId: "catalog-squat-barbell" })],
			USER_ID,
			PROFILE_ID,
		);
		expect(out[0]?.exercise_id).toBe("catalog-squat-barbell");
	});

	it("flattens multiple sessions × exercises × sets", () => {
		const out = buildPersonalRecordRows(
			[
				{
					startedAt: "2026-04-20T12:00:00.000Z",
					exercises: [
						{
							name: "Bench",
							muscleGroup: "Chest",
							sets: [
								{ isPr: true, weightKg: 80, actualReps: 5 },
								{ isPr: false, weightKg: 70, actualReps: 8 },
							],
						},
						{
							name: "Row",
							muscleGroup: "Back",
							sets: [{ isPr: true, weightKg: 60, actualReps: 10 }],
						},
					],
				},
			],
			USER_ID,
			PROFILE_ID,
		);
		expect(out).toHaveLength(2);
		expect(out.map((r) => r.exercise_name)).toEqual(["Bench", "Row"]);
	});
});

describe("buildDedicatedPersonalRecordRows", () => {
	it("maps mobile personalRecords rows to supported personal_records columns", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					id: "11111111-1111-4111-8111-111111111111",
					exerciseName: "Bench Press",
					exerciseId: "catalog-bench-press",
					muscleGroup: "Chest",
					recordType: "MAX_WEIGHT",
					value: 125,
					weightKg: 125,
					reps: 3,
					workoutPhase: "CONCENTRIC",
					sessionId: "22222222-2222-4222-8222-222222222222",
					achievedAt: "2026-04-21T12:00:00.000Z",
					updatedAt: "2026-04-21T12:30:00.000Z",
				},
			],
			USER_ID,
			PROFILE_ID,
		);

		expect(out).toEqual([
			{
				id: "11111111-1111-4111-8111-111111111111",
				user_id: USER_ID,
				local_profile_id: PROFILE_ID,
				exercise_name: "Bench Press",
				exercise_id: "catalog-bench-press",
				muscle_group: "Chest",
				record_type: "MAX_WEIGHT",
				value: 125,
				weight_kg: 125,
				reps: 3,
				unit: "kg",
				session_id: "22222222-2222-4222-8222-222222222222",
				achieved_at: "2026-04-21T12:00:00.000Z",
				updated_at: "2026-04-21T12:30:00.000Z",
				workout_phase: "CONCENTRIC",
			},
		]);
	});

	it("uses volume as the value for MAX_VOLUME records when value is absent", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					exerciseName: "Squat",
					muscleGroup: null,
					recordType: "MAX_VOLUME",
					value: null,
					volume: 1800,
					weightKg: 90,
					reps: 20,
					workoutPhase: null,
					achievedAt: "2026-04-21T12:00:00.000Z",
				},
			],
			USER_ID,
			null,
		);

		expect(out[0]?.value).toBe(1800);
		expect(out[0]?.unit).toBe("kg×reps");
		expect(out[0]?.muscle_group).toBe("General");
		expect(out[0]?.workout_phase).toBe("COMBINED");
		expect(out[0]?.local_profile_id).toBeNull();
	});
});

describe("buildPersonalRecordRowsForPush", () => {
	it("treats dedicated personalRecords as authoritative over set-derived fallback", () => {
		const dedicated = [
			{
				exerciseName: "Bench Press",
				muscleGroup: "Chest",
				recordType: "MAX_WEIGHT",
				value: 125,
				workoutPhase: "ECCENTRIC",
				achievedAt: "2026-04-21T12:00:00.000Z",
			},
		];

		const rows = buildPersonalRecordRowsForPush(
			[baseSession({ prType: "MAX_VOLUME", prPhase: "CONCENTRIC" })],
			dedicated,
			USER_ID,
			PROFILE_ID,
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.exercise_name).toBe("Bench Press");
		expect(rows[0]?.record_type).toBe("MAX_WEIGHT");
		expect(rows[0]?.workout_phase).toBe("ECCENTRIC");
	});
});

describe("personalRecordIdentityKey", () => {
	const baseRecord = {
		local_profile_id: PROFILE_ID,
		exercise_name: "Curl",
		achieved_at: "2026-04-20T12:00:00.000Z",
		value: 40,
		record_type: "1RM",
		workout_phase: "COMBINED",
	};

	it("separates matching-name records by catalog exercise ID", () => {
		expect(
			personalRecordIdentityKey({
				...baseRecord,
				exercise_id: "curl-cable",
			}),
		).not.toBe(
			personalRecordIdentityKey({
				...baseRecord,
				exercise_id: "curl-dumbbell",
			}),
		);
	});

	it("falls back to exercise name when exercise ID is absent", () => {
		expect(
			personalRecordIdentityKey({
				...baseRecord,
				exercise_id: null,
			}),
		).toBe(
			personalRecordIdentityKey({
				...baseRecord,
				exercise_id: undefined,
			}),
		);
	});

	it("normalizes numeric values across DB and client representations", () => {
		expect(
			personalRecordIdentityKey({
				...baseRecord,
				value: 40,
			}),
		).toBe(
			personalRecordIdentityKey({
				...baseRecord,
				value: "40",
			}),
		);
	});

	it("dedupes corrected values for the same achieved record identity", () => {
		expect(
			personalRecordIdentityKey({
				...baseRecord,
				value: 40,
			}),
		).toBe(
			personalRecordIdentityKey({
				...baseRecord,
				value: 42.5,
			}),
		);
	});

	it("separates matching records by workout phase", () => {
		expect(
			personalRecordIdentityKey({
				...baseRecord,
				workout_phase: "CONCENTRIC",
			}),
		).not.toBe(
			personalRecordIdentityKey({
				...baseRecord,
				workout_phase: "ECCENTRIC",
			}),
		);
	});

	it("separates records by local profile", () => {
		expect(
			personalRecordIdentityKey({
				...baseRecord,
				local_profile_id: "default",
			}),
		).not.toBe(
			personalRecordIdentityKey({
				...baseRecord,
				local_profile_id: "secondary",
			}),
		);
	});

	it("does not collide when identity fields contain separators", () => {
		expect(
			personalRecordIdentityKey({
				...baseRecord,
				local_profile_id: "profile:name",
				exercise_id: "curl",
				exercise_name: "ignored",
			}),
		).not.toBe(
			personalRecordIdentityKey({
				...baseRecord,
				local_profile_id: "profile",
				exercise_id: null,
				exercise_name: "id:curl",
			}),
		);
	});
});
