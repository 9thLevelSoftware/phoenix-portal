import { describe, expect, it } from "vitest";
import {
	buildDedicatedPersonalRecordRows,
	buildLocalProfileRepairRowsForDedicatedRecords,
	buildPersonalRecordRows,
	buildPersonalRecordRowsForPush,
	chunkLocalProfileIdsForRepair,
	collectDedicatedRecordLocalProfileIds,
	hydratePersonalRecordExerciseNamesFromCatalog,
	hydratePersonalRecordExerciseNamesFromSessionExercises,
	isPostgresForeignKeyViolation,
	partitionPersonalRecordRowsByExerciseCatalogValidity,
	partitionPersonalRecordRowsByLocalProfileValidity,
	partitionPersonalRecordRowsBySessionValidity,
	personalRecordIdentityKey,
	resolveDedicatedRecordLocalProfileId,
	shouldRepairDedicatedRecordLocalProfilesForPush,
	shouldValidatePersonalRecordProfileIdsForPush,
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

function basePersonalRecordRow(exerciseName: string) {
	return {
		user_id: USER_ID,
		local_profile_id: PROFILE_ID,
		exercise_name: exerciseName,
		exercise_id: null,
		muscle_group: "General",
		record_type: "1RM",
		value: 100,
		weight_kg: 100,
		reps: 1,
		unit: "kg",
		session_id: null,
		achieved_at: "2026-04-20T12:00:00.000Z",
		workout_phase: "COMBINED",
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

	it("preserves the stable ID and mutation timestamps for a tombstone", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					id: "11111111-1111-4111-8111-111111111111",
					exerciseName: "Bench Press",
					recordType: "MAX_WEIGHT",
					value: 125,
					achievedAt: "2026-04-21T12:00:00.000Z",
					updatedAt: "2026-04-22T12:00:00.000Z",
					deletedAt: "2026-04-22T12:00:00.000Z",
				},
			],
			USER_ID,
			PROFILE_ID,
		);

		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			id: "11111111-1111-4111-8111-111111111111",
			updated_at: "2026-04-22T12:00:00.000Z",
			deleted_at: "2026-04-22T12:00:00.000Z",
		});
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

	// Root-cause regression (rate_limit_exceeded incident, 2026-07-07):
	// mobile sends achieved_at as kotlin Instant.toString() ("...Z") while
	// PostgREST returns the stored timestamptz as "...+00:00". The derived
	// identity key compared these raw strings, so an id-less re-pushed PR
	// NEVER matched its existing DB row and inserted a duplicate on every
	// sync (observed: 361k rows for ~4k logical PRs; pull pagination then
	// exceeded the 20/min rate limit).
	describe("achieved_at timestamp-format normalization", () => {
		it("matches mobile 'Z' format against PostgREST '+00:00' format", () => {
			expect(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T00:32:58.187Z",
				}),
			).toBe(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T00:32:58.187+00:00",
				}),
			);
		});

		it("matches non-UTC offsets representing the same instant", () => {
			expect(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T02:32:58.187+02:00",
				}),
			).toBe(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T00:32:58.187Z",
				}),
			);
		});

		it("matches second-precision against explicit zero milliseconds", () => {
			expect(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T00:32:58Z",
				}),
			).toBe(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T00:32:58.000+00:00",
				}),
			);
		});

		it("still separates genuinely different instants", () => {
			expect(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T00:32:58.187Z",
				}),
			).not.toBe(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "2026-06-10T00:32:58.188Z",
				}),
			);
		});

		it("falls back to the raw string for unparseable values", () => {
			expect(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "not-a-timestamp",
				}),
			).toBe(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "not-a-timestamp",
				}),
			);
			expect(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "not-a-timestamp",
				}),
			).not.toBe(
				personalRecordIdentityKey({
					...baseRecord,
					achieved_at: "also-not-a-timestamp",
				}),
			);
		});
	});
});

