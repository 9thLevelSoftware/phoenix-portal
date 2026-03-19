import { describe, expect, it, vi, beforeEach } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "order", "single"];
	for (const m of methods) {
		self[m] = vi.fn();
	}
	for (const m of methods) {
		self[m].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

// --- Test data ------------------------------------------------------------

const routineRow = {
	id: "11111111-1111-4111-8111-111111111111",
	user_id: "22222222-2222-4222-8222-222222222222",
	name: "Push Day",
	description: "Chest, shoulders, triceps",
	exercise_count: 5,
	estimated_duration: 45,
	times_completed: 12,
	last_used_at: "2026-03-15T10:00:00Z",
	tags: ["Chest", "Shoulders"],
	is_favorite: true,
};

const routineExerciseRow = {
	id: "aaaa1111-1111-4111-8111-111111111111",
	routine_id: "11111111-1111-4111-8111-111111111111",
	name: "Bench Press",
	muscle_group: "Chest",
	sets: 4,
	reps: 8,
	weight: 60,
	rest_seconds: 90,
	duration_seconds: null,
	mode: "OLD_SCHOOL",
	order_index: 0,
	superset_id: null,
	superset_color: null,
	superset_order: null,
	per_set_weights: null,
	per_set_rest: null,
	is_amrap: false,
	is_bodyweight: false,
	pr_percentage: null,
	rep_count_timing: null,
	stop_at_position: null,
	stall_detection: false,
	eccentric_load: null,
	echo_level: null,
	created_at: "2026-01-01T00:00:00Z",
};

// --- Tests ----------------------------------------------------------------

describe("routineListOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses routines.byUser query key", async () => {
		chain = buildChain({ data: [], error: null });
		const { routineListOptions } = await import("../routines");
		const opts = routineListOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.routines.byUser("user-1"));
	});

	it("returns Zod-transformed routine list with Date conversion", async () => {
		chain = buildChain({ data: [routineRow], error: null });
		const { routineListOptions } = await import("../routines");
		const opts = routineListOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Push Day");
		expect(result[0].last_used_at).toBeInstanceOf(Date);
		expect(result[0].is_favorite).toBe(true);
		expect(result[0].tags).toEqual(["Chest", "Shoulders"]);
	});

	it("handles null last_used_at correctly", async () => {
		chain = buildChain({
			data: [{ ...routineRow, last_used_at: null }],
			error: null,
		});
		const { routineListOptions } = await import("../routines");
		const opts = routineListOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result[0].last_used_at).toBeNull();
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "fetch failed" },
		});
		const { routineListOptions } = await import("../routines");
		const opts = routineListOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "fetch failed" }),
		);
	});

	it("returns empty array when no routines exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { routineListOptions } = await import("../routines");
		const opts = routineListOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});
});

describe("routineDetailOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses routines.detail query key", async () => {
		const { routineDetailOptions } = await import("../routines");
		const opts = routineDetailOptions("routine-1");
		expect(opts.queryKey).toEqual(queryKeys.routines.detail("routine-1"));
	});

	it("returns routine with nested exercises", async () => {
		const detailRow = {
			...routineRow,
			routine_exercises: [routineExerciseRow],
		};
		chain = buildChain({ data: detailRow, error: null });
		const { routineDetailOptions } = await import("../routines");
		const opts = routineDetailOptions(
			"11111111-1111-4111-8111-111111111111",
		);
		const result = await opts.queryFn!({} as never);

		expect(result.name).toBe("Push Day");
		expect(result.routine_exercises).toHaveLength(1);
		expect(result.routine_exercises[0].name).toBe("Bench Press");
		expect(result.routine_exercises[0].created_at).toBeInstanceOf(Date);
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "not found" },
		});
		const { routineDetailOptions } = await import("../routines");
		const opts = routineDetailOptions("missing");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "not found" }),
		);
	});
});
