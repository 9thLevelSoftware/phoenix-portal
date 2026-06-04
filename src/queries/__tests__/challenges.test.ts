import { beforeEach, describe, expect, it, vi } from "vitest";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "gte", "lte", "order"];
	for (const method of methods) {
		self[method] = vi.fn();
	}
	for (const method of methods) {
		self[method].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

describe("challengeProgressOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("counts phase-specific personal record rows separately for PR challenges", async () => {
		chain = buildChain({
			data: [
				{ id: "combined-pr" },
				{ id: "concentric-pr" },
				{ id: "eccentric-pr" },
			],
			error: null,
		});

		const { challengeProgressOptions } = await import("../challenges");
		const opts = challengeProgressOptions(
			"user-1",
			"challenge-1",
			"pr_count",
			3,
			"2026-05-01T00:00:00Z",
			"2026-05-31T23:59:59Z",
		);

		const result = await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledWith("personal_records");
		expect(result).toEqual({ current: 3, target: 3, percentage: 100 });
	});
});
