import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	isRuntimeCachedAsset,
	PWA_PRECACHE_GLOB_IGNORES,
	PWA_PRECACHE_GLOB_PATTERNS,
	PWA_RUNTIME_ASSET_CACHE,
	pwaWorkboxOptions,
} from "./pwa";

// node:path.matchesGlob exists from Node 22; engines still allow Node 20.
const matchesGlob = (
	path as typeof path & {
		matchesGlob?: (file: string, pattern: string) => boolean;
	}
).matchesGlob;

function isPrecached(file: string): boolean {
	if (!matchesGlob) throw new Error("matchesGlob unavailable");
	return (
		PWA_PRECACHE_GLOB_PATTERNS.some((pattern) => matchesGlob(file, pattern)) &&
		!PWA_PRECACHE_GLOB_IGNORES.some((pattern) => matchesGlob(file, pattern))
	);
}

describe("PWA precache (app shell only)", () => {
	it("has no catch-all pattern that would precache every chunk", () => {
		for (const pattern of PWA_PRECACHE_GLOB_PATTERNS) {
			expect(pattern.startsWith("**")).toBe(false);
			expect(pattern).not.toMatch(/^assets\/\*\./);
		}
		expect(pwaWorkboxOptions.globPatterns).toBe(PWA_PRECACHE_GLOB_PATTERNS);
		expect(pwaWorkboxOptions.globIgnores).toBe(PWA_PRECACHE_GLOB_IGNORES);
		expect(pwaWorkboxOptions.navigateFallback).toBe("/index.html");
	});

	it.skipIf(!matchesGlob)(
		"precaches the shell and leaves route/chart/body-map chunks to runtime",
		() => {
			for (const shell of [
				"index.html",
				"manifest.webmanifest",
				"favicon.svg",
				"pwa-192x192.png",
				"pwa-512x512.png",
				"assets/index-D1ncLgaJ.js",
				"assets/index-CE3k6ipb.css",
				"assets/vendor-react-B4lo0q0A.js",
				"assets/vendor-supabase-D5M3a-uf.js",
			]) {
				expect(isPrecached(shell), shell).toBe(true);
			}

			for (const lazy of [
				"assets/vendor-echarts-CuDjhtHz.js",
				"assets/vendor-recharts-DaZEM_ZX.js",
				"assets/vendor-visx-7Z-GPWLZ.js",
				"assets/csv-vSPO_V8J.js",
				"assets/body-muscle-analytics-DuBZJnX6.js",
				"assets/Analytics-BYgXtrNC.js",
				"assets/Profile-T1ftdHQv.js",
				"assets/phoenix-logo-512-CKGtdVX8.webp",
				"phoenix-hero.png",
			]) {
				expect(isPrecached(lazy), lazy).toBe(false);
			}
		},
	);
});

describe("PWA runtime cache for non-precached assets", () => {
	const origin = "https://portal.example";

	it("caches same-origin /assets/ requests only", () => {
		const check = (href: string, sameOrigin = true) =>
			isRuntimeCachedAsset({ url: new URL(href, origin), sameOrigin });

		expect(check("/assets/Analytics-BYgXtrNC.js")).toBe(true);
		expect(check("/assets/vendor-echarts-CuDjhtHz.js")).toBe(true);
		expect(check("/api/something")).toBe(false);
		expect(check("/index.html")).toBe(false);
		expect(check("https://cdn.example/assets/x.js", false)).toBe(false);
	});

	it("uses StaleWhileRevalidate with bounded expiration", () => {
		const [route] = pwaWorkboxOptions.runtimeCaching ?? [];
		expect(pwaWorkboxOptions.runtimeCaching).toHaveLength(1);
		expect(route?.handler).toBe("StaleWhileRevalidate");
		expect(route?.urlPattern).toBe(isRuntimeCachedAsset);
		expect(route?.options?.cacheName).toBe(PWA_RUNTIME_ASSET_CACHE);
		expect(route?.options?.expiration?.maxEntries).toBeGreaterThan(0);
		expect(route?.options?.expiration?.maxAgeSeconds).toBeGreaterThan(0);
	});
});
