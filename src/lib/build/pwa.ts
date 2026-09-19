import type { VitePWAOptions } from "vite-plugin-pwa";

type WorkboxOptions = NonNullable<Partial<VitePWAOptions>["workbox"]>;

/**
 * Precache only the app shell: the HTML entry, the manifest and icons, the
 * entry script/stylesheet and the shared vendor chunks it modulepreloads.
 * Route chunks, chart libraries, the body-muscle map and large images are
 * fetched on demand and kept in a runtime cache instead, so a landing-page
 * visitor no longer downloads the whole app (~6.5 MB) into the SW cache.
 */
export const PWA_PRECACHE_GLOB_PATTERNS = [
	"index.html",
	"manifest.webmanifest",
	"favicon.svg",
	"pwa-*.png",
	"assets/index-*.{js,css}",
	"assets/vendor-*.js",
];

/** Heavy vendor chunks that only chart-heavy routes load. */
export const PWA_PRECACHE_GLOB_IGNORES = [
	"**/vendor-echarts-*",
	"**/vendor-recharts-*",
	"**/vendor-visx-*",
];

export const PWA_RUNTIME_ASSET_CACHE = "phoenix-assets";

export function isRuntimeCachedAsset({
	url,
	sameOrigin,
}: {
	url: URL;
	sameOrigin: boolean;
}): boolean {
	return sameOrigin && url.pathname.startsWith("/assets/");
}

export const pwaWorkboxOptions: WorkboxOptions = {
	cleanupOutdatedCaches: true,
	skipWaiting: true,
	clientsClaim: true,
	globPatterns: PWA_PRECACHE_GLOB_PATTERNS,
	globIgnores: PWA_PRECACHE_GLOB_IGNORES,
	navigateFallback: "/index.html",
	navigateFallbackDenylist: [/^\/api\//],
	runtimeCaching: [
		{
			urlPattern: isRuntimeCachedAsset,
			handler: "StaleWhileRevalidate",
			options: {
				cacheName: PWA_RUNTIME_ASSET_CACHE,
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
