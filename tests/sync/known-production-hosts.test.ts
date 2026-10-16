import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWN_PRODUCTION_HOSTS } from "../../scripts/known-production-hosts.mjs";
import { validateEnvVars } from "./setup";

const productionRef = "ilzlswmatadlnsuxatcv";

describe("known production hosts", () => {
	it("is one list imported by the preview scripts and live sync setup", async () => {
		expect([...KNOWN_PRODUCTION_HOSTS]).toEqual([
			`${productionRef}.supabase.co`,
			`${productionRef}.supabase.in`,
			"api.phoenix-portal.com",
		]);

		const [resolver, cleanup, setup] = await Promise.all([
			readFile("scripts/resolve-sync-preview.mjs", "utf8"),
			readFile("scripts/cleanup-sync-preview-users.mjs", "utf8"),
			readFile("tests/sync/setup.ts", "utf8"),
		]);
		for (const source of [resolver, cleanup, setup]) {
			expect(source).toContain("known-production-hosts.mjs");
			expect(source).not.toContain(`${productionRef}.supabase.co`);
			expect(source).not.toContain(`${productionRef}.supabase.in`);
			expect(source).not.toContain("api.phoenix-portal.com");
		}
	});

	describe("live sync setup refusal", () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		function liveEnv(url: string) {
			vi.stubEnv("MOCK_EDGE_FUNCTIONS", "false");
			vi.stubEnv("SYNC_LIVE_TESTS", "true");
			vi.stubEnv("SUPABASE_ANON_KEY", "test-anon-key");
			vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
			vi.stubEnv("SUPABASE_URL", url);
		}

		it.each([
			`https://${productionRef}.supabase.co`,
			`https://${productionRef}.supabase.in`,
			"https://api.phoenix-portal.com",
			`https://${productionRef}.supabase.in/rest/v1/`,
		])("refuses %s", (url) => {
			liveEnv(url);
			expect(validateEnvVars()).toEqual(["non-production SUPABASE_URL"]);
		});

		it("allows an isolated preview host", () => {
			liveEnv("https://otygdxrzhlzooychegzb.supabase.co");
			expect(validateEnvVars()).toEqual([]);
		});

		it("ignores a lookalike hostname and an unparseable URL", () => {
			liveEnv(`https://${productionRef}.supabase.in.evil.example`);
			expect(validateEnvVars()).toEqual([]);

			liveEnv("not a url");
			expect(validateEnvVars()).toEqual([]);
		});
	});
});