describe("Issue #507: per-record localProfileId validation", () => {
	// These tests lock in the fix for Cloud Sync personal_records upsert
	// failing the `fk_personal_records_profile` foreign key when a dedicated
	// personalRecord carries a stale/invalid per-record `localProfileId` that
	// bypasses the handler-sanitized top-level `localProfileId`.

	const VALID_IDS = new Set(["default", "secondary"]);

	it("preserves a per-record localProfileId that is in the valid set", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					exerciseName: "Bench Press",
					muscleGroup: "Chest",
					recordType: "MAX_WEIGHT",
					value: 125,
					weightKg: 125,
					reps: 3,
					workoutPhase: "CONCENTRIC",
					achievedAt: "2026-04-21T12:00:00.000Z",
					localProfileId: "secondary",
				},
			],
			USER_ID,
			PROFILE_ID, // sanitized handler fallback = "default"
			VALID_IDS,
		);

		expect(out).toHaveLength(1);
		expect(out[0]?.local_profile_id).toBe("secondary");
	});

	it("falls back to the sanitized handler localProfileId when the per-record ID is invalid and the handler has one", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					exerciseName: "Squat",
					muscleGroup: "Legs",
					recordType: "MAX_WEIGHT",
					value: 200,
					weightKg: 200,
					reps: 1,
					workoutPhase: "COMBINED",
					achievedAt: "2026-04-21T12:00:00.000Z",
					// Stale/invalid ID not present in the current push's valid set.
					localProfileId: "deleted-profile-uuid",
				},
			],
			USER_ID,
			PROFILE_ID, // sanitized handler fallback = "default"
			VALID_IDS,
		);

		expect(out).toHaveLength(1);
		expect(out[0]?.local_profile_id).toBe("default");
	});

	it("nulls the per-record localProfileId when it is invalid and the sanitized handler fallback is null", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					exerciseName: "Deadlift",
					muscleGroup: "Back",
					recordType: "MAX_WEIGHT",
					value: 250,
					weightKg: 250,
					reps: 1,
					workoutPhase: "COMBINED",
					achievedAt: "2026-04-21T12:00:00.000Z",
					localProfileId: "stale-profile-uuid",
				},
			],
			USER_ID,
			null, // sanitized handler fallback = null (pre-multi-profile clients)
			VALID_IDS,
		);

		expect(out).toHaveLength(1);
		expect(out[0]?.local_profile_id).toBeNull();
	});

	it("uses the sanitized handler fallback when the per-record localProfileId is undefined", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					exerciseName: "Overhead Press",
					muscleGroup: "Shoulders",
					recordType: "MAX_WEIGHT",
					value: 80,
					weightKg: 80,
					reps: 5,
					workoutPhase: "CONCENTRIC",
					achievedAt: "2026-04-21T12:00:00.000Z",
					// localProfileId deliberately omitted (undefined).
				},
			],
			USER_ID,
			PROFILE_ID,
			VALID_IDS,
		);

		expect(out).toHaveLength(1);
		expect(out[0]?.local_profile_id).toBe("default");
	});

	it("preserves the historical behavior when no valid set is supplied", () => {
		// Call sites that don't yet know about the current push's profile
		// set should keep the old semantics: any defined string ID is
		// trusted. This guarantees the new parameter is opt-in.
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					exerciseName: "Bench Press",
					muscleGroup: "Chest",
					recordType: "MAX_WEIGHT",
					value: 125,
					weightKg: 125,
					reps: 3,
					workoutPhase: "CONCENTRIC",
					achievedAt: "2026-04-21T12:00:00.000Z",
					localProfileId: "any-stale-id",
				},
			],
			USER_ID,
			PROFILE_ID,
			null, // no valid set supplied
		);

		expect(out).toHaveLength(1);
		expect(out[0]?.local_profile_id).toBe("any-stale-id");
	});

	it("normalizes a mix of valid and invalid per-record IDs in the same batch", () => {
		const out = buildDedicatedPersonalRecordRows(
			[
				{
					exerciseName: "Squat",
					recordType: "MAX_WEIGHT",
					value: 200,
					weightKg: 200,
					reps: 1,
					workoutPhase: "COMBINED",
					achievedAt: "2026-04-21T12:00:00.000Z",
					localProfileId: "default", // valid
				},
				{
					exerciseName: "Bench Press",
					recordType: "MAX_WEIGHT",
					value: 125,
					weightKg: 125,
					reps: 3,
					workoutPhase: "COMBINED",
					achievedAt: "2026-04-21T12:00:00.000Z",
					localProfileId: "stale-id", // invalid
				},
				{
					exerciseName: "Deadlift",
					recordType: "MAX_WEIGHT",
					value: 250,
					weightKg: 250,
					reps: 1,
					workoutPhase: "COMBINED",
					achievedAt: "2026-04-21T12:00:00.000Z",
					// undefined -> fallback
				},
			],
			USER_ID,
			"secondary", // sanitized handler fallback
			new Set(["default", "secondary"]),
		);

		expect(out.map((r) => r.local_profile_id)).toEqual([
			"default",
			"secondary",
			"secondary",
		]);
	});

	it("propagates the valid set through buildPersonalRecordRowsForPush for dedicated records", () => {
		const rows = buildPersonalRecordRowsForPush(
			[baseSession({ prType: "MAX_VOLUME", prPhase: "CONCENTRIC" })], // ignored when dedicated present
			[
				{
					exerciseName: "Bench Press",
					muscleGroup: "Chest",
					recordType: "MAX_WEIGHT",
					value: 125,
					weightKg: 125,
					reps: 3,
					workoutPhase: "CONCENTRIC",
					achievedAt: "2026-04-21T12:00:00.000Z",
					localProfileId: "stale-id", // invalid
				},
			],
			USER_ID,
			PROFILE_ID,
			VALID_IDS,
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.local_profile_id).toBe("default");
	});

	it("propagates the valid set through buildPersonalRecordRowsForPush for set-derived records when no dedicated records are present", () => {
		// Set-derived path uses the handler fallback directly, not
		// per-record IDs, so the valid-set parameter is irrelevant here.
		// The set is still accepted (and ignored) to keep the signature
		// uniform across both branches.
		const rows = buildPersonalRecordRowsForPush(
			[baseSession()],
			[],
			USER_ID,
			PROFILE_ID,
			VALID_IDS,
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]?.local_profile_id).toBe("default");
	});

	it("enables validation when dedicated records carry profile IDs without top-level profile context", () => {
		expect(
			shouldValidatePersonalRecordProfileIdsForPush({
				allProfiles: null,
				localProfileId: null,
				personalRecords: [
					{
						exerciseName: "Squat",
						localProfileId: "default",
					},
				],
			}),
		).toBe(true);
	});

	it("collects unique dedicated-record localProfileIds for repair lookup", () => {
		expect(
			collectDedicatedRecordLocalProfileIds([
				{ exerciseName: "Squat", localProfileId: "default" },
				{ exerciseName: "Bench", localProfileId: "default" },
				{ exerciseName: "Deadlift", localProfileId: null },
				{ exerciseName: "Press" },
				{ exerciseName: "Row", localProfileId: "secondary" },
			]),
		).toEqual(["default", "secondary"]);
	});

	it("builds placeholder local profile rows for legacy dedicated records that only carry per-record IDs", () => {
		const rows = buildLocalProfileRepairRowsForDedicatedRecords(
			["default", "11111111-1111-4111-8111-111111111111"],
			USER_ID,
			"device-1",
			"2026-06-07T12:00:00.000Z",
		);

		expect(rows).toEqual([
			{
				user_id: USER_ID,
				id: "default",
				name: "Default",
				color_index: 0,
				device_id: "device-1",
				updated_at: "2026-06-07T12:00:00.000Z",
			},
			{
				user_id: USER_ID,
				id: "11111111-1111-4111-8111-111111111111",
				name: "Profile",
				color_index: 0,
				device_id: "device-1",
				updated_at: "2026-06-07T12:00:00.000Z",
			},
		]);
	});

	it("does not repair stale per-record IDs when the top-level fallback profile is valid", () => {
		expect(
			shouldRepairDedicatedRecordLocalProfilesForPush({
				allProfiles: null,
				localProfileId: "default",
				validLocalProfileIds: new Set(["default"]),
				missingLocalProfileIds: ["deleted-profile-uuid"],
			}),
		).toBe(false);
	});

	it("repairs missing per-record IDs when there is no top-level fallback profile", () => {
		expect(
			shouldRepairDedicatedRecordLocalProfilesForPush({
				allProfiles: null,
				localProfileId: null,
				validLocalProfileIds: new Set(),
				missingLocalProfileIds: ["legacy-profile-uuid"],
			}),
		).toBe(true);
	});

	it("repairs missing per-record IDs when the handler fallback is no longer valid", () => {
		expect(
			shouldRepairDedicatedRecordLocalProfilesForPush({
				allProfiles: null,
				localProfileId: "default",
				validLocalProfileIds: new Set(),
				missingLocalProfileIds: ["legacy-profile-uuid"],
			}),
		).toBe(true);
	});

	it("does not repair per-record IDs when allProfiles supplies profile context", () => {
		expect(
			shouldRepairDedicatedRecordLocalProfilesForPush({
				allProfiles: [{ id: "default" }],
				localProfileId: null,
				validLocalProfileIds: new Set(["default"]),
				missingLocalProfileIds: ["legacy-profile-uuid"],
			}),
		).toBe(false);
	});

	it("chunks dedicated-record profile lookups and repairs into 100-id batches", () => {
		const profileIds = Array.from(
			{ length: 205 },
			(_, index) => `profile-${index + 1}`,
		);

		const chunks = chunkLocalProfileIdsForRepair(profileIds);

		expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 5]);
		expect(chunks[0]?.[0]).toBe("profile-1");
		expect(chunks[2]?.[4]).toBe("profile-205");
	});

	it("classifies foreign-key failures by PostgreSQL error code", () => {
		expect(isPostgresForeignKeyViolation({ code: "23503" })).toBe(true);
		expect(
			isPostgresForeignKeyViolation({
				code: "23505",
				message: "duplicate key",
			}),
		).toBe(false);
		expect(
			isPostgresForeignKeyViolation({
				message:
					'violates foreign key constraint "fk_personal_records_profile"',
			}),
		).toBe(false);
		expect(isPostgresForeignKeyViolation(null)).toBe(false);
	});

	it("partitions only invalid profile-scoped personal records for null-profile retry", () => {
		const validDefaultRow = {
			...basePersonalRecordRow("Squat"),
			local_profile_id: "default",
		};
		const unscopedRow = {
			...basePersonalRecordRow("Bench Press"),
			local_profile_id: null,
		};
		const staleProfileRow = {
			...basePersonalRecordRow("Deadlift"),
			local_profile_id: "stale-profile",
		};

		const partition = partitionPersonalRecordRowsByLocalProfileValidity(
			[validDefaultRow, unscopedRow, staleProfileRow],
			new Set(["default"]),
		);

		expect(partition.validRows).toEqual([validDefaultRow, unscopedRow]);
		expect(partition.invalidProfileRows).toEqual([staleProfileRow]);
		expect(partition.rowsWithInvalidProfilesNulled).toEqual([
			validDefaultRow,
			unscopedRow,
			{ ...staleProfileRow, local_profile_id: null },
		]);
	});
});

