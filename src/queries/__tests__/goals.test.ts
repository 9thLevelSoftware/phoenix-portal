import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";
import { personalRecordSchema } from "@/schemas/transforms";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: {
		rpc: (...args: unknown[]) => rpc(...args),
		from: (...args: unknown[]) => from(...args),
	},
}));

beforeEach(() => {
	rpc.mockReset();
	from.mockReset();
});

function sessionChain(terminal: { data: unknown; error: unknown }) {
	const chain: Record<string, unknown> = { ...terminal };
	for (const method of ["select", "eq", "gte", "order", "limit", "range"]) {
		chain[method] = vi.fn(() => chain);
	}
	return chain as {
		select: ReturnType<typeof vi.fn>;
		eq: ReturnType<typeof vi.fn>;
		gte: ReturnType<typeof vi.fn>;
		order: ReturnType<typeof vi.fn>;
		limit: ReturnType<typeof vi.fn>;
		range: ReturnType<typeof vi.fn>;
	};
}

describe("goalPrBestsOptions", () => {
	it("uses the records cache prefix so sync invalidation refreshes goal progress", async () => {
		rpc.mockResolvedValue({ data: [], error: null });
		const { goalPrBestsOptions } = await import("../goals");
		const options = goalPrBestsOptions("user-1", "profile-1");

		expect(options.queryKey).toEqual([
			...queryKeys.records.byUser("user-1", "profile-1"),
			"goal-pr-bests",
		]);
	});

	// Was "converts stored per-cable PR values to the total weight shown by
	// goals" — that title is the pre-KD-8 doubling claim. The assertion has
	// always been the identity (`personalRecordSchema.value` is
	// `perCableWeight = z.number()`), and `WEIGHT_MULTIPLIER` is gone from
	// transforms.ts. Goal PRs carry no cable count, so any total is the display
	// layer's job.
	it("returns stored per-cable PR values unchanged", async () => {
		rpc.mockResolvedValue({
			data: [
				{
					exercise_id: null,
					exercise_name: "Squat",
					record_type: "MAX_WEIGHT",
					value: 50,
				},
			],
			error: null,
		});
		const { goalPrBestsOptions } = await import("../goals");
		const options = goalPrBestsOptions("user-1");
		const result = await options.queryFn?.({} as never);
		const standardRecordValue = personalRecordSchema.parse({
			id: "00000000-0000-4000-8000-000000000001",
			user_id: "00000000-0000-4000-8000-000000000002",
			exercise_name: "Squat",
			muscle_group: "Legs",
			record_type: "MAX_WEIGHT",
			value: 50,
			unit: "kg",
			achieved_at: "2026-09-20T12:00:00Z",
			previous_value: null,
		}).value;

		expect(result).toEqual([
			{
				exercise_id: null,
				exercise_name: "Squat",
				record_type: "MAX_WEIGHT",
				value: standardRecordValue,
			},
		]);
		expect(rpc).toHaveBeenCalledWith("personal_record_bests", {});
	});
});

describe("goalPeriodStart", () => {
	it("starts a week on Monday and a month on the 1st, local midnight", async () => {
		const { goalPeriodStart } = await import("../goals");
		const saturday = new Date(2026, 9, 3, 15, 30, 0, 0);

		expect(goalPeriodStart(saturday, "weekly")).toEqual(
			new Date(2026, 8, 28, 0, 0, 0, 0),
		);
		expect(goalPeriodStart(saturday, "monthly")).toEqual(
			new Date(2026, 9, 1, 0, 0, 0, 0),
		);
		expect(
			goalPeriodStart(new Date(2026, 9, 4, 23, 0, 0, 0), "weekly"),
		).toEqual(new Date(2026, 8, 28, 0, 0, 0, 0));
		expect(goalPeriodStart(new Date(2026, 9, 5, 8, 0, 0, 0), "weekly")).toEqual(
			new Date(2026, 9, 5, 0, 0, 0, 0),
		);
	});
});

