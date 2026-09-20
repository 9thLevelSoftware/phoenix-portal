import { defineConfig, devices } from "@playwright/test";
import {
	E2E_SUPABASE_ANON_KEY,
	E2E_SUPABASE_URL,
} from "./e2e/support/supabase";

// Offline/PWA smoke. The service worker only exists in a production build, so
// this config builds the app and serves it with `vite preview` instead of the
// dev server used by playwright.config.ts.
const PWA_PORT = Number(process.env.PWA_PORT ?? 45174);
const PWA_BASE_URL = `http://127.0.0.1:${PWA_PORT}`;

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.pwa.spec.ts",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	// Separate folder so this run doesn't overwrite the main e2e HTML report.
	reporter: process.env.CI
		? [["html", { outputFolder: "playwright-report-pwa", open: "never" }]]
		: "list",
	use: {
		baseURL: PWA_BASE_URL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		serviceWorkers: "allow",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PWA_PORT} --strictPort`,
		url: PWA_BASE_URL,
		reuseExistingServer: false,
		timeout: 300_000,
		env: {
			...process.env,
			VITE_SUPABASE_URL: E2E_SUPABASE_URL,
			VITE_SUPABASE_ANON_KEY: E2E_SUPABASE_ANON_KEY,
		},
	},
});
