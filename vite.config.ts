import path from "node:path";
import { fileURLToPath } from "node:url";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { stripBodyMusclesSourcemapsPlugin } from "./src/lib/build/body-muscles-sourcemaps";
import {
	productionSourcemapSetting,
	shouldUploadSourcemaps,
} from "./src/lib/build/sourcemaps";

const uploadSourcemaps = shouldUploadSourcemaps(process.env);
const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		stripBodyMusclesSourcemapsPlugin(),
		// The React and Tailwind plugins are both required for Make, even if
		// Tailwind is not being actively used – do not remove them
		react(),
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			updateViaCache: "none",
			includeAssets: ["pwa-192x192.png", "pwa-512x512.png"],
			manifest: {
				name: "Phoenix Portal",
				short_name: "Phoenix",
				description: "Training companion dashboard for Phoenix fitness machine",
				theme_color: "#0D0D0D",
				background_color: "#0D0D0D",
				display: "standalone",
				scope: "/",
				start_url: "/",
				icons: [
					{
						src: "pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				cleanupOutdatedCaches: true,
				skipWaiting: true,
				clientsClaim: true,
				globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
				navigateFallback: "/index.html",
				navigateFallbackDenylist: [/^\/api\//],
			},
			devOptions: {
				enabled: false,
			},
		}),
		...(process.env.ANALYZE === "true"
			? [visualizer({ open: true, gzipSize: true, brotliSize: true })]
			: []),
		...(uploadSourcemaps
			? [
					sentryVitePlugin({
						org: process.env.SENTRY_ORG || "phoenix-portal",
						project: process.env.SENTRY_PROJECT || "phoenix-portal",
						authToken: process.env.SENTRY_AUTH_TOKEN,
						sourcemaps: {
							filesToDeleteAfterUpload: ["./dist/**/*.map"],
						},
					}),
				]
			: []),
	],
	resolve: {
		alias: {
			// Alias @ to the src directory
			"@": path.resolve(configDir, "./src"),
		},
	},
	optimizeDeps: {
		exclude: ["body-muscles"],
	},
	build: {
		sourcemap: productionSourcemapSetting(process.env),
		chunkSizeWarningLimit: 700,
		rollupOptions: {
			output: {
				manualChunks: {
					"vendor-react": [
						"react",
						"react-dom",
						"react-dom/client",
						"react-router",
						"react-is",
						"@radix-ui/react-dialog",
						"@radix-ui/react-dropdown-menu",
						"@radix-ui/react-select",
						"@radix-ui/react-tabs",
						"@radix-ui/react-tooltip",
						"@radix-ui/react-popover",
						"@radix-ui/react-accordion",
						"@radix-ui/react-avatar",
						"@radix-ui/react-checkbox",
						"@radix-ui/react-label",
						"@radix-ui/react-progress",
						"@radix-ui/react-radio-group",
						"@radix-ui/react-scroll-area",
						"@radix-ui/react-separator",
						"@radix-ui/react-slider",
						"@radix-ui/react-slot",
						"@radix-ui/react-switch",
						"@radix-ui/react-toggle",
						"@radix-ui/react-toggle-group",
						"@radix-ui/react-hover-card",
						"@radix-ui/react-alert-dialog",
						"@radix-ui/react-aspect-ratio",
						"@radix-ui/react-collapsible",
						"@radix-ui/react-context-menu",
						"@radix-ui/react-menubar",
						"@radix-ui/react-navigation-menu",
					],
					"vendor-motion": ["motion"],
					"vendor-supabase": ["@supabase/supabase-js"],
					"vendor-query": ["@tanstack/react-query"],
					"vendor-ui": [
						"class-variance-authority",
						"clsx",
						"tailwind-merge",
						"cmdk",
						"sonner",
						"vaul",
						"input-otp",
						"embla-carousel-react",
					],
					"vendor-zod": ["zod"],
					"vendor-zustand": ["zustand"],
					"vendor-recharts": ["recharts"],
					"vendor-echarts": [
						"echarts/core",
						"echarts/charts",
						"echarts/components",
						"echarts/renderers",
					],
					"vendor-visx": [
						"@visx/axis",
						"@visx/curve",
						"@visx/event",
						"@visx/gradient",
						"@visx/group",
						"@visx/responsive",
						"@visx/scale",
						"@visx/shape",
						"@visx/text",
						"@visx/tooltip",
					],
				},
			},
		},
	},
});
