import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "is", "order", "gte", "lt", "in", "limit"];
	for (const m of methods) {
		self[m] = vi.fn();
	}
	for (const m of methods) {
		self[m].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
// Declared with a parameter so `mockImplementation((table) => …)` matches.
const fromFn = vi.fn((_table?: string) => chain);
const rpcFn = vi.fn();
const rpcSelectFn = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table?: string) => fromFn(table),
		rpc: (...args: unknown[]) => rpcFn(...args),
	},
}));

/**
 * `supabase.rpc(...)` is awaited directly by most queries and chained with
 * `.select(...)` by the ones that need the catalog embed, so the mock result is
 * both thenable and chainable.
 */
function mockRpc(result: { data: unknown; error: unknown }) {
	rpcSelectFn.mockResolvedValue(result);
	rpcFn.mockImplementation(() => {
		const settled = Promise.resolve(result) as Promise<typeof result> & {
			select: (...args: unknown[]) => unknown;
		};
		settled.select = (...args: unknown[]) => rpcSelectFn(...args);
		return settled;
	});
}

/** Pin the "browser" zone so the assertions cannot pass by accident in UTC CI. */
function stubTimeZone(timeZone: string) {
	return vi
		.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
		.mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);
}

// --- Tests ----------------------------------------------------------------

describe("volumeTrendOptions", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses analytics.summary query key with volume prefix", async () => {
		mockRpc({ data: [], error: null });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1", "4w");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "volume-4w"),
		);
	});

	it("defaults period to 4w", async () => {
		mockRpc({ data: [], error: null });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "volume-4w"),
		);
	});

	it("aggregates weekly buckets in SQL instead of reading every session row", async () => {
		const tz = stubTimeZone("America/New_York");
		mockRpc({
			data: [
				{
					week_start: "2026-02-23",
					sessions: 3,
					total_volume: 1500,
					total_duration_seconds: 7200,
					total_sets: 30,
				},
			],
			error: null,
		});

		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1", "all", "profile-1");
		const result = await opts.queryFn!({} as never);

		expect(rpcFn).toHaveBeenCalledTimes(1);
		expect(rpcFn).toHaveBeenCalledWith("session_volume_buckets", {
			p_period: "all",
			// The RPC's Monday-week rule only matches the chart's former local
			// bucketing when it is given the browser zone (PR 40 hand-off).
			p_tz: "America/New_York",
			p_profile_id: "profile-1",
		});
		// No session rows in the URL, so the "all" period cannot be truncated.
		expect(fromFn).not.toHaveBeenCalled();
		expect(result).toHaveLength(1);
		expect(result[0].week_start).toBe("2026-02-23");
		tz.mockRestore();
	});

	it("omits the profile argument instead of passing null", async () => {
		mockRpc({ data: [], error: null });
		const { volumeTrendOptions } = await import("../analytics");
		await volumeTrendOptions("user-1", "12w").queryFn!({} as never);

		const args = rpcFn.mock.calls[0][1] as Record<string, unknown>;
		expect(args).not.toHaveProperty("p_profile_id");
		expect(args.p_period).toBe("12w");
	});

	it("throws on Supabase error", async () => {
		mockRpc({ data: null, error: { message: "query failed" } });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "query failed" }),
		);
	});

	it("returns empty array when no sessions exist", async () => {
		mockRpc({ data: [], error: null });
		const { volumeTrendOptions } = await import("../analytics");
		const opts = volumeTrendOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});
});

