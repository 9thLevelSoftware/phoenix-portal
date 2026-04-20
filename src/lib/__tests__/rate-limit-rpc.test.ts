import { describe, expect, it } from "vitest";
import {
	normalizeRateLimitRpcResult,
	type RateLimitRpcRow,
} from "../../../supabase/functions/_shared/rateLimitRpc.ts";

describe("normalizeRateLimitRpcResult", () => {
	it("accepts a single-row PostgREST table response", () => {
		const row: RateLimitRpcRow = {
			allowed: true,
			remaining: 9,
			retry_after_seconds: null,
		};

		expect(normalizeRateLimitRpcResult([row])).toEqual(row);
	});

	it("accepts a direct object response", () => {
		const row: RateLimitRpcRow = {
			allowed: false,
			remaining: 0,
			retry_after_seconds: 27,
		};

		expect(normalizeRateLimitRpcResult(row)).toEqual(row);
	});

	it("rejects malformed RPC payloads", () => {
		expect(normalizeRateLimitRpcResult([])).toBeNull();
		expect(normalizeRateLimitRpcResult([{ allowed: "yes" }])).toBeNull();
		expect(normalizeRateLimitRpcResult(null)).toBeNull();
	});
});
