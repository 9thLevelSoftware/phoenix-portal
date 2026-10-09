import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	SUPABASE_FILTER_CHUNK_SIZE,
	SUPABASE_PAGE_SIZE,
} from "@/lib/supabasePaging";

function uuid(n: number): string {
	return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function comment(i: number, userId = uuid(2)) {
	return {
		id: uuid(i + 1),
		item_id: uuid(9),
		item_type: "routine" as const,
		user_id: userId,
		body: `comment ${i}`,
		created_at: "2026-03-17T10:00:00.000Z",
		updated_at: "2026-03-17T10:00:00.000Z",
		deleted_at: null,
	};
}

/** `.range(from)` resolves the page for that offset. */
function cappedChain(pages: unknown[][]) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "is", "order"]) {
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

const profilesQuery = {
	select: vi.fn(),
	in: vi.fn(),
};

const from = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from,
	},
}));

beforeEach(() => {
	vi.clearAllMocks();
	profilesQuery.select.mockReturnValue(profilesQuery);
	profilesQuery.in.mockReturnValue({ data: [], error: null });
});

describe("commentsOptions", () => {
	it("pages comments past the row cap in created_at order", async () => {
		const first = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) =>
			comment(i),
		);
		const tail = comment(SUPABASE_PAGE_SIZE);
		const chain = cappedChain([first, [tail]]);
		from.mockImplementation((table: string) => {
			if (table === "public_profiles") return profilesQuery;
			expect(table).toBe("community_comments");
			return chain;
		});

		const { commentsOptions } = await import("../comments");
		const result = await commentsOptions(uuid(9)).queryFn?.({} as never);

		expect(result).toHaveLength(SUPABASE_PAGE_SIZE + 1);
		expect(result?.[0]?.id).toBe(first[0]?.id);
		expect(result?.at(-1)?.id).toBe(tail.id);
		expect(result?.[0]?.profiles).toBeNull();
		expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
		expect(chain.order).toHaveBeenCalledWith("created_at", {
			ascending: true,
		});
		expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
		expect(chain.range).toHaveBeenCalledTimes(2);
	});

	it("chunks comment author profile ids at the shared filter size", async () => {
		const rows = Array.from(
			{ length: SUPABASE_FILTER_CHUNK_SIZE + 1 },
			(_, i) => comment(i, uuid(50_000 + i)),
		);
		const chain = cappedChain([rows]);
		from.mockImplementation((table: string) => {
			if (table === "public_profiles") return profilesQuery;
			return chain;
		});

		const { commentsOptions } = await import("../comments");
		await commentsOptions(uuid(9)).queryFn?.({} as never);

		const chunks = profilesQuery.in.mock.calls.map(
			(call) => call[1] as string[],
		);
		expect(chunks.map((chunk) => chunk.length)).toEqual([
			SUPABASE_FILTER_CHUNK_SIZE,
			1,
		]);
	});
});
