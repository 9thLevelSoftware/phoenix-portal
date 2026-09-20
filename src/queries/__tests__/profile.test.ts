import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: Record<string, unknown>) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "is", "order", "in", "maybeSingle"];
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
const rpcFn = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (...args: unknown[]) => fromFn(...args),
		rpc: (...args: unknown[]) => rpcFn(...args),
	},
}));

function mockRpc(result: { data: unknown; error: unknown }) {
	rpcFn.mockResolvedValue(result);
}

/** Pin the "browser" zone so UTC-only assertions cannot pass by accident. */
function stubTimeZone(timeZone: string) {
	return vi
		.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
		.mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);
}

// --- Test data ------------------------------------------------------------

const profileRow = {
	display_name: "Phoenix User",
	avatar_url: "https://example.com/avatar.png",
	created_at: "2026-01-01T00:00:00Z",
	weight_unit: "kg",
	email_digests: true,
	push_notifications: false,
	streak_reminders: true,
	challenge_updates: true,
	profile_visible: true,
	leaderboard_participation: false,
};

const badgeRow = {
	user_id: "22222222-2222-4222-8222-222222222222",
	badge_id: "first-workout",
	badge_name: "First Flame",
	badge_description: "Complete your first workout",
	badge_tier: "bronze",
	earned_at: "2026-01-15T10:00:00Z",
};

const rpgRow = {
	user_id: "22222222-2222-4222-8222-222222222222",
	strength: 25,
	power: 18,
	stamina: 30,
	consistency: 22,
	mastery: 15,
	character_class: "warrior",
	level: 5,
	experience_points: 1250,
	updated_at: "2026-03-17T00:00:00Z",
};

const gamificationRow = {
	user_id: "22222222-2222-4222-8222-222222222222",
	total_workouts: 50,
	total_reps: 5000,
	total_volume_kg: 150000,
	longest_streak: 14,
	current_streak: 3,
	total_time_seconds: 108000,
	updated_at: "2026-03-17T00:00:00Z",
};

// --- Tests ----------------------------------------------------------------

describe("profileOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.byUser query key", async () => {
		chain = buildChain({ data: null, error: null });
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.byUser("user-1"));
	});

	it("returns profile data", async () => {
		chain = buildChain({ data: profileRow, error: null });
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		const result = await opts.queryFn?.({} as never);

		expect(result).not.toBeNull();
		expect(result?.display_name).toBe("Phoenix User");
		expect(result?.weight_unit).toBe("kg");
	});

	it("returns null when profile does not exist (maybeSingle)", async () => {
		chain = buildChain({ data: null, error: null });
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toBeNull();
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "profile error" },
		});
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "profile error" }),
		);
	});

	it("queries the profiles table", async () => {
		chain = buildChain({ data: null, error: null });
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		await opts.queryFn?.({} as never);
		expect(fromFn).toHaveBeenCalledWith("profiles");
	});
});

