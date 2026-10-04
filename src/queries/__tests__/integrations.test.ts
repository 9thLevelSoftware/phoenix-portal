import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: {
	data: unknown;
	error: unknown;
	count?: number | null;
}) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "order", "limit", "in"];
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
		expect(opts.queryKey).toEqual(queryKeys.integrations.byUser("user-1"));
	});

	it("returns integration rows with connection status", async () => {
		chain = buildChain({ data: [integrationRow], error: null });
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		const result = await opts.queryFn?.({} as never);

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
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "auth required" }),
		);
	});

	it("returns empty array when no integrations configured", async () => {
		chain = buildChain({ data: [], error: null });
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toEqual([]);
	});

	it("queries user_integrations table", async () => {
		chain = buildChain({ data: [], error: null });
		const { integrationsOptions } = await import("../integrations");
		const opts = integrationsOptions("user-1");
		await opts.queryFn?.({} as never);
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
		expect(opts.queryKey).toEqual(queryKeys.integrations.external("user-1"));
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
		const result = await opts.queryFn?.({} as never);

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
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "table missing" }),
		);
	});

	it("returns empty array when no activities exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { externalActivitiesOptions } = await import("../integrations");
		const opts = externalActivitiesOptions("user-1");
		const result = await opts.queryFn?.({} as never);
		expect(result).toEqual([]);
	});
});

describe("syncQueueOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses the sync-queue query key and keeps the latest 10", async () => {
		chain = buildChain({ data: [], error: null });
		const { SYNC_QUEUE_ACTIVITY_LIMIT, syncQueueOptions } = await import(
			"../integrations"
		);
		const opts = syncQueueOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.integrations.syncQueue("user-1"));

		await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledWith("sync_queue");
		expect(chain.order).toHaveBeenCalledWith("created_at", {
			ascending: false,
		});
		expect(chain.limit).toHaveBeenCalledWith(SYNC_QUEUE_ACTIVITY_LIMIT);
		expect(chain.in).not.toHaveBeenCalled();
	});

	it("throws on Supabase error instead of an empty activity list", async () => {
		chain = buildChain({ data: null, error: { message: "rls" } });
		const { syncQueueOptions } = await import("../integrations");
		const opts = syncQueueOptions("user-1");
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "rls" }),
		);
	});
});

describe("syncQueueActiveCountOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("counts pending with an exact head query and reads one processing provider", async () => {
		// A row payload must not be the count. head:true returns none, and a
		// paged select would stop at max-rows.
		const pendingChain = buildChain({
			data: [{ id: "should-not-count" }],
			count: 2500,
			error: null,
		});
		const processingChain = buildChain({
			data: [{ provider: "fitbit" }],
			error: null,
		});
		fromFn
			.mockReturnValueOnce(pendingChain)
			.mockReturnValueOnce(processingChain);

		const { syncQueueActiveCountOptions } = await import("../integrations");
		const opts = syncQueueActiveCountOptions("user-1");
		expect(opts.queryKey).toEqual(
			queryKeys.integrations.syncQueueActive("user-1"),
		);
		expect(
			queryKeys.integrations.syncQueueActive("user-1").slice(0, -1),
		).toEqual(queryKeys.integrations.syncQueue("user-1"));

		const result = await opts.queryFn?.({} as never);

		expect(fromFn).toHaveBeenCalledTimes(2);
		expect(fromFn).toHaveBeenCalledWith("sync_queue");
		expect(pendingChain.select).toHaveBeenCalledWith("id", {
			count: "exact",
			head: true,
		});
		expect(pendingChain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(pendingChain.eq).toHaveBeenCalledWith("status", "pending");
		expect(pendingChain.limit).not.toHaveBeenCalled();
		expect(pendingChain.in).not.toHaveBeenCalled();
		expect(processingChain.select).toHaveBeenCalledWith("provider");
		expect(processingChain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(processingChain.eq).toHaveBeenCalledWith("status", "processing");
		expect(processingChain.order).toHaveBeenCalledWith("created_at", {
			ascending: false,
		});
		expect(processingChain.limit).toHaveBeenCalledWith(1);
		expect(processingChain.limit).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			pending: 2500,
			processingProvider: "fitbit",
		});
	});

	it("reports no active work when both lookups are empty", async () => {
		chain = buildChain({ data: null, count: null, error: null });
		const { syncQueueActiveCountOptions } = await import("../integrations");
		const opts = syncQueueActiveCountOptions("user-1");
		await expect(opts.queryFn?.({} as never)).resolves.toEqual({
			pending: 0,
			processingProvider: null,
		});
	});

	it("throws when the pending count fails", async () => {
		const pendingChain = buildChain({
			data: null,
			count: null,
			error: { message: "unavailable" },
		});
		const processingChain = buildChain({
			data: [{ provider: "fitbit" }],
			error: null,
		});
		fromFn
			.mockReturnValueOnce(pendingChain)
			.mockReturnValueOnce(processingChain);
		const { syncQueueActiveCountOptions } = await import("../integrations");
		const opts = syncQueueActiveCountOptions("user-1");
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "unavailable" }),
		);
	});

	it("throws when the processing lookup fails", async () => {
		const pendingChain = buildChain({ data: null, count: 3, error: null });
		const processingChain = buildChain({
			data: null,
			error: { message: "unavailable" },
		});
		fromFn
			.mockReturnValueOnce(pendingChain)
			.mockReturnValueOnce(processingChain);
		const { syncQueueActiveCountOptions } = await import("../integrations");
		const opts = syncQueueActiveCountOptions("user-1");
		await expect(opts.queryFn?.({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "unavailable" }),
		);
	});
});
