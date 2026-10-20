import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Provider quotas live only in the sync queue processor. The old client copy
 * (`src/lib/integrations/rate-limits.ts`) was not imported by app code, so it
 * is gone. The processor runs under Deno and does not export these tables, so
 * this test reads them out of the source and pins the per-provider contract:
 * request ceilings (including the ~20% safety margin), quota scope, and
 * Strava's second daily window.
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

/** Short-window ceilings the processor must keep. */
const EXPECTED_RATE_LIMITS: Record<
	string,
	{ requests: number; windowMs: number }
> = {
	strava: { requests: 80, windowMs: 15 * 60 * 1000 },
	fitbit: { requests: 120, windowMs: 60 * 60 * 1000 },
	garmin: { requests: 40, windowMs: 60 * 60 * 1000 },
	hevy: { requests: 40, windowMs: 60 * 60 * 1000 },
	liftosaur: { requests: 40, windowMs: 60 * 60 * 1000 },
};

/**
 * App-wide vs per-user quota scope. A shared bucket for a per-user quota
 * starves later users; a per-user bucket for an app quota overruns it.
 */
const EXPECTED_SCOPES: Record<string, "app" | "user"> = {
	strava: "app",
	garmin: "app",
	fitbit: "user",
	hevy: "user",
	liftosaur: "user",
};

/** Longer windows published in addition to the short one. */
const EXPECTED_DAILY_RATE_LIMITS: Record<
	string,
	{ requests: number; windowMs: number }
> = {
	strava: { requests: 800, windowMs: 24 * 60 * 60 * 1000 },
};

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

describe("process-sync-queue rate limit contract", () => {
	it("parses a non-empty config out of the queue processor", () => {
		// Guards the parser itself — a silently-empty parse would make every
		// comparison below vacuously pass.
		expect(Object.keys(parseEdgeRateLimits()).length).toBeGreaterThan(0);
		expect(Object.keys(parseEdgeScopes()).length).toBeGreaterThan(0);
		expect(
			Object.keys(parseEdgeRateLimits("const DAILY_RATE_LIMITS")).length,
		).toBeGreaterThan(0);
	});

	it("keeps the short-window ceiling for every provider", () => {
		expect(parseEdgeRateLimits()).toEqual(EXPECTED_RATE_LIMITS);
	});

	it("keeps the quota scope for every provider", () => {
		expect(parseEdgeScopes()).toEqual(EXPECTED_SCOPES);
	});

	it("assigns a scope to every rate-limited provider", () => {
		const scopes = parseEdgeScopes();
		for (const provider of Object.keys(parseEdgeRateLimits())) {
			expect(
				scopes[provider],
				`${provider} has a rate limit but no declared scope`,
			).toMatch(/^(app|user)$/);
		}
	});

	it("keeps Fitbit user-scoped (regression: a shared bucket capped all users at one allowance)", () => {
		expect(parseEdgeScopes().fitbit).toBe("user");
	});

	it("keeps Strava app-scoped (its published quota is per application)", () => {
		expect(parseEdgeScopes().strava).toBe("app");
	});

	it("keeps the daily quota window for every provider that has one", () => {
		expect(parseEdgeRateLimits("const DAILY_RATE_LIMITS")).toEqual(
			EXPECTED_DAILY_RATE_LIMITS,
		);
	});

	it("tracks Strava's daily read cap (regression: only the 15-min window was modelled)", () => {
		const daily = parseEdgeRateLimits("const DAILY_RATE_LIMITS").strava;
		expect(daily.requests).toBeLessThanOrEqual(1000);
		expect(daily.windowMs).toBe(24 * 60 * 60 * 1000);
	});

	it("keeps every daily quota looser than its short-window counterpart", () => {
		const short = parseEdgeRateLimits();
		for (const [provider, daily] of Object.entries(
			parseEdgeRateLimits("const DAILY_RATE_LIMITS"),
		)) {
			expect(daily.windowMs).toBeGreaterThan(short[provider].windowMs);
			expect(daily.requests).toBeGreaterThan(short[provider].requests);
		}
	});

	it("stays at or below each provider's documented ceiling", () => {
		// Documented limits; config carries a deliberate ~20% safety margin.
		const documented: Record<string, number> = {
			strava: 100, // per 15 min, non-upload (read) limit
			fitbit: 150, // per hour, per user
		};
		const limits = parseEdgeRateLimits();
		for (const [provider, ceiling] of Object.entries(documented)) {
			expect(limits[provider].requests).toBeLessThanOrEqual(ceiling);
		}
	});
});
