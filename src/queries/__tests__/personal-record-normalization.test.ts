import { beforeEach, describe, expect, it, vi } from "vitest";

const query = {
	select: vi.fn(),
	eq: vi.fn(),
	in: vi.fn(),
	order: vi.fn(),
	range: vi.fn(),
};
const from = vi.fn(() => query);

vi.mock("@/lib/supabase", () => ({ supabase: { from } }));

describe("resolvePersonalRecordDisplayNames", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		query.select.mockReturnValue(query);
		query.eq.mockReturnValue(query);
		query.in.mockReturnValue(query);
		query.order.mockReturnValue(query);
	});

	it("pages a session chunk's exercise lookup past the PostgREST row cap", async () => {
		const firstPage = Array.from({ length: 1000 }, (_, index) => ({
			id: `exercise-${index}`,
			session_id: `session-${index}`,
			name: `Exercise ${index}`,
			exercise_id: null,
			catalog: null,
		}));
		query.range.mockImplementation((fromIndex: number) =>
			Promise.resolve({
				data:
					fromIndex === 0
						? firstPage
						: [
								{
									id: "exercise-tail-123",
									session_id: "session-tail",
									name: "Tail exercise",
									exercise_id: null,
									catalog: null,
								},
							],
				error: null,
			}),
		);
		const { resolvePersonalRecordDisplayNames } = await import(
			"../personal-record-normalization"
		);

		const result = await resolvePersonalRecordDisplayNames(
			[
				{
					exercise_name: "exercise-tail-123",
					session_id: "session-tail",
				},
			],
			"user-1",
		);

		expect(query.range).toHaveBeenNthCalledWith(1, 0, 999);
		expect(query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
		expect(query.order).toHaveBeenCalledWith("session_id", { ascending: true });
		expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
		// The name only exists on the second page: an unpaged read loses it.
		expect(result[0]?.exercise_name).toBe("Tail exercise");
		expect(query.in).toHaveBeenCalledWith("session_id", ["session-tail"]);
	});

	it("reads only the page's sessions, in bounded chunks, never the whole history", async () => {
		query.range.mockResolvedValue({ data: [], error: null });
		const rows = Array.from({ length: 250 }, (_, index) => ({
			exercise_name: `exercise-row-${index}`,
			session_id: `session-${index}`,
		}));
		const { resolvePersonalRecordDisplayNames } = await import(
			"../personal-record-normalization"
		);

		await resolvePersonalRecordDisplayNames(rows, "user-1");

		// 250 sessions -> three `.in()` reads of at most 100 ids each, and each
		// chunk is its own query (one short page apiece).
		const chunks = query.in.mock.calls.map((call) => call[1] as string[]);
		expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
		expect(chunks.flat()).toEqual(rows.map((row) => row.session_id));
		expect(query.range).toHaveBeenCalledTimes(3);
		expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
	});
});
