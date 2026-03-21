import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: Record<string, unknown>) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "order", "in", "maybeSingle"];
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
		const result = await opts.queryFn!({} as never);

		expect(result).not.toBeNull();
		expect(result!.display_name).toBe("Phoenix User");
		expect(result!.weight_unit).toBe("kg");
	});

	it("returns null when profile does not exist (maybeSingle)", async () => {
		chain = buildChain({ data: null, error: null });
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toBeNull();
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "profile error" },
		});
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "profile error" }),
		);
	});

	it("queries the profiles table", async () => {
		chain = buildChain({ data: null, error: null });
		const { profileOptions } = await import("../profile");
		const opts = profileOptions("user-1");
		await opts.queryFn!({} as never);
		expect(fromFn).toHaveBeenCalledWith("profiles");
	});
});

describe("profileStatsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.stats query key", async () => {
		chain = buildChain({ data: [], error: null, count: 0 });
		const { profileStatsOptions } = await import("../profile");
		const opts = profileStatsOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.stats("user-1"));
	});

	it("computes stats with doubled volume and streak", async () => {
		const sessions = [
			{ started_at: "2026-03-15T08:00:00Z", total_volume: 500 },
			{ started_at: "2026-03-16T08:00:00Z", total_volume: 600 },
			{ started_at: "2026-03-17T08:00:00Z", total_volume: 400 },
		];

		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return buildChain({ data: sessions, error: null });
			// PR count query uses { count: "exact", head: true }
			return buildChain({ data: null, error: null, count: 5 });
		});

		const { profileStatsOptions } = await import("../profile");
		const opts = profileStatsOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result.totalWorkouts).toBe(3);
		// total_volume is per-cable, doubled: (500+600+400)*2 = 3000
		expect(result.totalVolume).toBe(3000);
		// 3 consecutive days = streak of 3
		expect(result.bestStreak).toBe(3);
		expect(result.prCount).toBe(5);
	});

	it("returns zeros when user has no sessions", async () => {
		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return buildChain({ data: [], error: null });
			return buildChain({ data: null, error: null, count: 0 });
		});

		const { profileStatsOptions } = await import("../profile");
		const opts = profileStatsOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result.totalWorkouts).toBe(0);
		expect(result.totalVolume).toBe(0);
		expect(result.bestStreak).toBe(0);
		expect(result.prCount).toBe(0);
	});
});

describe("topExercisesOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("uses profile.topExercises query key", async () => {
		chain = buildChain({ data: [], error: null });
		const { topExercisesOptions } = await import("../profile");
		const opts = topExercisesOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.profile.topExercises("user-1"));
	});

	it("returns top 5 exercises by frequency", async () => {
		const sessions = [{ id: "s1" }, { id: "s2" }];
		const exercises = [
			{ name: "Bench Press" },
			{ name: "Bench Press" },
			{ name: "Bench Press" },
			{ name: "Squat" },
			{ name: "Squat" },
			{ name: "Row" },
			{ name: "Deadlift" },
			{ name: "OHP" },
			{ name: "Curl" },
		];

		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return buildChain({ data: sessions, error: null });
			return buildChain({ data: exercises, error: null });
		});

		const { topExercisesOptions } = await import("../profile");
		const opts = topExercisesOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(5);
		expect(result[0].name).toBe("Bench Press");
		expect(result[0].count).toBe(3);
		expect(result[1].name).toBe("Squat");
		expect(result[1].count).toBe(2);
	});

	it("returns empty array when no sessions exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { topExercisesOptions } = await import("../profile");
		const opts = topExercisesOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
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
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].badge_name).toBe("First Flame");
		expect(result[0].earned_at).toBeInstanceOf(Date);
		expect(result[0].badge_tier).toBe("bronze");
	});

	it("returns empty array when no badges earned", async () => {
		chain = buildChain({ data: [], error: null });
		const { earnedBadgesOptions } = await import("../profile");
		const opts = earnedBadgesOptions("user-1");
		const result = await opts.queryFn!({} as never);
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
		const result = await opts.queryFn!({} as never);

		expect(result).not.toBeNull();
		expect(result!.strength).toBe(25);
		expect(result!.level).toBe(5);
		expect(result!.character_class).toBe("warrior");
		expect(result!.updated_at).toBeInstanceOf(Date);
	});

	it("returns null when no RPG data exists (maybeSingle)", async () => {
		chain = buildChain({ data: null, error: null });
		const { rpgAttributesOptions } = await import("../profile");
		const opts = rpgAttributesOptions("user-1");
		const result = await opts.queryFn!({} as never);
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
		const result = await opts.queryFn!({} as never);

		expect(result).not.toBeNull();
		expect(result!.total_workouts).toBe(50);
		expect(result!.longest_streak).toBe(14);
		expect(result!.current_streak).toBe(3);
		expect(result!.updated_at).toBeInstanceOf(Date);
	});

	it("returns null when no gamification data exists", async () => {
		chain = buildChain({ data: null, error: null });
		const { gamificationStatsOptions } = await import("../profile");
		const opts = gamificationStatsOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toBeNull();
	});
});
