import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------
// Every method returns `self` for chaining; the terminal value is returned
// from the last method that gets called in each production query chain.
// This follows the pattern established in community.test.ts.

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = [
		"select",
		"eq",
		"order",
		"limit",
		"gte",
		"in",
		"single",
		"range",
		"maybeSingle",
	];
	for (const m of methods) {
		self[m] = vi.fn().mockReturnValue(self);
	}
	// Terminal methods that end a chain: limit, single, range, order
	// We make ALL of them resolve to terminal so whichever is last works.
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

// --- Tests ----------------------------------------------------------------

describe("workoutListOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the correct query key from keys.ts", async () => {
		chain = buildChain({ data: [], error: null });
		const { workoutListOptions } = await import("../workouts");
		const opts = workoutListOptions("user-abc");
		expect(opts.queryKey).toEqual(queryKeys.workouts.list("user-abc"));
	});

	it("returns Zod-transformed data (weights doubled, dates as Date, duration as minutes)", async () => {
		const raw = [
			{
				id: "11111111-1111-4111-8111-111111111111",
				user_id: "22222222-2222-4222-8222-222222222222",
				name: "Morning Push",
				started_at: "2026-03-01T08:00:00Z",
				duration_seconds: 3600,
				total_volume: 500,
				set_count: 12,
				exercise_count: 4,
				pr_count: 2,
				routine_name: null,
				workout_mode: "ECHO",
				notes: null,
			},
		];
		chain = buildChain({ data: raw, error: null });
		const { workoutListOptions } = await import("../workouts");
		const opts = workoutListOptions("user-abc");
		const result = await opts.queryFn?.({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].total_volume).toBe(1000); // doubled
		expect(result[0].duration_seconds).toBe(60); // minutes
		expect(result[0].started_at).toBeInstanceOf(Date);
		expect(result[0].workout_mode).toBe("Echo");
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "DB error", code: "42P01" },
		});
		const { workoutListOptions } = await import("../workouts");
		const opts = workoutListOptions("user-abc");
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "DB error" }),
		);
	});

	it("returns empty array when no workouts exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { workoutListOptions } = await import("../workouts");
		const opts = workoutListOptions("user-abc");
		const result = await opts.queryFn?.({} as never);
		expect(result).toEqual([]);
	});

	it("transforms null name to 'Untitled Workout'", async () => {
		const raw = [
			{
				id: "11111111-1111-4111-8111-111111111111",
				user_id: "22222222-2222-4222-8222-222222222222",
				name: null,
				started_at: "2026-03-01T08:00:00Z",
				duration_seconds: 1800,
				total_volume: 300,
				set_count: 6,
				exercise_count: 2,
				pr_count: 0,
				routine_name: null,
				workout_mode: null,
				notes: null,
			},
		];
		chain = buildChain({ data: raw, error: null });
		const { workoutListOptions } = await import("../workouts");
		const opts = workoutListOptions("user-abc");
		const result = await opts.queryFn?.({} as never);
		expect(result[0].name).toBe("Untitled Workout");
	});
});

describe("sessionDetailOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the correct query key from keys.ts", async () => {
		const { sessionDetailOptions } = await import("../workouts");
		const opts = sessionDetailOptions("sess-1");
		expect(opts.queryKey).toEqual(queryKeys.workouts.detail("sess-1"));
	});

	it("assembles session + exercises + sets into nested structure", async () => {
		const sessionRow = {
			id: "11111111-1111-4111-8111-111111111111",
			user_id: "22222222-2222-4222-8222-222222222222",
			name: "Leg Day",
			started_at: "2026-03-10T09:00:00Z",
			duration_seconds: 2400,
			total_volume: 800,
			set_count: 6,
			exercise_count: 2,
			pr_count: 1,
			routine_name: null,
			workout_mode: null,
			notes: null,
		};
		const exerciseRows = [
			{
				id: "aaaa1111-1111-4111-8111-111111111111",
				session_id: "11111111-1111-4111-8111-111111111111",
				name: "Squat",
				muscle_group: "Legs",
				order_index: 0,
			},
		];
		const setRows = [
			{
				id: "bbbb1111-1111-4111-8111-111111111111",
				exercise_id: "aaaa1111-1111-4111-8111-111111111111",
				set_number: 1,
				target_reps: 8,
				actual_reps: 8,
				weight_kg: 60,
				rpe: 7,
				is_pr: true,
				notes: null,
			},
		];

		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return buildChain({ data: sessionRow, error: null });
			if (callCount === 2)
				return buildChain({ data: exerciseRows, error: null });
			return buildChain({ data: setRows, error: null });
		});

		const { sessionDetailOptions } = await import("../workouts");
		const opts = sessionDetailOptions("11111111-1111-4111-8111-111111111111");
		const result = await opts.queryFn?.({} as never);

		expect(result.name).toBe("Leg Day");
		expect(result.exercises).toHaveLength(1);
		expect(result.exercises[0].name).toBe("Squat");
		expect(result.exercises[0].sets).toHaveLength(1);
		expect(result.exercises[0].hasPR).toBe(true);
		// weight_kg doubled by Zod transform
		expect(result.exercises[0].sets[0].weight_kg).toBe(120);
	});

	it("has enabled: false when sessionId is empty", async () => {
		const { sessionDetailOptions } = await import("../workouts");
		const opts = sessionDetailOptions("");
		expect(opts.enabled).toBe(false);
	});
});

describe("dashboardStatsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses a query key under workouts.all", async () => {
		chain = buildChain({ data: [], error: null });
		const { dashboardStatsOptions } = await import("../workouts");
		const opts = dashboardStatsOptions("user-1");
		expect(opts.queryKey[0]).toBe("workouts");
		expect(opts.queryKey).toContain("dashboard-stats");
	});

	it("returns raw data without Zod transformation", async () => {
		const raw = [
			{
				started_at: "2026-03-17T08:00:00Z",
				total_volume: 400,
				duration_seconds: 1800,
				pr_count: 0,
			},
		];
		chain = buildChain({ data: raw, error: null });
		const { dashboardStatsOptions } = await import("../workouts");
		const opts = dashboardStatsOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		// Raw data returned as-is (no doubling)
		expect(result[0].total_volume).toBe(400);
	});
});

describe("workoutListPageOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("includes offset in query key for pagination", async () => {
		chain = buildChain({ data: [], error: null });
		const { workoutListPageOptions } = await import("../workouts");
		const opts = workoutListPageOptions("user-1", 50);
		expect(opts.queryKey).toContain("page");
		expect(opts.queryKey).toContain(50);
	});
});

describe("recentPRsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses records.all key with recent prefix", async () => {
		chain = buildChain({ data: [], error: null });
		const { recentPRsOptions } = await import("../workouts");
		const opts = recentPRsOptions("user-1");
		expect(opts.queryKey[0]).toBe("records");
		expect(opts.queryKey).toContain("recent");
	});

	it("returns Zod-transformed PRs with doubled values", async () => {
		const raw = [
			{
				id: "11111111-1111-4111-8111-111111111111",
				user_id: "22222222-2222-4222-8222-222222222222",
				exercise_name: "Squat",
				muscle_group: "Legs",
				record_type: "1RM",
				value: 100,
				unit: "kg",
				achieved_at: "2026-03-15T10:00:00Z",
				previous_value: 90,
			},
		];
		chain = buildChain({ data: raw, error: null });
		const { recentPRsOptions } = await import("../workouts");
		const opts = recentPRsOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result[0].value).toBe(200); // doubled
		expect(result[0].previous_value).toBe(180); // doubled
		expect(result[0].achieved_at).toBeInstanceOf(Date);
	});
});
