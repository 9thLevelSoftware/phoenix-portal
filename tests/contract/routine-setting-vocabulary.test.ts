/**
 * Contract: routine-exercise advanced settings saved by the portal reach
 * mobile as values its parsers understand, and every stored value normalizes
 * to what the phone actually does with it.
 *
 * Chain: builder option -> toRoutineExerciseRows -> routine_exercises
 *   -> mobile-sync-pull DTO (raw passthrough; asserted behaviourally in
 *   supabase/functions/mobile-sync-pull/index.test.ts) -> mobile parsers,
 * which are ported below from Project-Phoenix-MP.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { toRoutineExerciseRows } from "@/mutations/routines";
import { routineExerciseSnapshotSchema } from "@/schemas/community";
import { routineExerciseSchema } from "@/schemas/transforms";
import {
	ECCENTRIC_LOADS,
	ECHO_LEVELS,
	normalizeEccentricLoad,
	REP_COUNT_TIMINGS,
	SUPERSET_COLOR_HEX,
	SUPERSET_COLOR_NAMES,
	supersetColorHex,
	toEccentricLoad,
	toEchoLevel,
	toRepCountTiming,
	toStopAtPosition,
	toSupersetColorName,
} from "../../supabase/functions/_shared/workoutModes.ts";

// ─── Mobile ports ───────────────────────────────────────────────────────────

// Kotlin String.toLongOrNull (ASCII digits).
function kotlinToLongOrNull(value: string): bigint | null {
	if (!/^[+-]?[0-9]+$/.test(value)) return null;
	const parsed = BigInt(value);
	return parsed < -(2n ** 63n) || parsed > 2n ** 63n - 1n ? null : parsed;
}
// PortalPullAdapter.kt:396-403 then SqlDelightWorkoutRepository.kt:449-482
// (toInt, coerceIn(0,150), exact or nearest enum, first on a tie).
function mobileEccentricPercent(value: string | null): number {
	if (value == null) return 100;
	const parsed =
		kotlinToLongOrNull(value.startsWith("LOAD_") ? value.slice(5) : value) ??
		kotlinToLongOrNull(value);
	if (parsed === null) return 100;
	const clamped = Math.min(150, Math.max(0, Number(BigInt.asIntN(32, parsed))));
	const percents = [0, 50, 75, 100, 110, 120, 130, 140, 150];
	return percents.reduce((best, p) =>
		Math.abs(p - clamped) < Math.abs(best - clamped) ? p : best,
	);
}
// PortalPullAdapter.kt:409-415 (EchoLevel ordinal)
function mobileEchoLevel(value: string | null): number {
	const index = ["HARD", "HARDER", "HARDEST", "EPIC"].indexOf(
		value?.toUpperCase() ?? "",
	);
	return index === -1 ? 1 : index;
}
// SqlDelightSyncRepository.kt:2346 + 1092-1098 (valueOf, fallback TOP)
function mobileRepCountTiming(value: string | null): string {
	return value === "TOP" || value === "BOTTOM" ? value : "TOP";
}
// SqlDelightSyncRepository.kt:2345
function mobileStopAtTop(value: string | null): boolean {
	return value === "TOP";
}
// SqlDelightSyncRepository.kt:2245-2248 (-1 = order-index fallback)
function mobileSupersetColorIndex(value: string | null): bigint {
	const lower = value?.toLowerCase() ?? null;
	const byName = ["indigo", "pink", "green", "amber"].indexOf(lower ?? "");
	if (byName !== -1) return BigInt(byName);
	return (lower === null ? null : kotlinToLongOrNull(lower)) ?? -1n;
}

// ─── Shared case table (mirrored in
// supabase/tests/database/routine_setting_vocabulary.test.sql) ─────────────

type Fn = "eccentric" | "echo" | "timing" | "stop" | "colour";
const SETTING_CASES: Array<[Fn, string | null, string | null]> = [
	["eccentric", null, null],
	["eccentric", "light", null],
	["eccentric", "moderate", null],
	["eccentric", "heavy", null],
	["eccentric", "", null],
	["eccentric", "LOAD_120", "LOAD_120"],
	["eccentric", "LOAD_0", "LOAD_0"],
	["eccentric", "120", "LOAD_120"],
	["eccentric", "LOAD_+120", "LOAD_120"],
	["eccentric", "LOAD_0120", "LOAD_120"],
	["eccentric", "4294967416", "LOAD_120"],
	["eccentric", "load_120", null],
	["eccentric", " LOAD_120", null],
	["eccentric", "LOAD_120 ", null],
	["eccentric", "LOAD_", null],
	["eccentric", "1.5", null],
	["eccentric", "120abc", null],
	["eccentric", "99999999999999999999", null],
	["eccentric", "LOAD_25", "LOAD_25"],
	["eccentric", "999", "999"],
	["eccentric", "-5", "-5"],
	["echo", null, null],
	["echo", "hard", "HARD"],
	["echo", "Epic", "EPIC"],
	["echo", "HARDER", "HARDER"],
	["echo", " hard", null],
	["echo", "low", null],
	["echo", "medium", null],
	["echo", "high", null],
	["echo", "", null],
	["echo", "MYTHIC", null],
	["timing", "TOP", "TOP"],
	["timing", "BOTTOM", "BOTTOM"],
	["timing", "top", null],
	["timing", " TOP", null],
	["timing", "2-0-2", null],
	["stop", "TOP", "TOP"],
	["stop", "BOTTOM", null],
	["stop", "top", null],
	["stop", "Lockout", null],
	["colour", null, null],
	["colour", "indigo", "indigo"],
	["colour", "Indigo", "indigo"],
	["colour", "AMBER", "amber"],
	["colour", " indigo", null],
	["colour", "#6366F1", "indigo"],
	["colour", "#EC4899", "pink"],
	["colour", "#10B981", "green"],
	["colour", "#f59e0b", "amber"],
	["colour", "#123456", null],
	["colour", "purple", null],
	["colour", "2", "green"],
	["colour", "+0", "indigo"],
	["colour", "7", "7"],
	["colour", "-1", "-1"],
];

const NORMALIZERS: Record<Fn, (value: unknown) => string | null> = {
	eccentric: normalizeEccentricLoad,
	echo: toEchoLevel,
	timing: toRepCountTiming,
	stop: toStopAtPosition,
	colour: toSupersetColorName,
};

// What the phone does with a stored value, per setting.
const MOBILE_BEHAVIOUR: Record<Fn, (value: string | null) => unknown> = {
	eccentric: mobileEccentricPercent,
	echo: mobileEchoLevel,
	timing: mobileRepCountTiming,
	stop: mobileStopAtTop,
	colour: mobileSupersetColorIndex,
};

function builderExercise(settings: Record<string, string | null>) {
	return {
		name: "Triceps Pushdown",
		muscle_group: "ARMS",
		sets: 3,
		reps: 10,
		weight: 20,
		rest_seconds: 90,
		mode: "ECHO",
		order_index: 0,
		...settings,
	};
}

const storedRow = {
	id: "33333333-3333-4333-8333-333333333333",
	routine_id: "11111111-1111-4111-8111-111111111111",
	name: "Triceps Pushdown",
	muscle_group: "ARMS",
	sets: 3,
	reps: 10,
	weight: 10,
	rest_seconds: 90,
	mode: "ECHO",
	order_index: 0,
	created_at: "2026-09-01T00:00:00.000Z",
};

describe("routine setting vocabulary contract", () => {
	it.each(SETTING_CASES)("%s(%j) normalizes to %j", (fn, input, expected) => {
		expect(NORMALIZERS[fn](input)).toBe(expected);
	});

	it.each(
		SETTING_CASES.filter(([fn]) => fn !== "colour"),
	)("%s(%j): the phone does the same with the stored and normalized value", (fn, input, expected) => {
		expect(MOBILE_BEHAVIOUR[fn](expected)).toEqual(MOBILE_BEHAVIOUR[fn](input));
	});

	it("colour normalization keeps the phone's colour except the deliberate legacy-hex remap", () => {
		for (const [fn, input, expected] of SETTING_CASES) {
			if (fn !== "colour" || input === null || input.startsWith("#")) continue;
			expect(mobileSupersetColorIndex(expected)).toBe(
				mobileSupersetColorIndex(input),
			);
		}
		expect(toSupersetColorName("#F59E0B")).toBe("amber");
	});

	it("non-strings normalize to null", () => {
		for (const normalize of Object.values(NORMALIZERS)) {
			expect(normalize(42)).toBeNull();
			expect(normalize(undefined)).toBeNull();
		}
	});

	it.each([
		["LOAD_25", "LOAD_0"],
		["105", "LOAD_100"],
		["999", "LOAD_150"],
		["-5", "LOAD_0"],
		["LOAD_130", "LOAD_130"],
		["load_130", null],
	])("eccentric %s trains as %s (display)", (input, trains) => {
		expect(toEccentricLoad(input)).toBe(trains);
		expect(mobileEccentricPercent(input)).toBe(
			trains === null ? 100 : Number(trains.slice(5)),
		);
	});

	it.each(
		ECCENTRIC_LOADS,
	)("eccentric option %s reaches mobile as its percentage", (load) => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({ eccentric_load: load }),
		]);
		expect(row.eccentric_load).toBe(load);
		expect(mobileEccentricPercent(row.eccentric_load ?? null)).toBe(
			Number(load.slice(5)),
		);
	});

	it.each(ECHO_LEVELS)("echo option %s reaches mobile as itself", (level) => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({ echo_level: level }),
		]);
		expect(mobileEchoLevel(row.echo_level ?? null)).toBe(
			ECHO_LEVELS.indexOf(level),
		);
	});

	it.each(REP_COUNT_TIMINGS)("timing option %s reaches mobile", (timing) => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({ rep_count_timing: timing }),
		]);
		expect(mobileRepCountTiming(row.rep_count_timing ?? null)).toBe(timing);
	});

	it("stop at TOP reaches mobile; unset does not stop", () => {
		const [top, none] = toRoutineExerciseRows("r", [
			builderExercise({ stop_at_position: "TOP" }),
			builderExercise({ stop_at_position: null }),
		]);
		expect(mobileStopAtTop(top.stop_at_position ?? null)).toBe(true);
		expect(mobileStopAtTop(none.stop_at_position ?? null)).toBe(false);
	});

	it.each(
		SUPERSET_COLOR_NAMES.map((name, index) => [name, index] as const),
	)("superset colour %s reaches mobile as index %i and renders its hex", (name, index) => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({ superset_color: name }),
		]);
		expect(mobileSupersetColorIndex(row.superset_color ?? null)).toBe(
			BigInt(index),
		);
		expect(supersetColorHex(name)).toBe(SUPERSET_COLOR_HEX[name]);
		expect(supersetColorHex(String(index))).toBe(SUPERSET_COLOR_HEX[name]);
	});

	it("writer stores legacy values as the phone's defaults and keeps off-list numbers", () => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({
				eccentric_load: "heavy",
				echo_level: "low",
				rep_count_timing: "2-0-2",
				stop_at_position: "Lockout",
				superset_color: "#EC4899",
			}),
			builderExercise({ eccentric_load: "LOAD_25" }),
		]);
		expect(row).toMatchObject({
			eccentric_load: null,
			echo_level: null,
			rep_count_timing: null,
			stop_at_position: null,
			superset_color: "pink",
		});
		const [, offList] = toRoutineExerciseRows("r", [
			builderExercise({}),
			builderExercise({ eccentric_load: "LOAD_25" }),
		]);
		expect(offList.eccentric_load).toBe("LOAD_25");
	});

	it("read schemas (routine and community snapshot) normalize the same way", () => {
		const legacy = {
			eccentric_load: "moderate",
			echo_level: "medium",
			rep_count_timing: "slow",
			stop_at_position: "BOTTOM",
			superset_color: "#6366F1",
		};
		const expected = {
			eccentric_load: null,
			echo_level: null,
			rep_count_timing: null,
			stop_at_position: null,
			superset_color: "indigo",
		};
		expect(
			routineExerciseSchema.parse({ ...storedRow, ...legacy }),
		).toMatchObject(expected);
		expect(
			routineExerciseSnapshotSchema.parse({ name: "X", ...legacy }),
		).toMatchObject(expected);

		const mobile = {
			eccentric_load: "LOAD_110",
			echo_level: "EPIC",
			rep_count_timing: "BOTTOM",
			stop_at_position: "TOP",
			superset_color: "green",
		};
		expect(
			routineExerciseSchema.parse({ ...storedRow, ...mobile }),
		).toMatchObject(mobile);
	});
});