describe("muscleGroupOptions", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses analytics.summary query key with muscle-groups", async () => {
		mockRpc({ data: [], error: null });
		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "muscle-groups"),
		);
	});

	it("classifies exercises by NAME, not the raw muscle_group column", async () => {
		// Regression: production data has muscle_group='General' on 100% of rows
		// (mobile hardcoded it). Classification must come from the exercise name.
		mockRpc({
			data: [
				{ exercise_name: "Bench Press", muscle_group: "General", sessions: 1 },
				{
					exercise_name: "Incline Bench Press",
					muscle_group: "General",
					sessions: 1,
				},
				{
					exercise_name: "Bent Over Row",
					muscle_group: "General",
					sessions: 1,
				},
				{
					exercise_name: "Low Bar Squat",
					muscle_group: "General",
					sessions: 1,
				},
			],
			error: null,
		});

		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		const result = await opts.queryFn!({} as never);

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
		mockRpc({
			data: [
				{ exercise_name: "Bicep Curl", muscle_group: "General", sessions: 1 },
				{
					exercise_name: "Some Proprietary Machine",
					muscle_group: "Back",
					sessions: 1,
				},
			],
			error: null,
		});

		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "Arms", value: 50 }),
				expect.objectContaining({ name: "Back", value: 50 }),
			]),
		);
	});

	it("makes one RPC call with no session id list and weights by session count", async () => {
		// 1,600 counted sessions across two exercises. The old path fetched every
		// session id, put them all in a GET URL (fatal past ~200 sessions) and then
		// read `exercises` rows that PostgREST capped at 1,000 — so a 1,200-session
		// exercise could never be counted in full (F-035 / F-034).
		mockRpc({
			data: [
				{
					exercise_name: "Bench Press",
					muscle_group: "General",
					sessions: 1200,
				},
				{
					exercise_name: "Bent Over Row",
					muscle_group: "General",
					sessions: 400,
				},
			],
			error: null,
		});

		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1", "profile-1");
		const result = await opts.queryFn!({} as never);

		expect(rpcFn).toHaveBeenCalledTimes(1);
		expect(rpcFn).toHaveBeenCalledWith("exercise_frequency", {
			p_profile_id: "profile-1",
		});
		expect(fromFn).not.toHaveBeenCalled();
		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "Chest", value: 75 }),
				expect.objectContaining({ name: "Back", value: 25 }),
			]),
		);
	});

	it("omits the profile argument instead of passing null", async () => {
		mockRpc({ data: [], error: null });
		const { muscleGroupOptions } = await import("../analytics");
		await muscleGroupOptions("user-1", null).queryFn!({} as never);
		expect(rpcFn).toHaveBeenCalledWith("exercise_frequency", {});
	});

	it("throws on RPC error", async () => {
		mockRpc({ data: null, error: { message: "rpc failed" } });
		const { muscleGroupOptions } = await import("../analytics");
		await expect(
			muscleGroupOptions("user-1").queryFn!({} as never),
		).rejects.toEqual(expect.objectContaining({ message: "rpc failed" }));
	});

	it("returns empty array when user has no sessions", async () => {
		mockRpc({ data: [], error: null });
		const { muscleGroupOptions } = await import("../analytics");
		const opts = muscleGroupOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});
});

describe("strengthProgressOptions", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses analytics.summary query key with strength-progress", async () => {
		mockRpc({ data: [], error: null });
		const { strengthProgressOptions } = await import("../analytics");
		const opts = strengthProgressOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.summary("user-1", "strength-progress"),
		);
	});

	it("reads the NEWEST records through the keyset RPC, ascending for the chart", async () => {
		// The old read was an unbounded ASCENDING select on personal_records, so
		// PostgREST's 1,000-row cap dropped the newest PRs first (F-034). The RPC
		// is newest-first with an explicit limit and excludes tombstones in SQL.
		mockRpc({
			data: [
				{
					exercise_name: "Bench Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 120,
					achieved_at: "2026-03-05T00:00:00Z",
				},
				{
					exercise_name: "Bench Press",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 100,
					achieved_at: "2026-03-01T00:00:00Z",
				},
			],
			error: null,
		});

		const { strengthProgressOptions } = await import("../analytics");
		const result = await strengthProgressOptions("user-1", "profile-1")
			.queryFn!({} as never);

		expect(rpcFn).toHaveBeenCalledTimes(1);
		expect(rpcFn).toHaveBeenCalledWith("personal_record_history", {
			p_limit: 1000,
			p_profile_id: "profile-1",
		});
		expect(fromFn).not.toHaveBeenCalled();
		expect(result).toHaveLength(2);
		expect(result.map((r: { value: number }) => r.value)).toEqual([100, 120]);
	});

	it("omits the profile argument instead of passing null", async () => {
		mockRpc({ data: [], error: null });
		const { strengthProgressOptions } = await import("../analytics");
		await strengthProgressOptions("user-1", null).queryFn!({} as never);
		expect(rpcFn).toHaveBeenCalledWith("personal_record_history", {
			p_limit: 1000,
		});
	});

	it("uses catalog display names for strength PR rows whose exercise_name is a catalog ID", async () => {
		mockRpc({
			data: [
				{
					exercise_name: "Barbell_Curl",
					exercise_id: "Barbell_Curl",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 40,
					achieved_at: "2026-03-01T00:00:00Z",
					catalog: {
						id: "Barbell_Curl",
						name: "Bayesian Curl",
						display_name: "Bayesian Curl (Handles)",
					},
				},
			],
			error: null,
		});
		const { strengthProgressOptions } = await import("../analytics");
		const opts = strengthProgressOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result[0].exercise_name).toBe("Bayesian Curl (Handles)");
	});

	it("resolves legacy exercise-id names by user_id, never by a session id list", async () => {
		// 1,200 PR rows whose exercise_name is the exercises row id. The old
		// lookup sent all 1,200 session ids in a GET URL (~45 KB, dead well past
		// the ~8 KB limit — F-035).
		const records = Array.from({ length: 1200 }, (_, i) => {
			const suffix = String(i).padStart(12, "0");
			return {
				exercise_name: `00000000-0000-4000-8000-${suffix}`,
				exercise_id: null,
				session_id: `session-${i}`,
				record_type: "MAX_WEIGHT",
				workout_phase: "CONCENTRIC",
				value: 100,
				achieved_at: "2026-03-01T00:00:00Z",
			};
		});
		mockRpc({ data: records, error: null });
		const exercisesChain = buildChain({
			data: [
				{
					id: "00000000-0000-4000-8000-000000000007",
					session_id: "session-7",
					name: "Bench Press",
					exercise_id: null,
					catalog: null,
				},
			],
			error: null,
		});

		fromFn.mockImplementation((table: unknown) => {
			expect(table).toBe("exercises");
			return exercisesChain;
		});

		const { strengthProgressOptions } = await import("../analytics");
		const result = await strengthProgressOptions("user-1").queryFn!(
			{} as never,
		);

		expect(exercisesChain.in).not.toHaveBeenCalled();
		expect(exercisesChain.eq).toHaveBeenCalledWith("user_id", "user-1");
		// Reversed to ascending, so row 7 of the RPC page is 1200 - 1 - 7 here.
		expect(result[1192].exercise_name).toBe("Bench Press");
	});

	it("selects record type and workout phase for phase-aware strength charts", async () => {
		mockRpc({ data: [], error: null });
		const { strengthProgressOptions } = await import("../analytics");
		const opts = strengthProgressOptions("user-1");
		await opts.queryFn!({} as never);
		// exercise_progress has no workout_phase, so this chart keeps reading
		// personal_records — with the catalog embed on the RPC result.
		expect(rpcSelectFn).toHaveBeenCalledWith(
			"exercise_name, exercise_id, session_id, record_type, workout_phase, value, achieved_at, catalog:exercise_catalog(id, name, display_name)",
		);
	});

	it("throws on Supabase error", async () => {
		mockRpc({ data: null, error: { message: "query error" } });
		const { strengthProgressOptions } = await import("../analytics");
		const opts = strengthProgressOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "query error" }),
		);
	});
});

