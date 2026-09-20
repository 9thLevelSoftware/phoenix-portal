import { describe, expect, it, vi } from "vitest";
import {
	assetContentTypeGuard,
	collectShellFiles,
	createPwaShellPrecache,
	createPwaWorkboxOptions,
	filterPrecacheToShell,
	isRuntimeCachedAsset,
	PWA_GLOB_PATTERNS,
	PWA_RUNTIME_ASSET_CACHE,
} from "./pwa";

function chunk(
	fileName: string,
	options: { isEntry?: boolean; imports?: string[]; css?: string[] } = {},
) {
	return {
		type: "chunk" as const,
		fileName,
		isEntry: options.isEntry ?? false,
		imports: options.imports ?? [],
		viteMetadata: { importedCss: new Set(options.css ?? []) },
	};
}

// Shape of a real build: the entry statically imports the vendor shell; route
// chunks (and what they import) are only reachable via dynamic import().
const BUNDLE = {
	"assets/entry-A.js": chunk("assets/entry-A.js", {
		isEntry: true,
		imports: ["assets/vendor-react-B.js", "assets/vendor-supabase-C.js"],
		css: ["assets/index-D.css"],
	}),
	"assets/vendor-react-B.js": chunk("assets/vendor-react-B.js"),
	"assets/vendor-supabase-C.js": chunk("assets/vendor-supabase-C.js", {
		imports: ["assets/vendor-react-B.js"],
	}),
	"assets/LandingPage-E.js": chunk("assets/LandingPage-E.js", {
		imports: ["assets/vendor-visx-F.js", "assets/vendor-react-B.js"],
	}),
	"assets/vendor-visx-F.js": chunk("assets/vendor-visx-F.js"),
	"assets/index-G.js": chunk("assets/index-G.js"),
	"assets/csv-H.js": chunk("assets/csv-H.js"),
	"assets/index-D.css": { type: "asset" as const },
};

const ALL_BUILT_FILES = [
	"index.html",
	"manifest.webmanifest",
	"favicon.svg",
	"pwa-192x192.png",
	"pwa-512x512.png",
	"phoenix-hero.png",
	"sw.js",
	"registerSW.js",
	...Object.keys(BUNDLE),
].map((url) => ({ url, revision: "r", size: 1 }));

