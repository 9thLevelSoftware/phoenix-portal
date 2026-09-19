/**
 * Contract: routine-exercise advanced settings saved by the portal reach
 * mobile as values its pull parsers understand, and legacy portal values are
 * read as the default the phone actually used.
 *
 * Chain: builder option -> toRoutineExerciseRows -> routine_exercises
 *   -> mobile-sync-pull DTO (raw passthrough, guarded below) -> mobile parsers.
 * The mobile parsers are ported verbatim from Project-Phoenix-MP.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { toRoutineExerciseRows } from "@/mutations/routines";
import { routineExerciseSchema } from "@/schemas/transforms";
import {
	ECCENTRIC_LOADS,
	ECHO_LEVELS,
	REP_COUNT_TIMINGS,
	SUPERSET_COLOR_HEX,
	SUPERSET_COLOR_NAMES,
	supersetColorHex,
} from "../../supabase/functions/_shared/workoutModes.ts";

// PortalPullAdapter.kt:396-403
function mobileParseEccentricLoad(value: string | null): number {
	if (value == null) return 100;
	const numeric = Number.parseInt(value.replace(/^LOAD_/, ""), 10);
	return Number.isNaN(numeric) ? 100 : numeric;
}
// PortalPullAdapter.kt:409-415 (returns the EchoLevel ordinal)
function mobileParseEchoLevel(value: string | null): number {
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
// SqlDelightSyncRepository.kt:2236-2248 (null = falls back to order index)
function mobileSupersetColorIndex(value: string | null): number | null {
	const index = ["indigo", "pink", "green", "amber"].indexOf(
		value?.toLowerCase() ?? "",
	);
	return index === -1 ? null : index;
}

const PULL_SOURCE = readFileSync(
	join(process.cwd(), "supabase/functions/mobile-sync-pull/index.ts"),
	"utf8",
);

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
	it("pull still passes the settings through verbatim", () => {
		for (const line of [
			"supersetColor: re.superset_color,",
			"repCountTiming: re.rep_count_timing,",
			"stopAtPosition: re.stop_at_position,",
			"eccentricLoad: re.eccentric_load,",
			"echoLevel: re.echo_level,",
			"durationSeconds: re.duration_seconds ?? null,",
		]) {
			expect(PULL_SOURCE).toContain(line);
		}
	});

	it.each(
		ECCENTRIC_LOADS,
	)("eccentric %s reaches mobile as its percentage", (load) => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({ eccentric_load: load }),
		]);
		expect(row.eccentric_load).toBe(load);
		expect(mobileParseEccentricLoad(row.eccentric_load ?? null)).toBe(
			Number(load.replace("LOAD_", "")),
		);
	});

	it.each(ECHO_LEVELS)("echo level %s reaches mobile as itself", (level) => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({ echo_level: level }),
		]);
		expect(mobileParseEchoLevel(row.echo_level ?? null)).toBe(
			ECHO_LEVELS.indexOf(level),
		);
	});

	it.each(REP_COUNT_TIMINGS)("rep count timing %s reaches mobile", (timing) => {
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
	)("superset colour %s reaches mobile as index %i", (name, index) => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({ superset_color: name }),
		]);
		expect(mobileSupersetColorIndex(row.superset_color ?? null)).toBe(index);
		expect(supersetColorHex(name)).toBe(SUPERSET_COLOR_HEX[name]);
	});

	it("writer turns legacy portal values into what mobile already used", () => {
		const [row] = toRoutineExerciseRows("r", [
			builderExercise({
				eccentric_load: "heavy",
				echo_level: "low",
				rep_count_timing: "2-0-2",
				stop_at_position: "Lockout",
				superset_color: "#EC4899",
			}),
		]);
		expect(row).toMatchObject({
			eccentric_load: null,
			echo_level: null,
			rep_count_timing: null,
			stop_at_position: null,
			superset_color: "pink",
		});
		// Same machine behaviour before and after.
		expect(mobileParseEccentricLoad("heavy")).toBe(
			mobileParseEccentricLoad(null),
		);
		expect(mobileParseEchoLevel("low")).toBe(mobileParseEchoLevel(null));
		expect(mobileRepCountTiming("2-0-2")).toBe(mobileRepCountTiming(null));
		expect(mobileStopAtTop("Lockout")).toBe(mobileStopAtTop(null));
	});

	it("read schema normalizes legacy values and keeps mobile values", () => {
		const legacy = routineExerciseSchema.parse({
			...storedRow,
			eccentric_load: "moderate",
			echo_level: "medium",
			rep_count_timing: "slow",
			stop_at_position: "Lockout",
			superset_color: "#6366F1",
		});
		expect(legacy).toMatchObject({
			eccentric_load: null,
			echo_level: null,
			rep_count_timing: null,
			stop_at_position: null,
			superset_color: "indigo",
		});

		const mobile = routineExerciseSchema.parse({
			...storedRow,
			eccentric_load: "LOAD_110",
			echo_level: "EPIC",
			rep_count_timing: "BOTTOM",
			stop_at_position: "TOP",
			superset_color: "green",
		});
		expect(mobile).toMatchObject({
			eccentric_load: "LOAD_110",
			echo_level: "EPIC",
			rep_count_timing: "BOTTOM",
			stop_at_position: "TOP",
			superset_color: "green",
		});
	});
});
