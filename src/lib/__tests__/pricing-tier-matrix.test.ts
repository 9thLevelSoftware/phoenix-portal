import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER_PRICING } from "@/lib/pricing";

function readRepoFile(relativePath: string): string {
	return readFileSync(join(process.cwd(), relativePath), "utf8").replace(
		/\r\n/g,
		"\n",
	);
}

function tierByName(tier: "EMBER" | "FLAME" | "INFERNO") {
	const found = TIER_PRICING.find((entry) => entry.tier === tier);
	if (!found) {
		throw new Error(`TIER_PRICING is missing ${tier}`);
	}
	return found;
}

function featureBlob(tier: "EMBER" | "FLAME" | "INFERNO"): string {
	return tierByName(tier).features.join(" | ").toLowerCase();
}

function nearestRequiredTier(source: string, path: string): string | undefined {
	const needle = `path="${path}"`;
	const pathIdx = source.indexOf(needle);
	if (pathIdx < 0) {
		throw new Error(`${path} must appear in src/app/routes/index.tsx`);
	}
	const preceding = [
		...source
			.slice(0, pathIdx)
			.matchAll(/requiredTier="(EMBER|FLAME|INFERNO)"/g),
	];
	return preceding.at(-1)?.[1];
}

function providerCardBlock(source: string, provider: string): string {
	const start = source.indexOf(`provider="${provider}"`);
	if (start < 0) {
		throw new Error(`${provider} ProviderCard must exist`);
	}
	const nextProvider = source.indexOf("provider=", start + 1);
	const end = nextProvider === -1 ? source.length : nextProvider;
	return source.slice(start, end);
}

describe("KD-24 route × TIER_PRICING matrix", () => {
	const routes = readRepoFile("src/app/routes/index.tsx");
	const integrations = readRepoFile("src/app/components/Integrations.tsx");
	const sessionReplay = readRepoFile(
		"src/app/components/session-replay/SessionReplay.tsx",
	);
	const performanceTab = readRepoFile(
		"src/app/components/analytics/PerformanceTab.tsx",
	);

	it("keeps Ember features on sync/dashboard/history — not leaderboards", () => {
		const ember = featureBlob("EMBER");
		expect(ember).toContain("cloud sync");
		expect(ember).toContain("dashboard");
		expect(ember).toContain("session detail");
		expect(ember).toContain("goals");
		expect(ember).toContain("recovery");
		expect(ember).not.toContain("leaderboard");
		expect(ember).not.toContain("challenge");
		expect(ember).not.toContain("replay");
		expect(ember).not.toContain("biomechanics");
	});

	it("keeps Flame features on analytics/community/integrations/replay", () => {
		const flame = featureBlob("FLAME");
		expect(flame).toContain("analytics");
		expect(flame).toContain("community");
		expect(flame).toContain("routines");
		expect(flame).toContain("cycles");
		expect(flame).toContain("leaderboards");
		expect(flame).toContain("challenges");
		expect(flame).toContain("compare");
		expect(flame).toContain("integrations");
		expect(flame).toContain("strava");
		expect(flame).toContain("hevy");
		expect(flame).toContain("liftosaur");
		expect(flame).toContain("session replay");
		expect(flame).not.toContain("biomechanics");
		expect(flame).not.toContain("garmin");
		expect(flame).not.toContain("fitbit");
	});

	it("keeps Inferno purchasable and scoped to biomechanics", () => {
		const inferno = tierByName("INFERNO");
		expect(inferno.comingSoon).toBe(false);
		const blob = inferno.features.join(" | ").toLowerCase();
		expect(blob).toContain("biomechanics");
		expect(blob).toContain("force");
		expect(blob).toContain("vbt");
		expect(blob).toContain("rom");
		expect(blob).toContain("sra");
		expect(blob).not.toContain("session replay");
		expect(blob).not.toContain("leaderboard");
	});

	it("gates listed Ember and Flame routes at the matching SubscribedRoute tier", () => {
		const emberPaths = [
			"/dashboard",
			"/history",
			"/history/:sessionId",
			"/goals",
			"/recovery",
		];
		const flamePaths = [
			"/challenges",
			"/analytics",
			"/community",
			"/leaderboard",
			"/routines",
			"/cycles",
			"/compare",
			"/integrations",
			"/replay/:sessionId",
		];

		for (const path of emberPaths) {
			expect(nearestRequiredTier(routes, path)).toBe("EMBER");
		}
		for (const path of flamePaths) {
			expect(nearestRequiredTier(routes, path)).toBe("FLAME");
		}

		const profileIdx = routes.indexOf('path="/profile"');
		const pricingIdx = routes.indexOf('path="/pricing"');
		const firstGated = routes.indexOf("requiredTier=");
		expect(profileIdx).toBeGreaterThan(-1);
		expect(pricingIdx).toBeGreaterThan(-1);
		expect(profileIdx).toBeLessThan(firstGated);
		expect(pricingIdx).toBeLessThan(firstGated);

		expect(routes).not.toMatch(/requiredTier="INFERNO"/);
		expect(nearestRequiredTier(routes, "/replay/:sessionId")).toBe("FLAME");
		expect(sessionReplay).toMatch(/requiredTier="FLAME"/);
		expect(performanceTab).toMatch(/requiredTier="INFERNO"/);
	});

	it("keeps Fitbit and Garmin Connect comingSoon on the Flame integrations page", () => {
		const fitbit = providerCardBlock(integrations, "fitbit");
		const garmin = providerCardBlock(integrations, "garmin");
		expect(fitbit).toMatch(/\bcomingSoon\b/);
		expect(garmin).toMatch(/\bcomingSoon\b/);
		expect(fitbit).not.toMatch(/comingSoon=\{false\}/);
		expect(garmin).not.toMatch(/comingSoon=\{false\}/);
	});
});
