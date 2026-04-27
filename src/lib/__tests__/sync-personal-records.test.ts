import { describe, expect, it } from "vitest";
import { buildPersonalRecordRows } from "../../../supabase/functions/_shared/personalRecordRow.ts";

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
