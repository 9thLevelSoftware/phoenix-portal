/// <reference types="vitest/config" />

import path from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		// The React and Tailwind plugins are both required for Make, even if
		// Tailwind is not being actively used – do not remove them
		react(),
		tailwindcss(),
		...(process.env.ANALYZE === "true"
			? [visualizer({ open: true, gzipSize: true, brotliSize: true })]
			: []),
		...(process.env.SENTRY_AUTH_TOKEN
			? [
					sentryVitePlugin({
						org: process.env.SENTRY_ORG || "phoenix-portal",
						project: process.env.SENTRY_PROJECT || "phoenix-portal",
						authToken: process.env.SENTRY_AUTH_TOKEN,
					}),
				]
			: []),
	],
	resolve: {
		alias: {
			// Alias @ to the src directory
			"@": path.resolve(__dirname, "./src"),
		},
	},
	build: {
		sourcemap: true,
		rollupOptions: {
			output: {
				manualChunks: {
					"vendor-react": [
						"react",
						"react-dom",
						"react-dom/client",
						"react-router",
						"react-is",
					],
					"vendor-motion": ["motion"],
					"vendor-supabase": ["@supabase/supabase-js"],
					"vendor-query": ["@tanstack/react-query"],
					"vendor-radix": [
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
				},
			},
		},
	},
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		css: true,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
	},
});
