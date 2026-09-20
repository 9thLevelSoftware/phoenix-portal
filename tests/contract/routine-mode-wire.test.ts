/**
 * Contract: every training mode the portal routine builder can save reaches
 * mobile as a mode name mobile understands.
 *
 * Chain under test:
 *   builder option value -> toRoutineExerciseRows (portal writer)
 *   -> routine_exercises.mode -> mobile-sync-pull routine exercise DTO `mode`
 *   -> mobile ProgramMode.fromSyncString
 *
 * The rendered <option value> attributes are asserted in
 * src/app/components/__tests__/RoutineBuilder.test.tsx ("offers every training
 * mode with a wire-name value and display label"), which renders the builder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { toRoutineExerciseRows } from "@/mutations/routines";
import { routineExerciseSchema } from "@/schemas/transforms";
import {
	toWireMode,
	WIRE_MODE_LABELS,
	WIRE_MODES,
	workoutModeLabel,
} from "../../supabase/functions/_shared/workoutModes.ts";

// Mobile `ProgramMode.fromSyncString` (Project-Phoenix-MP
// shared/src/commonMain/kotlin/com/devil/phoenixproject/domain/model/Models.kt:236-244).
// Anything else parses to null and trains as Old School.
const MOBILE_SYNC_MODES = [
	"OLD_SCHOOL",
	"CLASSIC",
	"PUMP",
	"TUT",
	"TUT_BEAST",
	"ECCENTRIC_ONLY",
	"ECHO",
];

const PULL_SOURCE = readFileSync(
	join(process.cwd(), "supabase/functions/mobile-sync-pull/index.ts"),
	"utf8",
);

// Mirror of the routine exercise DTO's mode field in mobile-sync-pull
// (`mode: re.mode`, a raw passthrough). The guard test below fails if the
// pull mapping changes, so this mirror cannot silently drift.
function pullRoutineExerciseDtoMode(row: { mode: unknown }): unknown {
	return row.mode;
}

function builderExercise(mode: string) {
	return {
		name: "Triceps Pushdown",
		muscle_group: "ARMS",
		sets: 3,
		reps: 10,
		weight: 20,
		rest_seconds: 90,
		mode,
		order_index: 0,
	};
}

describe("routine mode wire contract", () => {
	it("pull still emits routine exercise mode verbatim", () => {
		expect(PULL_SOURCE).toMatch(/^\s*mode: re\.mode,$/m);
	});

	it("every wire mode is accepted by mobile", () => {
		for (const wire of WIRE_MODES) {
			expect(MOBILE_SYNC_MODES).toContain(wire);
		}
	});

	it.each(
		WIRE_MODES,
	)("builder option %s survives save and pull as a wire name", (wire) => {
		const [row] = toRoutineExerciseRows("routine-1", [builderExercise(wire)]);
		const pulled = pullRoutineExerciseDtoMode(row);

		expect(pulled).toBe(wire);
		expect(WIRE_MODES as readonly unknown[]).toContain(pulled);
		expect(MOBILE_SYNC_MODES).toContain(pulled);
	});

	it.each([
		["Old School", "OLD_SCHOOL"],
		["Pump", "PUMP"],
		["TUT", "TUT"],
		["TUT Beast", "TUT_BEAST"],
		["Eccentric Only", "ECCENTRIC_ONLY"],
		["Echo", "ECHO"],
		["echo", "ECHO"],
		["CLASSIC", "OLD_SCHOOL"],
		["Power", "OLD_SCHOOL"],
	])("writer normalizes legacy value %s to %s", (legacy, wire) => {
		const [row] = toRoutineExerciseRows("routine-1", [builderExercise(legacy)]);
		expect(row.mode).toBe(wire);
	});

	it("writer rejects modes mobile cannot parse", () => {
		expect(() =>
			toRoutineExerciseRows("routine-1", [builderExercise("eccentric")]),
		).toThrow(/Unknown workout mode/);
		expect(toWireMode("NEW_FANCY_MODE")).toBeNull();
	});

	it("read schema normalizes stored values to wire names", () => {
		const base = {
			id: "33333333-3333-4333-8333-333333333333",
			routine_id: "11111111-1111-4111-8111-111111111111",
			name: "Triceps Pushdown",
			muscle_group: "ARMS",
			sets: 3,
			reps: 10,
			weight: 10,
			rest_seconds: 90,
			order_index: 0,
			created_at: "2026-09-01T00:00:00.000Z",
		};
		expect(routineExerciseSchema.parse({ ...base, mode: "ECHO" }).mode).toBe(
			"ECHO",
		);
		expect(routineExerciseSchema.parse({ ...base, mode: "Echo" }).mode).toBe(
			"ECHO",
		);
		// Unknown values pass through rather than failing the whole routine.
		expect(routineExerciseSchema.parse({ ...base, mode: "MYSTERY" }).mode).toBe(
			"MYSTERY",
		);
	});

	it("stored wire modes render with their display labels", () => {
		for (const wire of WIRE_MODES) {
			expect(workoutModeLabel(wire)).toBe(WIRE_MODE_LABELS[wire]);
		}
		expect(workoutModeLabel("ECHO")).toBe("Echo");
	});
});