describe("resolveDedicatedRecordLocalProfileId", () => {
	const VALID_IDS = new Set(["default", "secondary"]);

	it("returns the handler fallback for undefined per-record ID", () => {
		expect(
			resolveDedicatedRecordLocalProfileId(undefined, "default", VALID_IDS),
		).toBe("default");
	});

	it("returns null for undefined per-record ID when handler fallback is null", () => {
		expect(
			resolveDedicatedRecordLocalProfileId(undefined, null, VALID_IDS),
		).toBeNull();
	});

	it("returns null for undefined per-record ID when handler fallback is absent from the valid set", () => {
		expect(
			resolveDedicatedRecordLocalProfileId(
				undefined,
				"stale-handler-id",
				VALID_IDS,
			),
		).toBeNull();
	});

	it("preserves an explicit null per-record ID as null", () => {
		expect(
			resolveDedicatedRecordLocalProfileId(null, "default", VALID_IDS),
		).toBeNull();
	});

	it("preserves a per-record ID that is in the valid set", () => {
		expect(
			resolveDedicatedRecordLocalProfileId("secondary", "default", VALID_IDS),
		).toBe("secondary");
	});

	it("falls back to the handler fallback for a per-record ID absent from the valid set", () => {
		expect(
			resolveDedicatedRecordLocalProfileId("stale-uuid", "default", VALID_IDS),
		).toBe("default");
	});

	it("falls back to null when the per-record ID is invalid and the handler fallback is null", () => {
		expect(
			resolveDedicatedRecordLocalProfileId("stale-uuid", null, VALID_IDS),
		).toBeNull();
	});

	it("preserves the historical behavior when the valid set is null", () => {
		expect(
			resolveDedicatedRecordLocalProfileId("any-id", "default", null),
		).toBe("any-id");
	});
});

