import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DAILY_RATE_LIMITS,
	RATE_LIMIT_SCOPES,
	RATE_LIMITS,
} from "@/lib/integrations/rate-limits";

/**
 * The sync queue processor runs under Deno and calls `Deno.serve` at module
 * scope, so it cannot be imported here. Its rate-limit configuration is instead
 * parsed out of the source, the same way rate-limit-schema.test.ts reads the
 * migration SQL.
 *
 * These two config blocks are duplicated by necessity (browser bundle vs Deno
 * runtime). Silent drift between them is the failure this test exists to catch:
 * the client would render a sync button the server then refuses, or vice versa.
 */
const queueProcessorSource = readFileSync(
	join(
		process.cwd(),
		"supabase",
		"functions",
		"process-sync-queue",
		"index.ts",
	),
	"utf8",
);

function extractObjectLiteral(source: string, declaration: string): string {
	const start = source.indexOf(declaration);
	if (start === -1) {
		throw new Error(`Could not find "${declaration}" in process-sync-queue`);
	}
	// Anchor on the assignment, not the first brace: these declarations carry a
	// `Record<string, { ... }>` type annotation whose braces would otherwise be
	// mistaken for the value.
	const assignment = source.indexOf("= {", start);
	if (assignment === -1) {
		throw new Error(`Could not find assignment for "${declaration}"`);
	}
	const open = source.indexOf("{", assignment);
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		if (source[i] === "}") {
			depth--;
			if (depth === 0) return source.slice(open, i + 1);
		}
	}
	throw new Error(`Unterminated object literal for "${declaration}"`);
}

function parseEdgeRateLimits(
	declaration = "const RATE_LIMITS",
): Record<string, { requests: number; windowMs: number }> {
	const body = extractObjectLiteral(queueProcessorSource, declaration);
	const entries: Record<string, { requests: number; windowMs: number }> = {};

	// e.g. `strava: { requests: 80, windowMs: 15 * 60 * 1000 },`
	const rowPattern =
		/(\w+):\s*\{\s*requests:\s*(\d+),\s*windowMs:\s*([\d\s*]+?)\s*\}/g;
	for (const match of body.matchAll(rowPattern)) {
		const [, provider, requests, windowExpr] = match;
		const windowMs = windowExpr
			.split("*")
			.map((part) => Number(part.trim()))
			.reduce((a, b) => a * b, 1);
		entries[provider] = { requests: Number(requests), windowMs };
	}
	return entries;
}

function parseEdgeScopes(): Record<string, string> {
	const body = extractObjectLiteral(
		queueProcessorSource,
		"const RATE_LIMIT_SCOPE",
	);
	const entries: Record<string, string> = {};
	for (const match of body.matchAll(/(\w+):\s*'(app|user)'/g)) {
		entries[match[1]] = match[2];
	}
	return entries;
}

describe("rate limit config parity (client vs sync queue processor)", () => {
	it("parses a non-empty config out of the queue processor", () => {
		// Guards the parser itself — a silently-empty parse would make every
		// comparison below vacuously pass.
		expect(Object.keys(parseEdgeRateLimits()).length).toBeGreaterThan(0);
		expect(Object.keys(parseEdgeScopes()).length).toBeGreaterThan(0);
	});

	it("declares the same providers on both sides", () => {
		expect(Object.keys(parseEdgeRateLimits()).sort()).toEqual(
			Object.keys(RATE_LIMITS).sort(),
		);
	});

	it("agrees on requests and window for every provider", () => {
		expect(parseEdgeRateLimits()).toEqual(RATE_LIMITS);
	});

	it("agrees on the quota scope for every provider", () => {
		expect(parseEdgeScopes()).toEqual(RATE_LIMIT_SCOPES);
	});

	it("assigns a scope to every rate-limited provider", () => {
		for (const provider of Object.keys(RATE_LIMITS)) {
			expect(
				RATE_LIMIT_SCOPES[provider],
				`${provider} has a rate limit but no declared scope`,
			).toMatch(/^(app|user)$/);
		}
	});

	it("keeps Fitbit user-scoped (regression: a shared bucket capped all users at one allowance)", () => {
		expect(RATE_LIMIT_SCOPES.fitbit).toBe("user");
	});

	it("keeps Strava app-scoped (its published quota is per application)", () => {
		expect(RATE_LIMIT_SCOPES.strava).toBe("app");
	});

	it("agrees on the daily quota window for every provider that has one", () => {
		expect(parseEdgeRateLimits("const DAILY_RATE_LIMITS")).toEqual(
			DAILY_RATE_LIMITS,
		);
	});

	it("tracks Strava's daily read cap (regression: only the 15-min window was modelled)", () => {
		expect(DAILY_RATE_LIMITS.strava.requests).toBeLessThanOrEqual(1000);
		expect(DAILY_RATE_LIMITS.strava.windowMs).toBe(24 * 60 * 60 * 1000);
	});

	it("keeps every daily quota looser than its short-window counterpart", () => {
		for (const [provider, daily] of Object.entries(DAILY_RATE_LIMITS)) {
			expect(daily.windowMs).toBeGreaterThan(RATE_LIMITS[provider].windowMs);
			expect(daily.requests).toBeGreaterThan(RATE_LIMITS[provider].requests);
		}
	});

	it("stays at or below each provider's documented ceiling", () => {
		// Documented limits; config carries a deliberate ~20% safety margin.
		const documented: Record<string, number> = {
			strava: 100, // per 15 min, non-upload (read) limit
			fitbit: 150, // per hour, per user
		};
		for (const [provider, ceiling] of Object.entries(documented)) {
			expect(RATE_LIMITS[provider].requests).toBeLessThanOrEqual(ceiling);
		}
	});
});
