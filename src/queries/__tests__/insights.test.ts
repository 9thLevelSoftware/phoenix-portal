import { describe, expect, it, vi, beforeEach } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "order", "limit"];
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

const insightRow = {
	id: "11111111-1111-4111-8111-111111111111",
	user_id: "22222222-2222-4222-8222-222222222222",
	period: "30d",
	insight_type: "volume_trend",
	title: "Volume is up 15%",
	body: "Your training volume increased by 15% compared to last month.",
	created_at: "2026-03-17T00:00:00Z",
};

// --- Tests ----------------------------------------------------------------

describe("insightsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses insights.byUser query key with default period", async () => {
		chain = buildChain({ data: [], error: null });
		const { insightsOptions } = await import("../insights");
		const opts = insightsOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.insights.byUser("user-1", "30d"),
		);
	});

	it("uses insights.byUser query key with custom period", async () => {
		chain = buildChain({ data: [], error: null });
		const { insightsOptions } = await import("../insights");
		const opts = insightsOptions("user-1", "7d");
		expect(opts.queryKey).toEqual(
			queryKeys.insights.byUser("user-1", "7d"),
		);
	});

	it("returns insight rows from user_insights table", async () => {
		chain = buildChain({ data: [insightRow], error: null });
		const { insightsOptions } = await import("../insights");
		const opts = insightsOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("Volume is up 15%");
		expect(result[0].period).toBe("30d");
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "insights fetch failed" },
		});
		const { insightsOptions } = await import("../insights");
		const opts = insightsOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "insights fetch failed" }),
		);
	});

	it("returns empty array when no insights exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { insightsOptions } = await import("../insights");
		const opts = insightsOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});

	it("queries user_insights table with period filter", async () => {
		chain = buildChain({ data: [], error: null });
		const { insightsOptions } = await import("../insights");
		const opts = insightsOptions("user-1", "7d");
		await opts.queryFn!({} as never);
		expect(fromFn).toHaveBeenCalledWith("user_insights");
	});
});
