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

const integrationRow = {
	id: "11111111-1111-4111-8111-111111111111",
	user_id: "22222222-2222-4222-8222-222222222222",
	provider: "strava",
	provider_user_id: "strava-12345",
	connected_at: "2026-03-01T00:00:00Z",
	last_sync_at: "2026-03-17T12:00:00Z",
	status: "connected",
	error_message: null,
};

const externalActivityRow = {
	id: "aaaa1111-1111-4111-8111-111111111111",
	user_id: "22222222-2222-4222-8222-222222222222",
	external_id: "strava-run-1",
	provider: "strava",
	name: "Morning Run",
	activity_type: "Run",
	started_at: "2026-03-17T07:00:00Z",
	duration_seconds: 1800,
	distance_meters: 5000,
	calories: 350,
	avg_heart_rate: 145,
	max_heart_rate: 172,
	elevation_gain_meters: 50,
	raw_data: {},
	synced_at: "2026-03-17T12:00:00Z",
};

// --- Tests ----------------------------------------------------------------

describe("integrationsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses integrations.byUser query key", async () => {
		chain = buildChain({ data: [], error: null });
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.integrations.byUser("user-1"),
		);
	});

	it("returns integration rows with connection status", async () => {
		chain = buildChain({ data: [integrationRow], error: null });
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].provider).toBe("strava");
		expect(result[0].status).toBe("connected");
		expect(result[0].error_message).toBeNull();
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "auth required" },
		});
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "auth required" }),
		);
	});

	it("returns empty array when no integrations configured", async () => {
		chain = buildChain({ data: [], error: null });
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});

	it("queries user_integrations table", async () => {
		chain = buildChain({ data: [], error: null });
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		await opts.queryFn!({} as never);
		expect(fromFn).toHaveBeenCalledWith("user_integrations");
	});
});

describe("externalActivitiesOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses integrations.external query key without provider", async () => {
		chain = buildChain({ data: [], error: null });
		const { externalActivitiesOptions } = await import("../integrations");
		const opts = externalActivitiesOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.integrations.external("user-1"),
		);
	});

	it("appends provider to query key when specified", async () => {
		chain = buildChain({ data: [], error: null });
		const { externalActivitiesOptions } = await import("../integrations");
		const opts = externalActivitiesOptions("user-1", "strava");
		expect(opts.queryKey).toEqual([
			...queryKeys.integrations.external("user-1"),
			"strava",
		]);
	});

	it("returns external activity rows", async () => {
		chain = buildChain({
			data: [externalActivityRow],
			error: null,
		});
		const { externalActivitiesOptions } = await import("../integrations");
		const opts = externalActivitiesOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Morning Run");
		expect(result[0].provider).toBe("strava");
		expect(result[0].distance_meters).toBe(5000);
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "table missing" },
		});
		const { externalActivitiesOptions } = await import("../integrations");
		const opts = externalActivitiesOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "table missing" }),
		);
	});

	it("returns empty array when no activities exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { externalActivitiesOptions } = await import("../integrations");
		const opts = externalActivitiesOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});
});
