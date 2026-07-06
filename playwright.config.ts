import { defineConfig, devices } from "@playwright/test";
import {
	E2E_SUPABASE_ANON_KEY,
	E2E_SUPABASE_URL,
} from "./e2e/support/supabase";

const E2E_PORT = 45173;
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const E2E_PADDLE_PRICE_IDS = {
	VITE_PADDLE_EMBER_MONTHLY_PRICE_ID:
		process.env.VITE_PADDLE_EMBER_MONTHLY_PRICE_ID ?? "pri_e2e_ember_monthly",
	VITE_PADDLE_EMBER_ANNUAL_PRICE_ID:
		process.env.VITE_PADDLE_EMBER_ANNUAL_PRICE_ID ?? "pri_e2e_ember_annual",
	VITE_PADDLE_FLAME_MONTHLY_PRICE_ID:
		process.env.VITE_PADDLE_FLAME_MONTHLY_PRICE_ID ?? "pri_e2e_flame_monthly",
	VITE_PADDLE_FLAME_ANNUAL_PRICE_ID:
		process.env.VITE_PADDLE_FLAME_ANNUAL_PRICE_ID ?? "pri_e2e_flame_annual",
	VITE_PADDLE_INFERNO_MONTHLY_PRICE_ID:
		process.env.VITE_PADDLE_INFERNO_MONTHLY_PRICE_ID ??
		"pri_e2e_inferno_monthly",
	VITE_PADDLE_INFERNO_ANNUAL_PRICE_ID:
		process.env.VITE_PADDLE_INFERNO_ANNUAL_PRICE_ID ?? "pri_e2e_inferno_annual",
};

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
	use: {
		baseURL: E2E_BASE_URL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: `npm run dev -- --host 127.0.0.1 --port ${E2E_PORT}`,
		url: E2E_BASE_URL,
		// Always boot an isolated server so E2E uses the injected test Supabase env.
		reuseExistingServer: false,
		timeout: 30000,
		env: {
			...process.env,
			...E2E_PADDLE_PRICE_IDS,
			VITE_SUPABASE_URL: E2E_SUPABASE_URL,
			VITE_SUPABASE_ANON_KEY: E2E_SUPABASE_ANON_KEY,
		},
	},
});
