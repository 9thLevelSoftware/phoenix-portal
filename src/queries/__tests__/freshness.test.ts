import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "order", "limit"]) {
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

describe("dashboardFreshnessOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the latest workout update for the active profile", async () => {
		chain = buildChain({
			data: [
				{
					updated_at: "2026-06-05T12:00:00Z",
					started_at: "2026-06-05T11:00:00Z",
				},
			],
			error: null,
		});

		const { dashboardFreshnessOptions } = await import("../freshness");
		const opts = dashboardFreshnessOptions("user-1", "profile-1");
		const result = await opts.queryFn?.({} as never);

		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "freshness", "profile-1"),
		);
		expect(fromFn).toHaveBeenCalledWith("workout_sessions");
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).toHaveBeenCalledWith("local_profile_id", "profile-1");
		expect(result).toEqual({
			lastWorkoutUpdatedAt: "2026-06-05T12:00:00Z",
			lastWorkoutStartedAt: "2026-06-05T11:00:00Z",
			hasSyncedWorkouts: true,
		});
	});
});
