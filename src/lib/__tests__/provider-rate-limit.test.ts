import { describe, expect, it } from "vitest";
import {
	checkReadBudget,
	dailyRateLimitKey,
	parseRateLimitPair,
	parseRetryAfterSeconds,
	parseStravaRateLimitHeaders,
	startOfCurrentQuarterHour,
	startOfUtcDay,
	topOfCurrentHour,
} from "../../../supabase/functions/_shared/providerRateLimit.ts";

// ─── Window boundaries ───────────────────────────────────────────────────────

describe("startOfCurrentQuarterHour", () => {
	it.each([
		["2026-07-28T10:00:00.000Z", "2026-07-28T10:00:00.000Z"],
		["2026-07-28T10:07:31.500Z", "2026-07-28T10:00:00.000Z"],
		["2026-07-28T10:14:59.999Z", "2026-07-28T10:00:00.000Z"],
		["2026-07-28T10:15:00.000Z", "2026-07-28T10:15:00.000Z"],
		["2026-07-28T10:44:00.000Z", "2026-07-28T10:30:00.000Z"],
		["2026-07-28T10:59:59.000Z", "2026-07-28T10:45:00.000Z"],
	])("floors %s to %s", (input, expected) => {
		expect(startOfCurrentQuarterHour(new Date(input))).toBe(expected);
	});

	it("anchors to Strava's natural boundaries, not 15 minutes from now", () => {
		// A 429 at 10:14 must clear at 10:15, not 10:29.
		expect(startOfCurrentQuarterHour(new Date("2026-07-28T10:14:00Z"))).toBe(
			"2026-07-28T10:00:00.000Z",
		);
	});
});

describe("topOfCurrentHour", () => {
	it("floors to the hour boundary", () => {
		expect(topOfCurrentHour(new Date("2026-07-28T10:59:59Z"))).toBe(
			"2026-07-28T10:00:00.000Z",
		);
	});
});

describe("startOfUtcDay", () => {
	it("floors to midnight UTC", () => {
		expect(startOfUtcDay(new Date("2026-07-28T23:59:59Z"))).toBe(
			"2026-07-28T00:00:00.000Z",
		);
	});
});

// ─── Header parsing ──────────────────────────────────────────────────────────

describe("parseRateLimitPair", () => {
	it("splits Strava's comma-separated 15-minute/daily pair", () => {
		expect(parseRateLimitPair("100,1000")).toEqual({
			shortTerm: 100,
			daily: 1000,
		});
	});

	it("tolerates surrounding whitespace", () => {
		expect(parseRateLimitPair(" 42 , 900 ")).toEqual({
			shortTerm: 42,
			daily: 900,
		});
	});

	it("returns nulls for a missing header rather than zeros", () => {
		// Zero would read as "no quota consumed" — wrong in the permissive
		// direction, which is the dangerous one.
		expect(parseRateLimitPair(null)).toEqual({ shortTerm: null, daily: null });
	});

	it("returns null for unparseable components", () => {
		expect(parseRateLimitPair("abc,1000")).toEqual({
			shortTerm: null,
			daily: 1000,
		});
	});

	it("returns null for an absent daily component", () => {
		expect(parseRateLimitPair("100")).toEqual({ shortTerm: 100, daily: null });
	});
});

describe("parseStravaRateLimitHeaders", () => {
	it("reads both the overall and read-specific quotas", () => {
		const headers = new Headers({
			"x-ratelimit-limit": "200,2000",
			"x-ratelimit-usage": "35,410",
			"x-readratelimit-limit": "100,1000",
			"x-readratelimit-usage": "20,300",
		});

		expect(parseStravaRateLimitHeaders(headers)).toEqual({
			overallLimit: { shortTerm: 200, daily: 2000 },
			overallUsage: { shortTerm: 35, daily: 410 },
			readLimit: { shortTerm: 100, daily: 1000 },
			readUsage: { shortTerm: 20, daily: 300 },
		});
	});

	it("yields nulls throughout when Strava sends no quota headers", () => {
		const snapshot = parseStravaRateLimitHeaders(new Headers());
		expect(snapshot.readLimit).toEqual({ shortTerm: null, daily: null });
		expect(snapshot.overallUsage).toEqual({ shortTerm: null, daily: null });
	});
});

