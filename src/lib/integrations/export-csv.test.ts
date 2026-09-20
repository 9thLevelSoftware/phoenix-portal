import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table: string) => ({
			select: () => ({
				eq: () => ({
					order: async () => ({
						data: table === "workout_sessions" ? mockTables.sessions : [],
						error: null,
					}),
				}),
				in: () => ({
					order: async () => ({
						data:
							table === "exercises"
								? mockTables.exercises
								: table === "sets"
									? mockTables.sets
									: [],
						error: null,
					}),
				}),
			}),
		}),
	},
}));

describe("Strong-compatible CSV export", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});
