import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	assertNoDeadSupabaseRefs,
	extractSupabaseRefs,
	findDeadSupabaseRefs,
	findStaleRefMatches,
} from "../../../scripts/assert-live-supabase-config.mjs";
import {
	buildAllowedRedirectUrls,
	buildManagedConfig,
	buildPortalCallbackUrl,
	inferProjectRef,
	MANAGED_BLOCK_END,
	MANAGED_BLOCK_START,
} from "../../../scripts/sync-social-auth.mjs";

describe("Cloudflare Pages build guard", () => {
	it("runs the stale Supabase config guard after building deploy artifacts", () => {
		const wranglerConfig = readFileSync(
			resolve(
				dirname(fileURLToPath(import.meta.url)),
				"../../../wrangler.toml",
			),
			"utf8",
		);

		const buildCommand = wranglerConfig.match(
			/^\s*command\s*=\s*"(?<command>[^"]+)"/m,
		)?.groups?.command;

		expect(buildCommand).toContain("npm run build");
		expect(buildCommand).toContain("npm run assert:supabase-config");
		expect(
			buildCommand?.indexOf("npm run assert:supabase-config"),
		).toBeGreaterThan(buildCommand?.indexOf("npm run build") ?? -1);
	});
});

describe("sync-social-auth", () => {
	it("infers the project ref from the public Supabase URL", () => {
		expect(
			inferProjectRef({
				projectRef: "",
				supabaseUrl: "https://ilzlswmatadlnsuxatcv.supabase.co",
			}),
		).toBe("ilzlswmatadlnsuxatcv");
	});

	it("rejects inference when both projectRef and supabaseUrl are missing", () => {
		expect(() => inferProjectRef({ projectRef: "", supabaseUrl: "" })).toThrow(
			/Missing SUPABASE_PROJECT_REF and VITE_SUPABASE_URL/,
		);
	});

	it("builds exact callback allow-list entries and deduplicates extras", () => {
		expect(
			buildAllowedRedirectUrls({
				siteUrl: "https://portal.projectphoenix.app",
				additionalRedirectUrls:
					"http://localhost:5173/auth/callback, https://preview.projectphoenix.app/auth/callback",
			}),
		).toEqual([
			"http://localhost:5173/auth/callback",
			"https://portal.projectphoenix.app/auth/callback",
			"https://preview.projectphoenix.app/auth/callback",
		]);
	});

	it("replaces the managed placeholder block with provider config", () => {
		const baseConfig = `[auth]
refresh_token_reuse_interval = 60

${MANAGED_BLOCK_START}
# placeholder
${MANAGED_BLOCK_END}

[functions.example]
verify_jwt = false
`;

		const managedConfig = buildManagedConfig(baseConfig, {
			siteUrl: "https://portal.projectphoenix.app/",
			allowedRedirectUrls: [
				buildPortalCallbackUrl("https://portal.projectphoenix.app"),
				buildPortalCallbackUrl("http://localhost:5173"),
			],
			googleClientId: "google-client-id",
			googleSecret: "google-secret",
			appleClientId: "apple-services-id",
			appleSecret: "apple-secret",
		});

		expect(managedConfig).toContain(
			'site_url = "https://portal.projectphoenix.app/"',
		);
		expect(managedConfig).toContain("[auth.external.google]");
		expect(managedConfig).toContain('client_id = "google-client-id"');
		expect(managedConfig).toContain('secret = "apple-secret"');
		expect(managedConfig).toContain("[functions.example]");
	});
});

describe("assert-live-supabase-config helpers", () => {
	it("extracts distinct Supabase project refs from arbitrary content", () => {
		expect(
			extractSupabaseRefs(
				"connect-src https://abcdefghijklmnopqrst.supabase.co wss://zyxwvutsrqponmlkjihg.supabase.co abcdefghijklmnopqrst.supabase.co",
			),
		).toEqual(["abcdefghijklmnopqrst", "zyxwvutsrqponmlkjihg"]);
	});

	it("returns no refs for content without any Supabase hostnames", () => {
		expect(extractSupabaseRefs("hello world https://example.com")).toEqual([]);
	});

	it("flags project refs from an explicit stale-ref denylist", () => {
		expect(
			findDeadSupabaseRefs(
				"const url = 'https://ilzlswmatadlnsuxatcv.supabase.co/auth/v1/settings';",
				["ilzlswmatadlnsuxatcv"],
			),
		).toEqual(["ilzlswmatadlnsuxatcv"]);
	});

	it("does not flag active project refs against the default denylist", () => {
		expect(
			findDeadSupabaseRefs("https://ilzlswmatadlnsuxatcv.supabase.co"),
		).toEqual([]);
	});

	it("throws an actionable error pointing at the offending file", () => {
		expect(() =>
			assertNoDeadSupabaseRefs(
				"https://ilzlswmatadlnsuxatcv.supabase.co",
				"dist/assets/index.js",
				["ilzlswmatadlnsuxatcv"],
			),
		).toThrow(/dist\/assets\/index\.js contains dead Supabase project ref/);
	});

	it("only reports stale refs when they appear as Supabase hostnames", () => {
		expect(
			findStaleRefMatches(
				"stale ref ilzlswmatadlnsuxatcv in prose, not a hostname",
				["ilzlswmatadlnsuxatcv"],
			),
		).toEqual([]);
		expect(
			findStaleRefMatches(
				"connect-src https://ilzlswmatadlnsuxatcv.supabase.co",
				["ilzlswmatadlnsuxatcv"],
			),
		).toEqual([
			{
				line: "connect-src https://ilzlswmatadlnsuxatcv.supabase.co",
				lineNumber: 1,
				ref: "ilzlswmatadlnsuxatcv",
			},
		]);
	});

	it("is a no-op when content is clean", () => {
		expect(() =>
			assertNoDeadSupabaseRefs(
				"https://abcdefghijklmnopqrst.supabase.co",
				"public/_headers",
			),
		).not.toThrow();
	});
});
