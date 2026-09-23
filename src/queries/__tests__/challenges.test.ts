import { beforeEach, describe, expect, it, vi } from "vitest";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "is", "gte", "lte", "order"];
	for (const method of methods) {
		self[method] = vi.fn();
	}
	for (const method of methods) {
		self[method].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

describe("challengeProgressOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("counts phase-specific personal record rows separately for PR challenges", async () => {
		chain = buildChain({
			data: [
				{ id: "combined-pr" },
				{ id: "concentric-pr" },
				{ id: "eccentric-pr" },
			],
			error: null,
		});

		const { challengeProgressOptions } = await import("../challenges");
		const opts = challengeProgressOptions(
			"user-1",
			"challenge-1",
			"pr_count",
			3,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		);

		const result = await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledWith("personal_records");
		expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
		expect(result).toEqual({ current: 3, target: 3, percentage: 100 });
	});
});

describe("challengeProgressOptions volume (total load, KD-8)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sums per-cable session volume x cables used, never doubling single-cable or unknown sessions", async () => {
		const byTable: Record<string, unknown[]> = {
			workout_sessions: [
				{ id: "s-two", total_volume: 500 },
				{ id: "s-one", total_volume: 600 },
				{ id: "s-unknown", total_volume: 100 },
			],
			exercises: [
				{ id: "e-two", session_id: "s-two", cable_count: 2 },
				{ id: "e-one", session_id: "s-one", cable_count: 1 },
				{ id: "e-unknown", session_id: "s-unknown", cable_count: null },
			],
			sets: [
				{ exercise_id: "e-two", weight_kg: 50, actual_reps: 10 },
				{ exercise_id: "e-one", weight_kg: 60, actual_reps: 10 },
				{ exercise_id: "e-unknown", weight_kg: 10, actual_reps: 10 },
			],
		};
		fromFn.mockImplementation(((table: string) => {
			const self: Record<string, unknown> = {
				data: byTable[table] ?? [],
				error: null,
			};
			for (const m of ["select", "eq", "gte", "lte", "in", "order"]) {
				self[m] = vi.fn(() => self);
			}
			return self;
		}) as never);

		const { challengeProgressOptions } = await import("../challenges");
		const opts = challengeProgressOptions(
			"user-1",
			"challenge-vol",
			"volume",
			3400,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		);
		const result = await opts.queryFn?.({} as never);

		// 500 x 2 + 600 x 1 (single cable, not doubled) + 100 (unknown: per
		// cable only) = 1700
		expect(result).toEqual({ current: 1700, target: 3400, percentage: 50 });
	});
});
