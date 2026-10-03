import { beforeEach, describe, expect, it, vi } from "vitest";

function buildChain() {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "gte", "order"]) {
		self[method] = vi.fn().mockReturnValue(self);
	}
	self.range = vi.fn().mockResolvedValue({ data: [], error: null });
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

const MAX_ROWS = 1000;

function exerciseRow(id: string, setCount: number) {
	return {
		id,
		exercise_id: "catalog-1",
		name: "Bench Press",
		muscle_group: "Chest",
		session_id: "session-1",
		sets: Array.from({ length: setCount }, (_, index) => ({
			id: `${id}-set-${index}`,
			actual_reps: 5,
			weight_kg: 100,
		})),
		workout_sessions: {
			id: "session-1",
			started_at: "2026-06-01T12:00:00.000Z",
			user_id: "user-1",
		},
	};
}

describe("bodyIntelligenceOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		chain = buildChain();
	});

	it("selects catalog exercise IDs for detailed body-muscle mapping", async () => {
		const { bodyIntelligenceOptions } = await import("../body-intelligence");
		const opts = bodyIntelligenceOptions("user-1");

		await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledWith("exercises");
		expect(chain.select).toHaveBeenCalledWith(
			expect.stringContaining("id, exercise_id, name"),
		);
		expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
		expect(chain.range).toHaveBeenCalledTimes(1);
	});

	it("pages by id under the PostgREST row cap and keeps setCount", async () => {
		const { BODY_INTELLIGENCE_PAGE_SIZE, bodyIntelligenceOptions } =
			await import("../body-intelligence");
		expect(BODY_INTELLIGENCE_PAGE_SIZE).toBeLessThan(MAX_ROWS);

		const fullPage = Array.from(
			{ length: BODY_INTELLIGENCE_PAGE_SIZE },
			(_, index) => exerciseRow(`ex-${index}`, 2),
		);
		chain.range
			.mockResolvedValueOnce({ data: fullPage, error: null })
			.mockResolvedValueOnce({
				data: [{ ...exerciseRow("ex-tail", 0), sets: null }],
				error: null,
			});

		const rows = await bodyIntelligenceOptions(
			"user-1",
			7,
			"profile-1",
		).queryFn?.({} as never);

		expect(chain.eq).toHaveBeenCalledWith(
			"workout_sessions.local_profile_id",
			"profile-1",
		);
		expect(chain.gte).toHaveBeenCalledWith(
			"workout_sessions.started_at",
			expect.any(String),
		);
		expect(chain.range).toHaveBeenNthCalledWith(
			1,
			0,
			BODY_INTELLIGENCE_PAGE_SIZE - 1,
		);
		expect(chain.range).toHaveBeenNthCalledWith(
			2,
			BODY_INTELLIGENCE_PAGE_SIZE,
			BODY_INTELLIGENCE_PAGE_SIZE * 2 - 1,
		);
		expect(rows).toHaveLength(BODY_INTELLIGENCE_PAGE_SIZE + 1);
		expect(rows?.[0]?.setCount).toBe(2);
		expect(rows?.at(-1)?.setCount).toBe(0);
	});

	it("throws when a page fails", async () => {
		chain.range.mockResolvedValue({
			data: null,
			error: new Error("range failed"),
		});
		const { bodyIntelligenceOptions } = await import("../body-intelligence");

		await expect(
			bodyIntelligenceOptions("user-1").queryFn?.({} as never),
		).rejects.toThrow("range failed");
	});
});