describe("PWA precache (app shell only)", () => {
	it("derives the shell from the entry chunk's static import graph", () => {
		expect([...collectShellFiles(BUNDLE)].sort()).toEqual([
			"assets/entry-A.js",
			"assets/index-D.css",
			"assets/vendor-react-B.js",
			"assets/vendor-supabase-C.js",
		]);
	});

	it("keeps only shell files and static PWA files, never route or heavy chunks", () => {
		const urls = filterPrecacheToShell(
			ALL_BUILT_FILES,
			collectShellFiles(BUNDLE),
		).map((entry) => entry.url);

		expect(urls.sort()).toEqual(
			[
				"assets/entry-A.js",
				"assets/index-D.css",
				"assets/vendor-react-B.js",
				"assets/vendor-supabase-C.js",
				"favicon.svg",
				"index.html",
				"manifest.webmanifest",
				"pwa-192x192.png",
				"pwa-512x512.png",
			].sort(),
		);
		// An unrelated chunk that happens to be named index-* is not precached.
		expect(urls).not.toContain("assets/index-G.js");
		expect(urls).not.toContain("assets/LandingPage-E.js");
		expect(urls).not.toContain("assets/vendor-visx-F.js");
		expect(urls).not.toContain("phoenix-hero.png");
	});

	it("fails the build instead of precaching everything when the graph is missing", () => {
		expect(() => filterPrecacheToShell(ALL_BUILT_FILES, null)).toThrow(
			/shell chunk graph unavailable/,
		);
		expect(() => filterPrecacheToShell(ALL_BUILT_FILES, new Set())).toThrow(
			/shell chunk graph unavailable/,
		);
	});

	it("fails the build if the entry starts importing a heavy chunk statically", () => {
		const shell = new Set(["assets/entry-A.js", "assets/vendor-echarts-X.js"]);
		expect(() =>
			filterPrecacheToShell(
				[
					...ALL_BUILT_FILES,
					{ url: "assets/vendor-echarts-X.js", revision: "r", size: 1 },
				],
				shell,
			),
		).toThrow(/heavy chunks/);
	});

	it("fails the build if a shell file was not globbed", () => {
		expect(() =>
			filterPrecacheToShell(
				ALL_BUILT_FILES.filter(
					(entry) => entry.url !== "assets/vendor-react-B.js",
				),
				collectShellFiles(BUNDLE),
			),
		).toThrow(/not found by the precache glob/);
	});

	it("wires the Vite plugin's chunk graph into the Workbox manifest transform", async () => {
		const shell = createPwaShellPrecache();
		const generateBundle = shell.plugin.generateBundle as unknown as (
			options: unknown,
			bundle: typeof BUNDLE,
		) => void;
		generateBundle.call({}, {}, BUNDLE);

		const result = await shell.manifestTransform(ALL_BUILT_FILES);
		expect(result.manifest.map((entry) => entry.url)).toContain(
			"assets/entry-A.js",
		);
		expect(result.manifest.map((entry) => entry.url)).not.toContain(
			"assets/csv-H.js",
		);

		const options = createPwaWorkboxOptions(shell.manifestTransform);
		expect(options.globPatterns).toBe(PWA_GLOB_PATTERNS);
		expect(options.manifestTransforms).toEqual([shell.manifestTransform]);
		expect(options.navigateFallback).toBe("/index.html");
	});
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

	it("uses StaleWhileRevalidate with bounded expiration and the content-type guard", () => {
		const options = createPwaWorkboxOptions(vi.fn());
		const [route] = options.runtimeCaching ?? [];
		expect(options.runtimeCaching).toHaveLength(1);
		expect(route?.handler).toBe("StaleWhileRevalidate");
		expect(route?.urlPattern).toBe(isRuntimeCachedAsset);
		expect(route?.options?.cacheName).toBe(PWA_RUNTIME_ASSET_CACHE);
		expect(route?.options?.plugins).toContain(assetContentTypeGuard);
		expect(route?.options?.expiration?.maxEntries).toBeGreaterThan(0);
		expect(route?.options?.expiration?.maxAgeSeconds).toBeGreaterThan(0);
	});

	describe("assetContentTypeGuard", () => {
		const guard = (
			path: string,
			destination: RequestDestination,
			response: Response,
		) =>
			assetContentTypeGuard.cacheWillUpdate({
				request: {
					url: `${origin}${path}`,
					destination,
				} as Request,
				response,
			});
		const respond = (type: string, status = 200) =>
			new Response("x", { status, headers: { "content-type": type } });

		it("rejects the SPA-fallback HTML served for a missing chunk", async () => {
			expect(
				await guard("/assets/Old-abc.js", "script", respond("text/html")),
			).toBeNull();
			expect(
				await guard(
					"/assets/Old-abc.js",
					"",
					respond("text/html; charset=utf-8"),
				),
			).toBeNull();
			expect(
				await guard("/assets/index-abc.css", "style", respond("text/html")),
			).toBeNull();
		});

		it("rejects non-200 and mismatched types", async () => {
			expect(
				await guard("/assets/x.js", "script", respond("text/javascript", 404)),
			).toBeNull();
			expect(
				await guard("/assets/x.js", "script", respond("text/plain")),
			).toBeNull();
			expect(
				await guard(
					"/assets/x.css",
					"style",
					respond("application/javascript"),
				),
			).toBeNull();
		});

		it("accepts matching script, stylesheet and image responses", async () => {
			const js = respond("text/javascript; charset=utf-8");
			expect(await guard("/assets/x.js", "script", js)).toBe(js);
			const css = respond("text/css");
			expect(await guard("/assets/x.css", "style", css)).toBe(css);
			const png = respond("image/webp");
			expect(await guard("/assets/logo.webp", "image", png)).toBe(png);
		});
	});
});
