import type { OutputBundle } from "rollup";
import type { Plugin } from "vite";
import type { VitePWAOptions } from "vite-plugin-pwa";

type WorkboxOptions = NonNullable<Partial<VitePWAOptions>["workbox"]>;
type ManifestTransform = NonNullable<
	WorkboxOptions["manifestTransforms"]
>[number];

/**
 * Precache only the app shell. The shell is derived from Rollup's real chunk
 * graph rather than from chunk-name globs, so it cannot silently drift when
 * Rollup renames a chunk:
 *   - the HTML entry chunk and every chunk/stylesheet it statically imports
 *     (exactly what index.html loads and modulepreloads),
 *   - index.html, the web manifest and the icons.
 * Route chunks (including the landing page, which statically pulls in visx
 * for its demo chart, and the dashboard, which pulls in recharts), chart
 * libraries, the body-muscle map and large images are fetched on demand and
 * kept in a runtime cache instead, so a landing-page visitor no longer
 * downloads the whole app (~6.5 MB) into the SW cache.
 */
export const PWA_SHELL_STATIC_FILES = [
	"index.html",
	"manifest.webmanifest",
	"favicon.svg",
	"pwa-192x192.png",
	"pwa-512x512.png",
];

/**
 * Heavy chunks that must never be precached. If the entry ever starts to
 * import one statically, the build fails instead (see manifest transform).
 */
export const PWA_NEVER_PRECACHE = [
	/(^|\/)vendor-echarts-/,
	/(^|\/)vendor-recharts-/,
	/(^|\/)vendor-visx-/,
	/(^|\/)csv-/,
	/(^|\/)body-muscle-analytics-/,
];

/**
 * Files considered for precaching before the shell filter narrows them down.
 * The broad glob only feeds the manifest transform; it is not what gets
 * precached.
 */
export const PWA_GLOB_PATTERNS = ["**/*.{js,css,html,png,svg,webmanifest}"];

export const PWA_RUNTIME_ASSET_CACHE = "phoenix-assets";

interface ChunkLike {
	type: "chunk";
	fileName: string;
	isEntry: boolean;
	imports: string[];
	viteMetadata?: { importedCss: Set<string> };
}

/** The entry chunk(s) plus their static import closure and imported CSS. */
export function collectShellFiles(
	bundle: OutputBundle | Record<string, ChunkLike | { type: "asset" }>,
): Set<string> {
	const chunks = new Map<string, ChunkLike>();
	for (const output of Object.values(bundle)) {
		if (output.type === "chunk") {
			const chunk = output as unknown as ChunkLike;
			chunks.set(chunk.fileName, chunk);
		}
	}

	const shell = new Set<string>();
	const pending = [...chunks.values()]
		.filter((chunk) => chunk.isEntry)
		.map((chunk) => chunk.fileName);
	while (pending.length > 0) {
		const fileName = pending.pop();
		if (!fileName || shell.has(fileName)) continue;
		const chunk = chunks.get(fileName);
		if (!chunk) continue;
		shell.add(fileName);
		for (const css of chunk.viteMetadata?.importedCss ?? []) shell.add(css);
		pending.push(...chunk.imports);
	}
	return shell;
}

export function filterPrecacheToShell<T extends { url: string }>(
	entries: T[],
	shellFiles: Set<string> | null,
): T[] {
	if (!shellFiles || shellFiles.size === 0) {
		throw new Error(
			"phoenix-pwa-shell-precache: shell chunk graph unavailable; refusing to generate an empty or catch-all precache.",
		);
	}
	const heavy = [...shellFiles].filter((file) =>
		PWA_NEVER_PRECACHE.some((pattern) => pattern.test(file)),
	);
	if (heavy.length > 0) {
		throw new Error(
			`phoenix-pwa-shell-precache: the app shell statically imports heavy chunks (${heavy.join(", ")}). Load them with a dynamic import() instead.`,
		);
	}
	const available = new Set(entries.map((entry) => entry.url));
	const missing = [...shellFiles].filter((file) => !available.has(file));
	if (missing.length > 0) {
		throw new Error(
			`phoenix-pwa-shell-precache: shell files were not found by the precache glob: ${missing.join(", ")}`,
		);
	}
	return entries.filter(
		(entry) =>
			shellFiles.has(entry.url) || PWA_SHELL_STATIC_FILES.includes(entry.url),
	);
}

export interface PwaShellPrecache {
	plugin: Plugin;
	manifestTransform: ManifestTransform;
}

export function createPwaShellPrecache(): PwaShellPrecache {
	let shellFiles: Set<string> | null = null;

	return {
		plugin: {
			name: "phoenix-pwa-shell-precache",
			apply: "build",
			generateBundle(_options, bundle) {
				shellFiles = collectShellFiles(bundle);
			},
		},
		manifestTransform: (entries) => ({
			manifest: filterPrecacheToShell(entries, shellFiles),
			warnings: [],
		}),
	};
}

export function isRuntimeCachedAsset({
	url,
	sameOrigin,
}: {
	url: URL;
	sameOrigin: boolean;
}): boolean {
	return sameOrigin && url.pathname.startsWith("/assets/");
}

/**
 * Workbox plugin: never store a response whose body is not the kind of file
 * the request asked for. Cloudflare's SPA fallback answers a missing hashed
 * asset with `200 text/html` (index.html); without this guard that HTML would
 * be cached under the `.js` URL and overwrite a good copy on revalidation.
 *
 * NOTE: this object is serialized into sw.js with Function#toString, so its
 * method must stay self-contained (no references to module scope).
 */
export const assetContentTypeGuard = {
	cacheWillUpdate: async ({
		request,
		response,
	}: {
		request: Request;
		response: Response;
	}): Promise<Response | null> => {
		if (!response || response.status !== 200) return null;
		const type = (response.headers.get("content-type") || "").toLowerCase();
		if (!type || type.includes("text/html")) return null;
		const path = new URL(request.url).pathname.toLowerCase();
		if (
			(request.destination === "script" || path.endsWith(".js")) &&
			!type.includes("javascript")
		) {
			return null;
		}
		if (
			(request.destination === "style" || path.endsWith(".css")) &&
			!type.includes("text/css")
		) {
			return null;
		}
		return response;
	},
};

export function createPwaWorkboxOptions(
	manifestTransform: ManifestTransform,
): WorkboxOptions {
	return {
		cleanupOutdatedCaches: true,
		skipWaiting: true,
		clientsClaim: true,
		globPatterns: PWA_GLOB_PATTERNS,
		manifestTransforms: [manifestTransform],
		navigateFallback: "/index.html",
		navigateFallbackDenylist: [/^\/api\//],
		runtimeCaching: [
			{
				urlPattern: isRuntimeCachedAsset,
				handler: "StaleWhileRevalidate",
				options: {
					cacheName: PWA_RUNTIME_ASSET_CACHE,
					plugins: [assetContentTypeGuard],
					expiration: {
						// Hashed chunk names change every deploy; cap the cache so
						// superseded chunks are evicted instead of piling up.
						maxEntries: 120,
						maxAgeSeconds: 30 * 24 * 60 * 60,
						purgeOnQuotaError: true,
					},
				},
			},
		],
	};
}