describe("parseRetryAfterSeconds", () => {
	it("reads delta-seconds", () => {
		expect(parseRetryAfterSeconds(new Headers({ "retry-after": "120" }))).toBe(
			120,
		);
	});

	it("reads an HTTP date relative to now", () => {
		const now = new Date("2026-07-28T10:00:00Z");
		const headers = new Headers({
			"retry-after": "Tue, 28 Jul 2026 10:02:00 GMT",
		});
		expect(parseRetryAfterSeconds(headers, now)).toBe(120);
	});

	it("floors a past date at zero rather than going negative", () => {
		const now = new Date("2026-07-28T10:00:00Z");
		const headers = new Headers({
			"retry-after": "Tue, 28 Jul 2026 09:58:00 GMT",
		});
		expect(parseRetryAfterSeconds(headers, now)).toBe(0);
	});

	it("returns null when the header is absent", () => {
		expect(parseRetryAfterSeconds(new Headers())).toBeNull();
	});

	it("returns null when the header is gibberish", () => {
		expect(
			parseRetryAfterSeconds(new Headers({ "retry-after": "soon" })),
		).toBeNull();
	});
});

// ─── Budget decisions ────────────────────────────────────────────────────────

function snapshotOf(readLimit: string, readUsage: string) {
	return parseStravaRateLimitHeaders(
		new Headers({
			"x-readratelimit-limit": readLimit,
			"x-readratelimit-usage": readUsage,
		}),
	);
}

describe("checkReadBudget", () => {
	it("reports headroom well inside the quota", () => {
		expect(checkReadBudget(snapshotOf("100,1000", "10,100"))).toEqual({
			hasHeadroom: true,
			remaining: 90,
		});
	});

	it("takes the tighter of the 15-minute and daily windows", () => {
		// 15-min has 90 left, daily only 5 — the daily cap governs.
		expect(checkReadBudget(snapshotOf("100,1000", "10,995"))).toEqual({
			hasHeadroom: true,
			remaining: 5,
		});
	});

	it("reports exhaustion once the daily quota is spent", () => {
		const budget = checkReadBudget(snapshotOf("100,1000", "10,1000"));
		expect(budget.hasHeadroom).toBe(false);
	});

	it("subtracts the reserve so one backfill cannot drain the shared budget", () => {
		// 20 requests left, but 20 are reserved for everyone else.
		const budget = checkReadBudget(snapshotOf("100,1000", "80,100"), 20);
		expect(budget).toEqual({ hasHeadroom: false, remaining: 0 });
	});

	it("still permits requests when the reserve leaves headroom", () => {
		expect(checkReadBudget(snapshotOf("100,1000", "70,100"), 20)).toEqual({
			hasHeadroom: true,
			remaining: 10,
		});
	});

	it("falls back to the overall quota when read headers are absent", () => {
		const snapshot = parseStravaRateLimitHeaders(
			new Headers({
				"x-ratelimit-limit": "200,2000",
				"x-ratelimit-usage": "150,500",
			}),
		);
		expect(checkReadBudget(snapshot)).toEqual({
			hasHeadroom: true,
			remaining: 50,
		});
	});

	it("permits the request when no headers are usable, deferring to the page ceiling", () => {
		// Failing closed here would halt all syncing the moment Strava changed
		// or dropped a header name.
		expect(checkReadBudget(parseStravaRateLimitHeaders(new Headers()))).toEqual(
			{
				hasHeadroom: true,
				remaining: null,
			},
		);
	});
});

describe("dailyRateLimitKey", () => {
	it("namespaces the daily bucket away from the short-window row", () => {
		expect(dailyRateLimitKey("strava")).toBe("strava:daily");
		expect(dailyRateLimitKey("strava")).not.toBe("strava");
	});
});
