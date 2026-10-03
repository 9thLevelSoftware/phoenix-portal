import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	SUPABASE_FILTER_CHUNK_SIZE,
	SUPABASE_PAGE_SIZE,
} from "@/lib/supabasePaging";

function buildChain(terminal: {
	data: unknown;
	error: unknown;
	count?: number | null;
}) {
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
			// A row payload must not be the count. head:true returns none.
			data: [{ id: "combined-pr" }],
			count: 3,
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
		expect(chain.select).toHaveBeenCalledWith("id", {
			count: "exact",
			head: true,
		});
		expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
		expect(result).toEqual({ current: 3, target: 3, percentage: 100 });
	});

	it("counts frequency workouts with an exact head count", async () => {
		chain = buildChain({
			data: [{ id: "only-loaded-row" }],
			count: 4,
			error: null,
		});

		const { challengeProgressOptions } = await import("../challenges");
		const opts = challengeProgressOptions(
			"user-1",
			"challenge-freq",
			"frequency",
			10,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		);

		const result = await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledWith("workout_sessions");
		expect(chain.select).toHaveBeenCalledWith("id", {
			count: "exact",
			head: true,
		});
		expect(result).toEqual({ current: 4, target: 10, percentage: 40 });
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
			for (const m of [
				"select",
				"eq",
				"gte",
				"lte",
				"in",
				"or",
				"order",
				"limit",
				"range",
			]) {
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

describe("challengeProgressOptions paging", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const session = (
		i: number,
		startedAt: string,
		totalVolume = 0,
	): Record<string, unknown> => ({
		id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
		started_at: startedAt,
		total_volume: totalVolume,
	});

	/** A chain whose `limit` resolves to the next queued page. */
	function keysetChain(pages: Array<Array<Record<string, unknown>>>) {
		const self: Record<string, ReturnType<typeof vi.fn>> = {};
		for (const method of ["select", "eq", "gte", "lte", "or", "order"]) {
			self[method] = vi.fn(() => self);
		}
		let call = 0;
		self.limit = vi.fn(() =>
			Promise.resolve({ data: pages[call++] ?? [], error: null }),
		);
		return self;
	}

	it("pages streak sessions and still walks local calendar days", async () => {
		const day = "2026-05-01T12:00:00.000Z";
		const nextDay = "2026-05-02T12:00:00.000Z";
		const first = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) =>
			session(i, day),
		);
		const chain = keysetChain([first, [session(SUPABASE_PAGE_SIZE, nextDay)]]);
		fromFn.mockImplementation(((table: string) => {
			expect(table).toBe("workout_sessions");
			return chain as never;
		}) as never);

		const { challengeProgressOptions } = await import("../challenges");
		const result = await challengeProgressOptions(
			"user-1",
			"challenge-streak",
			"streak",
			2,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		).queryFn?.({} as never);

		expect(result).toEqual({ current: 2, target: 2, percentage: 100 });
		expect(chain.limit).toHaveBeenCalledTimes(2);
		const last = first[SUPABASE_PAGE_SIZE - 1] as {
			started_at: string;
			id: string;
		};
		expect(chain.or).toHaveBeenCalledWith(
			`started_at.gt."${last.started_at}",and(started_at.eq."${last.started_at}",id.gt.${last.id})`,
		);
		expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
	});

	it("breaks a streak on a local-calendar gap", async () => {
		const chain = keysetChain([
			[
				session(1, "2026-05-04T12:00:00.000Z"),
				session(2, "2026-05-02T12:00:00.000Z"),
				session(3, "2026-05-01T12:00:00.000Z"),
			],
		]);
		fromFn.mockImplementation(() => chain as never);

		const { challengeProgressOptions } = await import("../challenges");
		const result = await challengeProgressOptions(
			"user-1",
			"challenge-streak",
			"streak",
			5,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		).queryFn?.({} as never);

		expect(result).toEqual({ current: 1, target: 5, percentage: 20 });
		expect(chain.limit).toHaveBeenCalledTimes(1);
	});

	it("pages volume sessions past the row cap", async () => {
		const day = "2026-05-01T12:00:00.000Z";
		const first = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) =>
			session(i, day, 0),
		);
		const tail = session(SUPABASE_PAGE_SIZE, day, 50);
		const chain = keysetChain([first, [tail]]);
		fromFn.mockImplementation(((table: string) => {
			if (table === "workout_sessions") return chain as never;
			const child: Record<string, ReturnType<typeof vi.fn>> = {};
			for (const method of ["select", "in", "order"]) {
				child[method] = vi.fn(() => child);
			}
			child.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
			return child as never;
		}) as never);

		const { challengeProgressOptions } = await import("../challenges");
		const result = await challengeProgressOptions(
			"user-1",
			"challenge-vol",
			"volume",
			50,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		).queryFn?.({} as never);

		expect(result).toEqual({ current: 50, target: 50, percentage: 100 });
		expect(chain.limit).toHaveBeenCalledTimes(2);
	});

	it("range-pages volume sets inside an id chunk", async () => {
		const ranges: Array<[number, number]> = [];
		fromFn.mockImplementation(((table: string) => {
			const self: Record<string, ReturnType<typeof vi.fn>> = {};
			for (const method of ["select", "eq", "gte", "lte", "in", "order"]) {
				self[method] = vi.fn(() => self);
			}
			self.limit = vi.fn(() =>
				Promise.resolve({
					data: [session(1, "2026-05-01T12:00:00.000Z", 100)],
					error: null,
				}),
			);
			self.range = vi.fn((from: number, to: number) => {
				if (table === "exercises") {
					return Promise.resolve({
						data:
							from === 0
								? [
										{ id: "e1", session_id: session(1, "").id, cable_count: 1 },
										{ id: "e2", session_id: session(1, "").id, cable_count: 2 },
									]
								: [],
						error: null,
					});
				}
				ranges.push([from, to]);
				return Promise.resolve({
					data:
						from === 0
							? Array.from({ length: SUPABASE_PAGE_SIZE }, () => ({
									exercise_id: "e1",
									weight_kg: 1,
									actual_reps: 1,
								}))
							: [{ exercise_id: "e2", weight_kg: 1000, actual_reps: 1 }],
					error: null,
				});
			});
			return self as never;
		}) as never);

		const { challengeProgressOptions } = await import("../challenges");
		const result = await challengeProgressOptions(
			"user-1",
			"challenge-vol",
			"volume",
			150,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		).queryFn?.({} as never);

		// e1 volume 1000 x 1 cable + e2 volume 1000 x 2 cables, over base
		// 2000, scales the session's 100 kg per cable to 150.
		expect(result).toEqual({ current: 150, target: 150, percentage: 100 });
		expect(ranges).toEqual([
			[0, SUPABASE_PAGE_SIZE - 1],
			[SUPABASE_PAGE_SIZE, SUPABASE_PAGE_SIZE * 2 - 1],
		]);
	});

	it("chunks volume exercise ids at the shared filter size", async () => {
		const chunks: string[][] = [];
		const sessions = Array.from(
			{ length: SUPABASE_FILTER_CHUNK_SIZE + 1 },
			(_, i) => session(i, "2026-05-01T12:00:00.000Z", 0),
		);
		fromFn.mockImplementation(((table: string) => {
			const self: Record<string, ReturnType<typeof vi.fn>> = {};
			for (const method of ["select", "eq", "gte", "lte", "order"]) {
				self[method] = vi.fn(() => self);
			}
			self.limit = vi.fn(() =>
				Promise.resolve({ data: sessions, error: null }),
			);
			self.in = vi.fn((_column: string, ids: string[]) => {
				if (table === "exercises") chunks.push(ids);
				return self;
			});
			self.range = vi.fn(() => Promise.resolve({ data: [], error: null }));
			return self as never;
		}) as never);

		const { challengeProgressOptions } = await import("../challenges");
		await challengeProgressOptions(
			"user-1",
			"challenge-vol",
			"volume",
			1,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		).queryFn?.({} as never);

		expect(chunks.map((ids) => ids.length)).toEqual([
			SUPABASE_FILTER_CHUNK_SIZE,
			1,
		]);
	});
});