describe("Issue #532: personal_records session_id partition", () => {
	const VALID_SESSION_IDS = new Set(["session-1", "session-2"]);

	function prRowWithSession(
		exerciseName: string,
		sessionId: string | null,
	): ReturnType<typeof basePersonalRecordRow> {
		return { ...basePersonalRecordRow(exerciseName), session_id: sessionId };
	}

	it("preserves rows whose session_id is in the valid set", () => {
		const validRow = prRowWithSession("Squat", "session-1");
		const anotherValidRow = prRowWithSession("Bench Press", "session-2");

		const partition = partitionPersonalRecordRowsBySessionValidity(
			[validRow, anotherValidRow],
			VALID_SESSION_IDS,
		);

		expect(partition.validRows).toEqual([validRow, anotherValidRow]);
		expect(partition.invalidSessionRows).toEqual([]);
		expect(partition.rowsWithInvalidSessionsNulled).toEqual([
			validRow,
			anotherValidRow,
		]);
	});

	it("preserves rows whose session_id is null", () => {
		const unscopedRow = prRowWithSession("Deadlift", null);

		const partition = partitionPersonalRecordRowsBySessionValidity(
			[unscopedRow],
			VALID_SESSION_IDS,
		);

		expect(partition.validRows).toEqual([unscopedRow]);
		expect(partition.invalidSessionRows).toEqual([]);
		expect(partition.rowsWithInvalidSessionsNulled).toEqual([unscopedRow]);
	});

	it("places a stale session_id row in invalidSessionRows and returns it with session_id: null", () => {
		const validRow = prRowWithSession("Squat", "session-1");
		const staleRow = prRowWithSession("Bench Press", "stale-session-uuid");

		const partition = partitionPersonalRecordRowsBySessionValidity(
			[validRow, staleRow],
			VALID_SESSION_IDS,
		);

		expect(partition.validRows).toEqual([validRow]);
		expect(partition.invalidSessionRows).toEqual([staleRow]);
		expect(partition.rowsWithInvalidSessionsNulled).toEqual([
			validRow,
			{ ...staleRow, session_id: null },
		]);
	});

	it("handles multiple stale session_id references in a single partition call", () => {
		const validRow = prRowWithSession("Squat", "session-1");
		const staleA = prRowWithSession("Bench Press", "stale-A");
		const staleB = prRowWithSession("Deadlift", "stale-B");
		const staleC = prRowWithSession("Overhead Press", "stale-C");

		const partition = partitionPersonalRecordRowsBySessionValidity(
			[validRow, staleA, staleB, staleC],
			VALID_SESSION_IDS,
		);

		expect(partition.validRows).toEqual([validRow]);
		expect(partition.invalidSessionRows).toEqual([staleA, staleB, staleC]);
		expect(partition.rowsWithInvalidSessionsNulled).toEqual([
			validRow,
			{ ...staleA, session_id: null },
			{ ...staleB, session_id: null },
			{ ...staleC, session_id: null },
		]);
	});
});

