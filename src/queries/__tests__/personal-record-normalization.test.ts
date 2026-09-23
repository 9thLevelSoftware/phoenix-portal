import { beforeEach, describe, expect, it, vi } from "vitest";

const query = {
	select: vi.fn(),
	eq: vi.fn(),
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
		query.order.mockReturnValue(query);
	});

	it("pages the user-wide exercise lookup past the PostgREST row cap", async () => {
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
	});
});
