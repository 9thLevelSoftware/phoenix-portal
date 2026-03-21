import { beforeEach, describe, expect, it, vi } from "vitest";
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

const cycleRow = {
	id: "11111111-1111-4111-8111-111111111111",
	user_id: "22222222-2222-4222-8222-222222222222",
	name: "Strength Block",
	description: "4-week linear progression",
	duration_weeks: 4,
	current_week: 2,
	status: "active" as const,
	workout_days: 4,
	rest_days: 3,
	started_at: "2026-03-01T00:00:00Z",
	last_used_at: "2026-03-15T10:00:00Z",
};

const cycleDayRow = {
	id: "aaaa1111-1111-4111-8111-111111111111",
	cycle_id: "11111111-1111-4111-8111-111111111111",
	day_number: 1,
	day_type: "workout",
	routine_id: "bbbb1111-1111-4111-8111-111111111111",
	weight_adjustment: 5,
	rep_modifier: 0,
	rest_override: null,
	notes: null,
	rest_type: null,
};

// --- Tests ----------------------------------------------------------------

describe("cycleListOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses cycles.byUser query key", async () => {
		chain = buildChain({ data: [], error: null });
		const { cycleListOptions } = await import("../cycles");
		const opts = cycleListOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.cycles.byUser("user-1"));
	});

	it("returns Zod-transformed cycle list with Date conversion", async () => {
		chain = buildChain({ data: [cycleRow], error: null });
		const { cycleListOptions } = await import("../cycles");
		const opts = cycleListOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Strength Block");
		expect(result[0].status).toBe("active");
		expect(result[0].started_at).toBeInstanceOf(Date);
		expect(result[0].last_used_at).toBeInstanceOf(Date);
		expect(result[0].duration_weeks).toBe(4);
	});

	it("handles null dates correctly", async () => {
		chain = buildChain({
			data: [{ ...cycleRow, started_at: null, last_used_at: null }],
			error: null,
		});
		const { cycleListOptions } = await import("../cycles");
		const opts = cycleListOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result[0].started_at).toBeNull();
		expect(result[0].last_used_at).toBeNull();
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "permission denied" },
		});
		const { cycleListOptions } = await import("../cycles");
		const opts = cycleListOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "permission denied" }),
		);
	});

	it("returns empty array when no cycles exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { cycleListOptions } = await import("../cycles");
		const opts = cycleListOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});
});

describe("cycleDetailOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses cycles.detail query key", async () => {
		const { cycleDetailOptions } = await import("../cycles");
		const opts = cycleDetailOptions("cycle-1");
		expect(opts.queryKey).toEqual(queryKeys.cycles.detail("cycle-1"));
	});

	it("returns cycle with nested cycle_days", async () => {
		const detailRow = {
			...cycleRow,
			cycle_days: [cycleDayRow],
			progression_settings: null,
			deload_settings: null,
		};
		chain = buildChain({ data: detailRow, error: null });
		const { cycleDetailOptions } = await import("../cycles");
		const opts = cycleDetailOptions("11111111-1111-4111-8111-111111111111");
		const result = await opts.queryFn!({} as never);

		expect(result.name).toBe("Strength Block");
		expect(result.cycle_days).toHaveLength(1);
		expect(result.cycle_days[0].day_number).toBe(1);
		expect(result.cycle_days[0].day_type).toBe("workout");
	});

	it("validates status enum and rejects invalid values", async () => {
		chain = buildChain({
			data: {
				...cycleRow,
				status: "invalid_status",
				cycle_days: [],
				progression_settings: null,
				deload_settings: null,
			},
			error: null,
		});
		const { cycleDetailOptions } = await import("../cycles");
		const opts = cycleDetailOptions("cycle-1");
		await expect(opts.queryFn!({} as never)).rejects.toThrow();
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "not found" },
		});
		const { cycleDetailOptions } = await import("../cycles");
		const opts = cycleDetailOptions("cycle-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "not found" }),
		);
	});
});