describe("personal_records exercise_id catalog partition", () => {
	const VALID_EXERCISE_IDS = new Set(["catalog-bench", "custom-curl"]);

	function prRowWithExercise(
		exerciseName: string,
		exerciseId: string | null,
	): ReturnType<typeof basePersonalRecordRow> {
		return { ...basePersonalRecordRow(exerciseName), exercise_id: exerciseId };
	}

	it("preserves rows whose exercise_id is in the catalog valid set", () => {
		const validRow = prRowWithExercise("Bench Press", "catalog-bench");
		const customRow = prRowWithExercise("Cable Curl", "custom-curl");

		const partition = partitionPersonalRecordRowsByExerciseCatalogValidity(
			[validRow, customRow],
			VALID_EXERCISE_IDS,
		);

		expect(partition.validRows).toEqual([validRow, customRow]);
		expect(partition.invalidExerciseRows).toEqual([]);
		expect(partition.rowsWithInvalidExercisesNulled).toEqual([
			validRow,
			customRow,
		]);
	});

	it("preserves rows whose exercise_id is null", () => {
		const nameOnlyRow = prRowWithExercise("Legacy Bench Press", null);

		const partition = partitionPersonalRecordRowsByExerciseCatalogValidity(
			[nameOnlyRow],
			VALID_EXERCISE_IDS,
		);

		expect(partition.validRows).toEqual([nameOnlyRow]);
		expect(partition.invalidExerciseRows).toEqual([]);
		expect(partition.rowsWithInvalidExercisesNulled).toEqual([nameOnlyRow]);
	});

	it("nulls stale exercise_id values while preserving exercise_name", () => {
		const validRow = prRowWithExercise("Bench Press", "catalog-bench");
		const staleRow = prRowWithExercise("Deleted Custom Curl", "deleted-custom");

		const partition = partitionPersonalRecordRowsByExerciseCatalogValidity(
			[validRow, staleRow],
			VALID_EXERCISE_IDS,
		);

		expect(partition.validRows).toEqual([validRow]);
		expect(partition.invalidExerciseRows).toEqual([staleRow]);
		expect(partition.rowsWithInvalidExercisesNulled).toEqual([
			validRow,
			{ ...staleRow, exercise_id: null },
		]);
	});
});

