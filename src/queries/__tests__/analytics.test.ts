import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "order", "gte", "lt", "in", "limit"];
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

// --- Tests ----------------------------------------------------------------

describe("volumeTrendOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses analytics.summary query key with volume prefix", async () => {
		chain = buildChain({ data: [], error: null });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1", "4w");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "volume-4w"),
		);
	});

	it("defaults period to 4w", async () => {
		chain = buildChain({ data: [], error: null });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "volume-4w"),
		);
	});

	it("returns volume trend data points", async () => {
		const raw = [
			{ started_at: "2026-03-01T08:00:00Z", total_volume: 500 },
			{ started_at: "2026-03-03T08:00:00Z", total_volume: 600 },
		];
		chain = buildChain({ data: raw, error: null });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toHaveLength(2);
		expect(result[0].total_volume).toBe(500);
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "query failed" },
		});
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1");
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "query failed" }),
		);
	});

	it("returns empty array when no sessions exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toEqual([]);
	});
});

describe("muscleGroupOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses analytics.summary query key with muscle-groups", async () => {
		chain = buildChain({ data: [], error: null });
		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "muscle-groups"),
		);
	});

	it("classifies exercises by NAME, not the raw muscle_group column", async () => {
		// Regression: production data has muscle_group='General' on 100% of rows
		// (mobile hardcoded it). Classification must come from the exercise name.
		const sessionChain = buildChain({
			data: [{ id: "s1" }, { id: "s2" }],
			error: null,
		});
		const exerciseChain = buildChain({
			data: [
				{ name: "Bench Press", muscle_group: "General" },
				{ name: "Incline Bench Press", muscle_group: "General" },
				{ name: "Bent Over Row", muscle_group: "General" },
				{ name: "Low Bar Squat", muscle_group: "General" },
			],
			error: null,
		});

		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? sessionChain : exerciseChain;
		});

		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		const result = await opts.queryFn?.({} as never);

		// Must NOT collapse to a single "General" bucket
		expect(result.some((r: { name: string }) => r.name === "General")).toBe(
			false,
		);
		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "Chest", value: 50 }),
				expect.objectContaining({ name: "Back", value: 25 }),
				expect.objectContaining({ name: "Legs", value: 25 }),
			]),
		);
	});

	it("keeps a real muscle_group hint for names it cannot classify", async () => {
		const sessionChain = buildChain({ data: [{ id: "s1" }], error: null });
		const exerciseChain = buildChain({
			data: [
				{ name: "Bicep Curl", muscle_group: "General" },
				{ name: "Some Proprietary Machine", muscle_group: "Back" },
			],
			error: null,
		});
		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? sessionChain : exerciseChain;
		});

		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		const result = await opts.queryFn?.({} as never);

		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "Arms", value: 50 }),
				expect.objectContaining({ name: "Back", value: 50 }),
			]),
		);
	});

	it("returns empty array when user has no sessions", async () => {
		chain = buildChain({ data: [], error: null });
		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toEqual([]);
	});
});

describe("strengthProgressOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses analytics.summary query key with strength-progress", async () => {
		chain = buildChain({ data: [], error: null });
		const { strengthProgressOptions } = await import("../analytics");
		const opts = strengthProgressOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "strength-progress"),
		);
	});

	it("returns personal record data for strength chart", async () => {
		const raw = [
			{
				exercise_name: "Bench Press",
				value: 100,
				achieved_at: "2026-03-01T00:00:00Z",
			},
		];
		chain = buildChain({ data: raw, error: null });
		const { strengthProgressOptions } = await import("../analytics");
		const opts = strengthProgressOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toHaveLength(1);
		expect(result[0].exercise_name).toBe("Bench Press");
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "query error" },
		});
		const { strengthProgressOptions } = await import("../analytics");
		const opts = strengthProgressOptions("user-1");
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "query error" }),
		);
	});
});

describe("volumeComparisonOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses analytics.summary query key with volume-comparison prefix", async () => {
		chain = buildChain({ data: [], error: null });
		const { volumeComparisonOptions } = await import("../analytics");
		const opts = volumeComparisonOptions("user-1", "4w");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "volume-comparison-4w"),
		);
	});

	it("returns current and previous period data", async () => {
		const currentRows = [
			{
				started_at: "2026-03-15T08:00:00Z",
				total_volume: 700,
				duration_seconds: 2400,
				set_count: 10,
				exercise_count: 4,
			},
		];
		const previousRows = [
			{
				started_at: "2026-02-20T08:00:00Z",
				total_volume: 600,
				duration_seconds: 2000,
				set_count: 8,
				exercise_count: 3,
			},
		];

		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			if (callCount === 1)
				return buildChain({ data: currentRows, error: null });
			return buildChain({ data: previousRows, error: null });
		});

		const { volumeComparisonOptions } = await import("../analytics");
		const opts = volumeComparisonOptions("user-1", "4w");
		const result = await opts.queryFn?.({} as never);

		expect(result.current).toHaveLength(1);
		expect(result.previous).toHaveLength(1);
		expect(result.current[0].total_volume).toBe(700);
		expect(result.previous[0].total_volume).toBe(600);
	});
});
