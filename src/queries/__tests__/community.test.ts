import { describe, expect, it, vi } from "vitest";

const feedRows = [
	{
		id: "11111111-1111-4111-8111-111111111111",
		user_id: "22222222-2222-4222-8222-222222222222",
		routine_id: "33333333-3333-4333-8333-333333333333",
		name: "Push Day",
		description: "Chest and shoulders",
		exercise_count: 6,
		estimated_duration: 45,
		exercises_snapshot: [],
		tags: ["Chest"],
		difficulty: "Beginner",
		vote_count: 3,
		save_count: 1,
		hot_score: 12,
		comment_count: 0,
		shared_at: "2026-03-17T10:00:00.000Z",
		updated_at: "2026-03-17T10:00:00.000Z",
	},
];

const profileRows = [
	{
		id: "22222222-2222-4222-8222-222222222222",
		display_name: "Coach Phoenix",
		avatar_url: "https://example.com/avatar.png",
	},
];

const feedQuery = {
	select: vi.fn(),
	order: vi.fn(),
	eq: vi.fn(),
	contains: vi.fn(),
	ilike: vi.fn(),
	range: vi.fn(),
};

feedQuery.select.mockReturnValue(feedQuery);
feedQuery.order.mockReturnValue(feedQuery);
feedQuery.eq.mockReturnValue(feedQuery);
feedQuery.contains.mockReturnValue(feedQuery);
feedQuery.ilike.mockReturnValue(feedQuery);
feedQuery.range.mockReturnValue({ data: feedRows, error: null });

const profilesQuery = {
	select: vi.fn(),
	in: vi.fn(),
};

profilesQuery.select.mockReturnValue(profilesQuery);
profilesQuery.in.mockReturnValue({ data: profileRows, error: null });

const from = vi.fn((table: string) => {
	if (table === "public_profiles") return profilesQuery;
	return feedQuery;
});

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from,
	},
}));

describe("communityFeedOptions", () => {
	it("fetches feed rows and hydrates creator profiles in a second query", async () => {
		const { communityFeedOptions } = await import("../community");
		const options = communityFeedOptions({
			tab: "routines",
			sort: "hot",
		});

		const result = await options.queryFn?.({ pageParam: 0 } as never);

		expect(from).toHaveBeenCalledWith("shared_routines");
		expect(feedQuery.select).toHaveBeenCalledWith(
			expect.not.stringContaining("exercises_snapshot"),
		);
		expect(feedQuery.range).toHaveBeenCalledWith(0, 19);
		expect(from).toHaveBeenCalledWith("public_profiles");
		expect(profilesQuery.select).toHaveBeenCalledWith(
			"id, display_name, avatar_url",
		);
		expect(profilesQuery.in).toHaveBeenCalledWith("id", [
			"22222222-2222-4222-8222-222222222222",
		]);
		expect(result[0]?.profiles).toEqual({
			display_name: "Coach Phoenix",
			avatar_url: "https://example.com/avatar.png",
		});
	});
});