describe("personal_records catalog display-name hydration", () => {
	const catalogRows = [
		{
			id: "1vS7ZNfrz2qF6KId",
			name: "Bayesian Curl",
			display_name: "Bayesian Curl (Handles)",
		},
	];
	function rowWithExercise(exerciseName: string, exerciseId: string | null) {
		return { ...basePersonalRecordRow(exerciseName), exercise_id: exerciseId };
	}

	it("replaces leaked catalog IDs in exercise_name when exercise_id is valid", () => {
		const row = rowWithExercise("1vS7ZNfrz2qF6KId", "1vS7ZNfrz2qF6KId");

		const hydrated = hydratePersonalRecordExerciseNamesFromCatalog(
			[row],
			catalogRows,
		);

		expect(hydrated[0]).toMatchObject({
			exercise_name: "Bayesian Curl (Handles)",
			exercise_id: "1vS7ZNfrz2qF6KId",
		});
	});

	it("recovers exercise_id when the catalog ID landed only in exercise_name", () => {
		const row = rowWithExercise("1vS7ZNfrz2qF6KId", null);

		const hydrated = hydratePersonalRecordExerciseNamesFromCatalog(
			[row],
			catalogRows,
		);

		expect(hydrated[0]).toMatchObject({
			exercise_name: "Bayesian Curl (Handles)",
			exercise_id: "1vS7ZNfrz2qF6KId",
		});
	});

	it("preserves explicit exercise names even when a catalog row is available", () => {
		const row = rowWithExercise("Bayesian Curl", "1vS7ZNfrz2qF6KId");

		const hydrated = hydratePersonalRecordExerciseNamesFromCatalog(
			[row],
			catalogRows,
		);

		expect(hydrated[0]).toMatchObject({
			exercise_name: "Bayesian Curl",
			exercise_id: "1vS7ZNfrz2qF6KId",
		});
	});
});

describe("personal_records session exercise display-name hydration", () => {
	function rowWithExercise(
		exerciseName: string,
		exerciseId: string | null,
		sessionId = "33333333-3333-4333-8333-333333333333",
	) {
		return {
			...basePersonalRecordRow(exerciseName),
			exercise_id: exerciseId,
			session_id: sessionId,
		};
	}

	it("replaces leaked session exercise row IDs in exercise_name", () => {
		const row = rowWithExercise("77f8d4e5-d97c-43ac-b4fc-d5ff35f67f8d", null);

		const hydrated = hydratePersonalRecordExerciseNamesFromSessionExercises(
			[row],
			[
				{
					id: "77f8d4e5-d97c-43ac-b4fc-d5ff35f67f8d",
					session_id: "33333333-3333-4333-8333-333333333333",
					name: "Cable Curl",
					exercise_id: "catalog-cable-curl",
				},
			],
		);

		expect(hydrated[0]).toMatchObject({
			exercise_name: "Cable Curl",
			exercise_id: "catalog-cable-curl",
		});
	});

	it("preserves explicit exercise names for matching session exercises", () => {
		const row = rowWithExercise("Cable Curl", "catalog-cable-curl");

		const hydrated = hydratePersonalRecordExerciseNamesFromSessionExercises(
			[row],
			[
				{
					id: "77f8d4e5-d97c-43ac-b4fc-d5ff35f67f8d",
					session_id: "33333333-3333-4333-8333-333333333333",
					name: "Cable Curl",
					exercise_id: "catalog-cable-curl",
				},
			],
		);

		expect(hydrated[0]).toMatchObject({
			exercise_name: "Cable Curl",
			exercise_id: "catalog-cable-curl",
		});
	});
});