describe("profileStatsOptions", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.stats query key", async () => {
		mockRpc({ data: [], error: null });
		const { profileStatsOptions } = await import("../profile");
		const opts = profileStatsOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.stats("user-1"));
	});

	it("reads the stats from one SQL aggregate, above the 1,000-row read cap", async () => {
		// The old implementation counted `sessions.length` over an ascending,
		// unbounded select, so it reported exactly 1,000 workouts (and computed
		// volume and the best streak from the OLDEST 1,000 rows) from 1,000
		// sessions on (F-034).
		const tz = stubTimeZone("America/New_York");
		mockRpc({
			data: [
				{
					total_workouts: 1500,
					total_volume: 1500,
					best_streak: 12,
					pr_count: 1100,
				},
			],
	it("computes stats with per-cable volume and streak", async () => {
		const sessions = [
			{ started_at: "2026-03-15T08:00:00Z", total_volume: 500 },
			{ started_at: "2026-03-16T08:00:00Z", total_volume: 600 },
			{ started_at: "2026-03-17T08:00:00Z", total_volume: 400 },
		];

		const sessionsChain = buildChain({ data: sessions, error: null });
		const personalRecordsChain = buildChain({
			data: null,
			error: null,
		});

		const { profileStatsOptions } = await import("../profile");
		const result = await profileStatsOptions("user-1", "profile-1").queryFn?.(
			{} as never,
		);

		expect(rpcFn).toHaveBeenCalledTimes(1);
		expect(rpcFn).toHaveBeenCalledWith("profile_workout_stats", {
			// UTC on purpose: best_streak is account-wide and the current streak
			// beside it (useStreak/utcDateKey) is UTC-only, so the browser zone
			// here could make the current streak exceed the best one.
			p_tz: "UTC",
			p_profile_id: "profile-1",
		});
		expect(fromFn).not.toHaveBeenCalled();
		expect(result.totalWorkouts).toBe(1500);
		// KD-8: the stored per-cable volume is returned as-is, never doubled.
		expect(result.totalVolume).toBe(1500);
		expect(result.bestStreak).toBe(12);
		expect(result.prCount).toBe(1100);
		tz.mockRestore();
		expect(result.totalWorkouts).toBe(3);
		// total_volume is per cable, summed as stored (KD-8): 500+600+400
		expect(result.totalVolume).toBe(1500);
		// 3 consecutive days = streak of 3
		expect(result.bestStreak).toBe(3);
		expect(result.prCount).toBe(5);
		expect(personalRecordsChain.is).toHaveBeenCalledWith("deleted_at", null);
	});

	it("omits the profile argument instead of passing null", async () => {
		mockRpc({ data: [], error: null });
		const { profileStatsOptions } = await import("../profile");
		await profileStatsOptions("user-1", null).queryFn?.({} as never);
		expect(rpcFn).toHaveBeenCalledWith("profile_workout_stats", {
			p_tz: "UTC",
		});
	});

	it("returns zeros when user has no sessions", async () => {
		mockRpc({ data: [], error: null });

		const { profileStatsOptions } = await import("../profile");
		const opts = profileStatsOptions("user-1");
		const result = await opts.queryFn?.({} as never);

		expect(result.totalWorkouts).toBe(0);
		expect(result.totalVolume).toBe(0);
		expect(result.bestStreak).toBe(0);
		expect(result.prCount).toBe(0);
	});

	it("throws on RPC error", async () => {
		mockRpc({ data: null, error: { message: "stats failed" } });
		const { profileStatsOptions } = await import("../profile");
		await expect(
			profileStatsOptions("user-1").queryFn?.({} as never),
		).rejects.toEqual(expect.objectContaining({ message: "stats failed" }));
	});
});

describe("topExercisesOptions", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.topExercises query key", async () => {
		mockRpc({ data: [], error: null });
		const { topExercisesOptions } = await import("../profile");
		const opts = topExercisesOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.topExercises("user-1"));
	});

	it("returns the top 5 exercises from one RPC with no session id list", async () => {
		// Ordered by the RPC (sessions DESC, name ASC); the first entry is counted
		// over 1,200 sessions, which the old "every session id, then .in()" read
		// could neither address (URL limit) nor count (1,000-row cap).
		mockRpc({
			data: [
				{ exercise_name: "Bench Press", muscle_group: "Chest", sessions: 1200 },
				{ exercise_name: "Squat", muscle_group: "Legs", sessions: 900 },
				{ exercise_name: "Row", muscle_group: "Back", sessions: 3 },
				{ exercise_name: "Deadlift", muscle_group: "Back", sessions: 2 },
				{ exercise_name: "OHP", muscle_group: "Shoulders", sessions: 2 },
				{ exercise_name: "Curl", muscle_group: "Arms", sessions: 1 },
			],
			error: null,
		});

		const { topExercisesOptions } = await import("../profile");
		const result = await topExercisesOptions("user-1", "profile-1").queryFn?.(
			{} as never,
		);

		expect(rpcFn).toHaveBeenCalledTimes(1);
		expect(rpcFn).toHaveBeenCalledWith("exercise_frequency", {
			p_profile_id: "profile-1",
		});
		expect(fromFn).not.toHaveBeenCalled();
		expect(result).toHaveLength(5);
		expect(result[0]).toEqual({ name: "Bench Press", count: 1200 });
		expect(result[1]).toEqual({ name: "Squat", count: 900 });
		expect(result.some((row) => row.name === "Curl")).toBe(false);
	});

	it("omits the profile argument instead of passing null", async () => {
		mockRpc({ data: [], error: null });
		const { topExercisesOptions } = await import("../profile");
		await topExercisesOptions("user-1", null).queryFn?.({} as never);
		expect(rpcFn).toHaveBeenCalledWith("exercise_frequency", {});
	});

	it("returns empty array when no sessions exist", async () => {
		mockRpc({ data: [], error: null });
		const { topExercisesOptions } = await import("../profile");
		const opts = topExercisesOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toEqual([]);
	});

	it("throws on RPC error", async () => {
		mockRpc({ data: null, error: { message: "frequency failed" } });
		const { topExercisesOptions } = await import("../profile");
		await expect(
			topExercisesOptions("user-1").queryFn?.({} as never),
		).rejects.toEqual(expect.objectContaining({ message: "frequency failed" }));
	});
});