describe("phaseStatisticsTrendOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses a user, period, and profile-specific query key", async () => {
		chain = buildChain({ data: [], error: null });
		const { phaseStatisticsTrendOptions } = await import("../analytics");
		const opts = phaseStatisticsTrendOptions("user-1", "4w", "profile-1");
		expect(opts.queryKey).toEqual(
			queryKeys.analytics.phaseStats("user-1", "4w", "profile-1"),
		);
	});

	it("queries session phase statistics with workout session context", async () => {
		chain = buildChain({ data: [], error: null });
		const { phaseStatisticsTrendOptions } = await import("../analytics");
		const opts = phaseStatisticsTrendOptions("user-1", "4w", "profile-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toEqual([]);
		expect(fromFn).toHaveBeenCalledWith("session_phase_statistics");
		expect(chain.select).toHaveBeenCalledWith(
			[
				"session_id",
				"concentric_kg_avg",
				"concentric_kg_max",
				"concentric_vel_avg",
				"concentric_vel_max",
				"concentric_watt_avg",
				"concentric_watt_max",
				"eccentric_kg_avg",
				"eccentric_kg_max",
				"eccentric_vel_avg",
				"eccentric_vel_max",
				"eccentric_watt_avg",
				"eccentric_watt_max",
				"workout_sessions!inner(started_at, local_profile_id, name)",
			].join(", "),
		);
		expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(chain.eq).toHaveBeenCalledWith(
			"workout_sessions.local_profile_id",
			"profile-1",
		);
	});
});

describe("vbtAssessmentsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	// PR 38: vbt_assessments is INFERNO-gated in RLS
	// (20260920003800_inferno_read_policies.sql). A FLAME user's request
	// succeeds and comes back with zero rows — PostgREST reports no error for
	// a row-filtered SELECT — so the VBT reader must yield an empty result the
	// UI can render as an empty state, never a rejected query.
	it("returns an empty list, not an error, when RLS filters every row away", async () => {
		chain = buildChain({ data: [], error: null });
		const { vbtAssessmentsOptions } = await import("../analytics");
		const opts = vbtAssessmentsOptions("user-1", "squat");
		await expect(opts.queryFn!({} as never)).resolves.toEqual([]);
		expect(fromFn).toHaveBeenCalledWith("vbt_assessments");
	});

	it("returns the rows an INFERNO subscriber can read", async () => {
		chain = buildChain({
			data: [{ id: "v1", exercise_id: "squat", estimated_1rm_kg: 100 }],
			error: null,
		});
		const { vbtAssessmentsOptions } = await import("../analytics");
		const opts = vbtAssessmentsOptions("user-1", "squat");
		const result = await opts.queryFn!({} as never);
		expect(result).toHaveLength(1);
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
		const result = await opts.queryFn!({} as never);

		expect(result.current).toHaveLength(1);
		expect(result.previous).toHaveLength(1);
		expect(result.current[0].total_volume).toBe(700);
		expect(result.previous[0].total_volume).toBe(600);
	});
});
