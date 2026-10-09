import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "gte", "order", "maybeSingle"]) {
		self[method] = vi.fn();
	}
	for (const method of Object.keys(self)) {
		self[method].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn((_table: string) => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (table: string) => fromFn(table) },
}));

const sessionRow = {
	started_at: "2026-09-01T12:00:00.000Z",
	total_volume: 1400,
};

describe("recoverySessionsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		chain = buildChain({ data: [sessionRow], error: null });
	});

	it("reads the last 42 days for every profile when no profile is set", async () => {
		const { recoverySessionsOptions } = await import("../recovery");
		const opts = recoverySessionsOptions("user-1");

		expect(opts.queryKey).toEqual(queryKeys.recovery.score("user-1"));
		expect(opts.queryKey).toEqual(queryKeys.recovery.score("user-1", null));

		const result = await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledWith("workout_sessions");
		expect(chain.select).toHaveBeenCalledWith("started_at, total_volume");
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).not.toHaveBeenCalledWith(
			"local_profile_id",
			expect.anything(),
		);
		expect(chain.gte).toHaveBeenCalledTimes(1);
		expect(chain.order).toHaveBeenCalledWith("started_at", {
			ascending: false,
		});
		expect(result).toEqual([
			{
				started_at: new Date("2026-09-01T12:00:00.000Z"),
				total_volume: 1400,
			},
		]);
	});

	it("keeps a profile's sessions on their own cache key and filters the query", async () => {
		const { recoverySessionsOptions } = await import("../recovery");
		const opts = recoverySessionsOptions("user-1", "profile-1");

		expect(opts.queryKey).toEqual(
			queryKeys.recovery.score("user-1", "profile-1"),
		);
		expect(opts.queryKey).not.toEqual(queryKeys.recovery.score("user-1"));

		await opts.queryFn?.({} as never);

		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).toHaveBeenCalledWith("local_profile_id", "profile-1");
	});
});

describe("activeCyclePositionOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		chain = buildChain({
			data: { current_week: 2, duration_weeks: 6, status: "active" },
			error: null,
		});
	});

	it("uses the all-profiles key and skips the profile filter when unset", async () => {
		const { activeCyclePositionOptions } = await import("../recovery");
		const opts = activeCyclePositionOptions("user-1");

		expect(opts.queryKey).toEqual([
			...queryKeys.cycles.all,
			"active-position",
			"user-1",
			"all",
		]);

		const result = await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledWith("training_cycles");
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).toHaveBeenCalledWith("status", "active");
		expect(chain.eq).not.toHaveBeenCalledWith(
			"local_profile_id",
			expect.anything(),
		);
		expect(result).toEqual({
			current_week: 2,
			duration_weeks: 6,
			status: "active",
		});
	});

	it("filters the active cycle to the selected profile on a distinct key", async () => {
		const { activeCyclePositionOptions } = await import("../recovery");
		const opts = activeCyclePositionOptions("user-1", "profile-1");

		expect(opts.queryKey).toEqual([
			...queryKeys.cycles.all,
			"active-position",
			"user-1",
			"profile-1",
		]);
		expect(opts.queryKey).not.toEqual(
			activeCyclePositionOptions("user-1").queryKey,
		);

		await opts.queryFn?.({} as never);

		expect(chain.eq).toHaveBeenCalledWith("local_profile_id", "profile-1");
	});
});
