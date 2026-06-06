import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "order"]) {
		self[method] = vi.fn();
	}
	for (const method of Object.keys(self)) {
		self[method].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

describe("communityBenchmarksOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches all benchmark rows with a stable query key", async () => {
		const rows = [
			{
				id: "b1",
				metric_type: "leaderboard",
				metric_key: "total_volume_kg",
				percentile_values: { p50: 1000, p90: 2000 },
				total_users: 12,
				updated_at: "2026-06-01T00:00:00Z",
			},
		];
		chain = buildChain({ data: rows, error: null });

		const { communityBenchmarksOptions } = await import("../benchmarks");
		const opts = communityBenchmarksOptions();
		const result = await opts.queryFn?.({} as never);

		expect(opts.queryKey).toEqual(queryKeys.benchmarks.all);
		expect(fromFn).toHaveBeenCalledWith("community_benchmarks");
		expect(chain.select).toHaveBeenCalledWith("*");
		expect(result).toEqual(rows);
	});
});
