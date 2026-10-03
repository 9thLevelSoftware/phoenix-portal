import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	SUPABASE_FILTER_CHUNK_SIZE,
	SUPABASE_PAGE_SIZE,
} from "@/lib/supabasePaging";

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

const from = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from,
	},
}));

function uuid(n: number): string {
	return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** `.range(from)` resolves the page for that offset. */
function cappedChain(pages: unknown[][]) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of [
		"select",
		"eq",
		"is",
		"in",
		"order",
		"contains",
		"ilike",
	]) {
		self[method] = vi.fn(() => self);
	}
	self.range = vi.fn((from: number) =>
		Promise.resolve({
			data: pages[Math.floor(from / SUPABASE_PAGE_SIZE)] ?? [],
			error: null,
		}),
	);
	return self;
}

beforeEach(() => {
	vi.clearAllMocks();
	feedQuery.select.mockReturnValue(feedQuery);
	feedQuery.order.mockReturnValue(feedQuery);
	feedQuery.eq.mockReturnValue(feedQuery);
	feedQuery.contains.mockReturnValue(feedQuery);
	feedQuery.ilike.mockReturnValue(feedQuery);
	feedQuery.range.mockReturnValue({ data: feedRows, error: null });
	profilesQuery.select.mockReturnValue(profilesQuery);
	profilesQuery.in.mockReturnValue({ data: profileRows, error: null });
	from.mockImplementation((table: string) => {
		if (table === "public_profiles") return profilesQuery;
		return feedQuery;
	});
});

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

	it("chunks creator profile ids at the shared filter size", async () => {
		const rows = Array.from(
			{ length: SUPABASE_FILTER_CHUNK_SIZE + 1 },
			(_, i) => ({
				...feedRows[0],
				id: uuid(i + 1),
				user_id: uuid(10_000 + i),
			}),
		);
		feedQuery.range.mockReturnValue({ data: rows, error: null });
		profilesQuery.in.mockReturnValue({ data: [], error: null });

		const { communityFeedOptions } = await import("../community");
		await communityFeedOptions({
			tab: "routines",
			sort: "new",
		}).queryFn?.({ pageParam: 0 } as never);

		const chunks = profilesQuery.in.mock.calls.map(
			(call) => call[1] as string[],
		);
		expect(chunks.map((chunk) => chunk.length)).toEqual([
			SUPABASE_FILTER_CHUNK_SIZE,
			1,
		]);
	});
});

describe("userVotesOptions", () => {
	it("pages a user's votes past the row cap", async () => {
		const first = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => vote(i));
		const tail = vote(SUPABASE_PAGE_SIZE);
		const chain = cappedChain([first, [tail]]);
		from.mockImplementation((table: string) => {
			expect(table).toBe("community_votes");
			return chain;
		});

		const { userVotesOptions } = await import("../community");
		const result = await userVotesOptions("user-1").queryFn?.({} as never);

		expect(result?.size).toBe(SUPABASE_PAGE_SIZE + 1);
		expect(result?.has(tail.item_id)).toBe(true);
		expect(chain.range).toHaveBeenCalledWith(0, SUPABASE_PAGE_SIZE - 1);
		expect(chain.range).toHaveBeenCalledWith(
			SUPABASE_PAGE_SIZE,
			SUPABASE_PAGE_SIZE * 2 - 1,
		);
		expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
	});

	it("rejects when a later vote page fails", async () => {
		const full = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => vote(i));
		const chain = cappedChain([full]);
		chain.range.mockImplementation((from: number) =>
			Promise.resolve(
				from === 0
					? { data: full, error: null }
					: { data: null, error: new Error("vote page failed") },
			),
		);
		from.mockImplementation(() => chain);

		const { userVotesOptions } = await import("../community");
		await expect(
			userVotesOptions("user-1").queryFn?.({} as never),
		).rejects.toThrow("vote page failed");
	});
});

describe("savedItemsOptions", () => {
	it("pages a user's saves past the row cap in saved_at order", async () => {
		const first = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => save(i));
		const tail = save(SUPABASE_PAGE_SIZE);
		const chain = cappedChain([first, [tail]]);
		from.mockImplementation((table: string) => {
			expect(table).toBe("saved_community_items");
			return chain;
		});

		const { savedItemsOptions } = await import("../community");
		const result = await savedItemsOptions("user-1").queryFn?.({} as never);

		expect(result).toHaveLength(SUPABASE_PAGE_SIZE + 1);
		expect(result?.[0]?.id).toBe(first[0]?.id);
		expect(result?.at(-1)?.shared_item_id).toBe(tail.shared_item_id);
		expect(chain.order).toHaveBeenCalledWith("saved_at", {
			ascending: false,
		});
		expect(chain.order).toHaveBeenCalledWith("id", { ascending: false });
		expect(chain.range).toHaveBeenCalledTimes(2);
	});
});

function vote(i: number) {
	return {
		id: uuid(i + 1),
		user_id: uuid(1),
		item_id: uuid(1_000_000 + i),
		item_type: "routine" as const,
		created_at: "2026-03-17T10:00:00.000Z",
	};
}

function save(i: number) {
	return {
		id: uuid(i + 1),
		user_id: uuid(1),
		shared_item_id: uuid(2_000_000 + i),
		item_type: "routine" as const,
		imported_routine_id: null,
		imported_cycle_id: null,
		saved_at: "2026-03-17T10:00:00.000Z",
	};
}
