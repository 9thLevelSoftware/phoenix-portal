import { describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "../../../supabase/functions/_shared/rateLimit.ts";

type RateLimitSupabaseClient = Parameters<typeof checkRateLimit>[0];
type QueryResult = {
	data: unknown;
	error: { code?: string; message: string } | null;
};

class ScriptedQuery {
	private operation: "insert" | "select" | "update" | null = null;

	constructor(
		private readonly nextResult: (
			operation: "insert" | "select" | "update",
		) => QueryResult,
		private readonly calls: string[],
	) {}

	insert(): this {
		this.operation = "insert";
		this.calls.push("insert");
		return this;
	}

	update(): this {
		this.operation = "update";
		this.calls.push("update");
		return this;
	}

	select(): this {
		if (!this.operation) {
			this.operation = "select";
			this.calls.push("select");
		}
		return this;
	}

	eq(): this {
		return this;
	}

	async single(): Promise<QueryResult> {
		return this.resolve();
	}

	async maybeSingle(): Promise<QueryResult> {
		return this.resolve();
	}

	private resolve(): QueryResult {
		if (!this.operation) {
			throw new Error("Query resolved without an operation");
		}
		return this.nextResult(this.operation);
	}
}

function createFallbackSupabase(script: {
	insert: QueryResult[];
	select: QueryResult[];
	update: QueryResult[];
}) {
	const calls: string[] = [];
	const nextResult = (operation: "insert" | "select" | "update") => {
		const next = script[operation].shift();
		if (!next) {
			throw new Error(`No scripted ${operation} result remaining`);
		}
		return next;
	};

	const client = {
		rpc: vi.fn().mockResolvedValue({
			data: null,
			error: {
				code: "42883",
				message: "function check_rate_limit does not exist",
			},
		}),
		from: vi.fn(() => new ScriptedQuery(nextResult, calls)),
	} as unknown as RateLimitSupabaseClient;

	return { client, calls };
}

function trackingRow(requestsThisWindow: number): QueryResult {
	return {
		data: {
			id: "rate-row-1",
			requests_this_window: requestsThisWindow,
			window_started_at: new Date().toISOString(),
		},
		error: null,
	};
}

describe("checkRateLimit fallback optimistic locking", () => {
	it("retries a missed optimistic update and returns 429 when the latest counter is exhausted", async () => {
		const { client, calls } = createFallbackSupabase({
			insert: [
				{ data: null, error: { code: "23505", message: "duplicate key" } },
			],
			select: [trackingRow(1), trackingRow(2)],
			update: [{ data: null, error: null }],
		});

		const result = await checkRateLimit(
			client,
			{
				key: "mobile-sync-push",
				userId: "user-1",
				maxRequests: 2,
				windowSeconds: 60,
			},
			{},
		);

		expect(result.allowed).toBe(false);
		expect(result.response?.status).toBe(429);
		expect(calls.filter((call) => call === "update")).toHaveLength(1);
		expect(calls.filter((call) => call === "select")).toHaveLength(2);
	});

	it("fails closed when repeated optimistic updates do not record the request", async () => {
		const { client, calls } = createFallbackSupabase({
			insert: [
				{ data: null, error: { code: "23505", message: "duplicate key" } },
			],
			select: [trackingRow(1), trackingRow(1), trackingRow(1)],
			update: [
				{ data: null, error: null },
				{ data: null, error: null },
				{ data: null, error: null },
			],
		});

		const result = await checkRateLimit(
			client,
			{
				key: "mobile-sync-push",
				userId: "user-1",
				maxRequests: 10,
				windowSeconds: 60,
			},
			{},
		);

		expect(result.allowed).toBe(false);
		expect(result.response?.status).toBe(503);
		expect(result.response?.headers.get("Retry-After")).toBe("30");
		expect(calls.filter((call) => call === "update")).toHaveLength(3);
	});
});