describe("earnedBadgesOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.badges query key", async () => {
		chain = buildChain({ data: [], error: null });
		const { earnedBadgesOptions } = await import("../profile");
		const opts = earnedBadgesOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.badges("user-1"));
	});

	it("returns Zod-transformed badges with Date conversion", async () => {
		chain = buildChain({ data: [badgeRow], error: null });
		const { earnedBadgesOptions } = await import("../profile");
		const opts = earnedBadgesOptions("user-1");
		const result = await opts.queryFn?.({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].badge_name).toBe("First Flame");
		expect(result[0].earned_at).toBeInstanceOf(Date);
		expect(result[0].badge_tier).toBe("bronze");
	});

	it("returns empty array when no badges earned", async () => {
		chain = buildChain({ data: [], error: null });
		const { earnedBadgesOptions } = await import("../profile");
		const opts = earnedBadgesOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toEqual([]);
	});
});

describe("rpgAttributesOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.rpg query key", async () => {
		chain = buildChain({ data: null, error: null });
		const { rpgAttributesOptions } = await import("../profile");
		const opts = rpgAttributesOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.rpg("user-1"));
	});

	it("returns Zod-transformed RPG attributes", async () => {
		chain = buildChain({ data: rpgRow, error: null });
		const { rpgAttributesOptions } = await import("../profile");
		const opts = rpgAttributesOptions("user-1");
		const result = await opts.queryFn?.({} as never);

		expect(result).not.toBeNull();
		expect(result?.strength).toBe(25);
		expect(result?.level).toBe(5);
		expect(result?.character_class).toBe("warrior");
		expect(result?.updated_at).toBeInstanceOf(Date);
	});

	it("returns null when no RPG data exists (maybeSingle)", async () => {
		chain = buildChain({ data: null, error: null });
		const { rpgAttributesOptions } = await import("../profile");
		const opts = rpgAttributesOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toBeNull();
	});
});

describe("gamificationStatsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.gamification query key", async () => {
		chain = buildChain({ data: null, error: null });
		const { gamificationStatsOptions } = await import("../profile");
		const opts = gamificationStatsOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.gamification("user-1"));
	});

	it("returns Zod-transformed gamification stats", async () => {
		chain = buildChain({ data: gamificationRow, error: null });
		const { gamificationStatsOptions } = await import("../profile");
		const opts = gamificationStatsOptions("user-1");
		const result = await opts.queryFn?.({} as never);

		expect(result).not.toBeNull();
		expect(result?.total_workouts).toBe(50);
		expect(result?.longest_streak).toBe(14);
		expect(result?.current_streak).toBe(3);
		expect(result?.updated_at).toBeInstanceOf(Date);
	});

	it("returns null when no gamification data exists", async () => {
		chain = buildChain({ data: null, error: null });
		const { gamificationStatsOptions } = await import("../profile");
		const opts = gamificationStatsOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toBeNull();
	});
});
