import { beforeEach, describe, expect, it, vi } from "vitest";

const paging = vi.hoisted(() => ({
	/** When set, `workout_sessions` returns exactly one full PostgREST page. */
	fullSessionPage: false,
	/** When set, `sets` returns exactly one full page for the first range. */
	fullSetPage: false,
	ranges: [] as Array<{ table: string; from: number; to: number }>,
	error: null as { message: string } | null,
}));

const mockTables = vi.hoisted(() => ({
	sessions: [
		{
			id: "session-1",
			name: "=Workout",
			started_at: "2026-05-17T12:00:00Z",
			duration_seconds: 3600,
			notes: "@Workout notes",
		},
	],
	exercises: [
		{
			id: "exercise-1",
			session_id: "session-1",
			name: "+Exercise",
			order_index: 1,
			cable_count: 2 as number | null,
		},
	],
	sets: [
		{
			exercise_id: "exercise-1",
			set_number: 1,
			actual_reps: 5,
			weight_kg: 10,
			rpe: null,
			notes: "-Set notes",
		},
	],
}));

function rowsFor(table: string): unknown[] {
	if (paging.fullSessionPage && table === "workout_sessions") {
		return Array.from({ length: 1000 }, (_, index) => ({
			id: `session-${index}`,
			name: "Workout",
			started_at: "2026-05-17T12:00:00Z",
			duration_seconds: 60,
			notes: null,
		}));
	}
	if (paging.fullSessionPage) return [];
	if (table === "workout_sessions") return mockTables.sessions;
	if (table === "exercises") return mockTables.exercises;
	if (table === "sets") {
		if (!paging.fullSetPage) return mockTables.sets;
		return Array.from({ length: 1000 }, (_, index) => ({
			exercise_id: "exercise-1",
			set_number: index + 1,
			actual_reps: 5,
			weight_kg: 10,
			rpe: null,
			notes: null,
		}));
	}
	return [];
}

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table: string) => {
			const builder = {
				select: () => builder,
				eq: () => builder,
				in: () => builder,
				order: () => builder,
				range: async (from: number, to: number) => {
					paging.ranges.push({ table, from, to });
					if (paging.error) return { data: null, error: paging.error };
					const rows = rowsFor(table);
					return { data: rows.slice(from, to + 1), error: null };
				},
			};
			return builder;
		},
	},
}));

describe("Strong-compatible CSV export", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		paging.fullSessionPage = false;
		paging.fullSetPage = false;
		paging.ranges = [];
		paging.error = null;
		mockTables.exercises[0].cable_count = 2;
	});

	it("escapes formulas in manually generated string fields", async () => {
		const { exportWorkoutsAsCSV } = await import("./export-csv");

		const result = await exportWorkoutsAsCSV(
			"00000000-0000-4000-8000-000000000999",
		);

		expect(result.csv).toContain(",'=Workout,");
		expect(result.csv).toContain(",'+Exercise,");
		expect(result.csv).toContain(",'-Set notes,");
		expect(result.csv).toContain(",'@Workout notes");
	});

	it("exports Weight per cable plus weight_per_cable_kg and weight_total_kg", async () => {
		const { exportWorkoutsAsCSV } = await import("./export-csv");
		mockTables.exercises[0].cable_count = 2;

		const result = await exportWorkoutsAsCSV(
			"00000000-0000-4000-8000-000000000999",
		);
		const [header, row] = result.csv.split("\n");
		const cols = header.split(",");
		const values = row.split(",");
		const at = (name: string) => values[cols.indexOf(name)];

		expect(cols.slice(-2)).toEqual(["weight_per_cable_kg", "weight_total_kg"]);
		expect(at("Weight")).toBe("10");
		expect(at("weight_per_cable_kg")).toBe("10");
		expect(at("weight_total_kg")).toBe("20");
	});

	it("leaves weight_total_kg blank when the cable count is unknown", async () => {
		const { exportWorkoutsAsCSV } = await import("./export-csv");
		mockTables.exercises[0].cable_count = null;

		const result = await exportWorkoutsAsCSV(
			"00000000-0000-4000-8000-000000000999",
		);
		const [header, row] = result.csv.split("\n");
		const cols = header.split(",");
		const values = row.split(",");

		expect(values[cols.indexOf("Weight")]).toBe("10");
		expect(values[cols.indexOf("weight_total_kg")]).toBe("");
	});

	it("pages sessions, exercises, and sets through a short first page", async () => {
		const { exportWorkoutsAsCSV } = await import("./export-csv");

		const result = await exportWorkoutsAsCSV(
			"00000000-0000-4000-8000-000000000999",
		);

		expect(result.sessionCount).toBe(1);
		expect(result.setCount).toBe(1);
		expect(paging.ranges).toEqual([
			{ table: "workout_sessions", from: 0, to: 999 },
			{ table: "exercises", from: 0, to: 999 },
			{ table: "sets", from: 0, to: 999 },
		]);
	});

	it("keeps reading after a full session page and chunks exercise ids", async () => {
		const { exportWorkoutsAsCSV } = await import("./export-csv");
		paging.fullSessionPage = true;

		const result = await exportWorkoutsAsCSV(
			"00000000-0000-4000-8000-000000000999",
		);

		expect(result.sessionCount).toBe(1000);
		expect(result.setCount).toBe(0);
		expect(
			paging.ranges.filter((call) => call.table === "workout_sessions"),
		).toEqual([
			{ table: "workout_sessions", from: 0, to: 999 },
			{ table: "workout_sessions", from: 1000, to: 1999 },
		]);
		// 1,000 session ids / default filter chunk of 100.
		expect(
			paging.ranges.filter((call) => call.table === "exercises"),
		).toHaveLength(10);
		expect(paging.ranges.some((call) => call.table === "sets")).toBe(false);
	});

	it("pages sets inside an exercise-id chunk after a full page", async () => {
		const { exportWorkoutsAsCSV } = await import("./export-csv");
		paging.fullSetPage = true;

		const result = await exportWorkoutsAsCSV(
			"00000000-0000-4000-8000-000000000999",
		);

		expect(result.setCount).toBe(1000);
		expect(paging.ranges.filter((call) => call.table === "sets")).toEqual([
			{ table: "sets", from: 0, to: 999 },
			{ table: "sets", from: 1000, to: 1999 },
		]);
	});

	it("throws when a paged workout read fails", async () => {
		const { exportWorkoutsAsCSV } = await import("./export-csv");
		paging.error = { message: "range failed" };

		await expect(
			exportWorkoutsAsCSV("00000000-0000-4000-8000-000000000999"),
		).rejects.toEqual({ message: "range failed" });
	});
});
