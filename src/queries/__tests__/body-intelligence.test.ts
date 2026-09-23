import { beforeEach, describe, expect, it, vi } from "vitest";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "gte"]) {
		self[method] = vi.fn().mockReturnValue(self);
	}
	self.gte.mockReturnValue({ ...self, ...terminal });
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

describe("bodyIntelligenceOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		chain = buildChain({ data: [], error: null });
	});

	it("selects catalog exercise IDs for detailed body-muscle mapping", async () => {
		const { bodyIntelligenceOptions } = await import("../body-intelligence");
		const opts = bodyIntelligenceOptions("user-1");

		await opts.queryFn?.({} as never);

		expect(chain.select).toHaveBeenCalledWith(
			expect.stringContaining("id, exercise_id, name"),
		);
	});
});