describe("earliestGoalPeriodStart", () => {
	const now = new Date(2026, 9, 3, 15, 0, 0, 0);

	it("uses the earlier window when weekly and monthly goals are both active", async () => {
		const { earliestGoalPeriodStart } = await import("../goals");
		const start = earliestGoalPeriodStart(
			[
				{ status: "active", goal_type: "volume", period: "monthly" },
				{ status: "active", goal_type: "frequency", period: "weekly" },
				{ status: "active", goal_type: "pr", period: "weekly" },
			],
			now,
		);
		expect(start).toEqual(new Date(2026, 8, 28, 0, 0, 0, 0));
	});

	it("ignores PR, archived, and completed goals", async () => {
		const { earliestGoalPeriodStart } = await import("../goals");
		expect(
			earliestGoalPeriodStart(
				[
					{ status: "active", goal_type: "pr", period: "weekly" },
					{ status: "archived", goal_type: "frequency", period: "weekly" },
					{ status: "completed", goal_type: "volume", period: "monthly" },
				],
				now,
			),
		).toBeNull();
	});
});

describe("goalPeriodSessionsOptions", () => {
	const periodStart = new Date(2026, 8, 28, 0, 0, 0, 0);

	it("reads sessions from the period start and does not cap at the newest 50", async () => {
		const chain = sessionChain({
			data: [
				{ started_at: "2026-09-28T10:00:00.000Z", total_volume: 1200 },
				{ started_at: "2026-10-02T10:00:00.000Z", total_volume: 800 },
			],
			error: null,
		});
		from.mockReturnValue(chain);
		const { goalPeriodSessionsOptions } = await import("../goals");
		const options = goalPeriodSessionsOptions(
			"user-1",
			"profile-1",
			periodStart,
		);

		expect(options.enabled).toBe(true);
		expect(options.queryKey[0]).toBe("workouts");
		expect(options.queryKey).toContain("goal-period");
		expect(options.queryKey).toContain(periodStart.toISOString());
		expect(options.queryKey).toContain("profile-1");

		const result = await options.queryFn?.({} as never);
		expect(from).toHaveBeenCalledWith("workout_sessions");
		expect(chain.select).toHaveBeenCalledWith("started_at, total_volume");
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).toHaveBeenCalledWith("local_profile_id", "profile-1");
		expect(chain.gte).toHaveBeenCalledWith(
			"started_at",
			periodStart.toISOString(),
		);
		expect(chain.limit).not.toHaveBeenCalled();
		expect(chain.range).not.toHaveBeenCalled();
		expect(result).toEqual([
			{
				started_at: new Date("2026-09-28T10:00:00.000Z"),
				total_volume: 1200,
			},
			{
				started_at: new Date("2026-10-02T10:00:00.000Z"),
				total_volume: 800,
			},
		]);
	});

	it("stays disabled until a user and a frequency or volume window exist", async () => {
		const { goalPeriodSessionsOptions } = await import("../goals");
		expect(goalPeriodSessionsOptions("", null, periodStart).enabled).toBe(
			false,
		);
		expect(goalPeriodSessionsOptions("user-1", null, null).enabled).toBe(false);
	});

	it("does not filter by profile when the portal is showing every profile", async () => {
		const chain = sessionChain({ data: [], error: null });
		from.mockReturnValue(chain);
		const { goalPeriodSessionsOptions } = await import("../goals");
		await goalPeriodSessionsOptions("user-1", null, periodStart).queryFn?.(
			{} as never,
		);
		expect(chain.eq).toHaveBeenCalledTimes(1);
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
	});

	it("throws on Supabase error", async () => {
		const chain = sessionChain({
			data: null,
			error: { message: "DB error", code: "42P01" },
		});
		from.mockReturnValue(chain);
		const { goalPeriodSessionsOptions } = await import("../goals");
		await expect(
			goalPeriodSessionsOptions("user-1", null, periodStart).queryFn?.(
				{} as never,
			),
		).rejects.toEqual(expect.objectContaining({ message: "DB error" }));
	});
});
