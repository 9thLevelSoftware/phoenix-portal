import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of [
		"select",
		"eq",
		"gte",
		"order",
		"limit",
		"maybeSingle",
	]) {
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

const activeCycleRow = {
	current_week: 2,
	duration_weeks: 6,
	status: "active" as const,
};

describe("activeCyclePositionOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		chain = buildChain({
			data: activeCycleRow,
			error: null,
		});
	});

	it("uses the all-profiles key and returns the only active cycle", async () => {
		chain = buildChain({ data: [activeCycleRow], error: null });
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
		expect(chain.limit).toHaveBeenCalledWith(2);
		expect(chain.maybeSingle).not.toHaveBeenCalled();
		expect(result).toEqual(activeCycleRow);
	});

	it("returns null when All profiles has no active cycle", async () => {
		chain = buildChain({ data: [], error: null });
		const { activeCyclePositionOptions } = await import("../recovery");

		const result = await activeCyclePositionOptions("user-1").queryFn?.(
			{} as never,
		);

		expect(result).toBeNull();
	});

	it("returns null for two active cycles across All profiles", async () => {
		chain = buildChain({
			data: [
				activeCycleRow,
				{ current_week: 1, duration_weeks: 4, status: "active" },
			],
			error: null,
		});
		const { activeCyclePositionOptions } = await import("../recovery");

		const result = await activeCyclePositionOptions("user-1").queryFn?.(
			{} as never,
		);

		expect(chain.limit).toHaveBeenCalledWith(2);
		expect(chain.maybeSingle).not.toHaveBeenCalled();
		expect(result).toBeNull();
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

		const result = await opts.queryFn?.({} as never);

		expect(chain.eq).toHaveBeenCalledWith("local_profile_id", "profile-1");
		expect(chain.maybeSingle).toHaveBeenCalledOnce();
		expect(chain.limit).not.toHaveBeenCalled();
		expect(result).toEqual(activeCycleRow);
	});
});
