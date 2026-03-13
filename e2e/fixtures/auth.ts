import { test as base, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
	E2E_SUPABASE_ANON_KEY,
	E2E_SUPABASE_STORAGE_KEY,
	E2E_SUPABASE_URL,
} from "../support/supabase";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_CACHE = path.join(__dirname, ".session-cache.json");

/** Load e2e/.env file as fallback for env vars (avoids shell quoting issues) */
function loadEnvFile(): void {
	const envPath = path.join(__dirname, "..", ".env");
	if (!fs.existsSync(envPath)) return;
	const lines = fs.readFileSync(envPath, "utf-8").split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq);
		const value = trimmed.slice(eq + 1);
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

loadEnvFile();

async function getSession(): Promise<Record<string, unknown> | null> {
	const email = process.env.SUPABASE_TEST_EMAIL;
	const password = process.env.SUPABASE_TEST_PASSWORD;
	if (!email || !password) return null;

	// Check for cached session (avoids rate limiting across parallel workers)
	if (fs.existsSync(SESSION_CACHE)) {
		try {
			const cached = JSON.parse(fs.readFileSync(SESSION_CACHE, "utf-8"));
			// Use cached session if less than 30 minutes old
			if (cached.timestamp && Date.now() - cached.timestamp < 30 * 60 * 1000) {
				return cached.session;
			}
		} catch {
			// Ignore cache read errors
		}
	}

	// Authenticate with retry (handles Supabase rate limiting)
	for (let attempt = 0; attempt < 3; attempt++) {
		if (attempt > 0) {
			await new Promise((r) => setTimeout(r, 2000 * attempt));
		}

		const response = await fetch(
			`${E2E_SUPABASE_URL}/auth/v1/token?grant_type=password`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					apikey: E2E_SUPABASE_ANON_KEY,
				},
				body: JSON.stringify({ email, password }),
			},
		);

			if (response.ok) {
			const data = await response.json();
			const session = {
				access_token: data.access_token,
				refresh_token: data.refresh_token,
				expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
				expires_in: data.expires_in,
				token_type: "bearer",
				user: data.user,
			};

			// Cache for other workers
			try {
				fs.writeFileSync(
					SESSION_CACHE,
					JSON.stringify({ timestamp: Date.now(), session }),
				);
			} catch {
				// Ignore cache write errors
			}

			return session;
		}

		const body = await response.text();
		if (attempt === 2) {
			throw new Error(`Supabase auth failed after 3 attempts (${response.status}): ${body}`);
		}
	}

	return null;
}

export const test = base.extend<{ authedPage: Page }>({
	authedPage: async ({ page }, use) => {
		const session = await getSession();

		if (session) {
			await page.addInitScript(
				({ key, data }) => {
					window.localStorage.setItem(key, JSON.stringify(data));
				},
				{ key: E2E_SUPABASE_STORAGE_KEY, data: session },
			);
			await page.goto("/dashboard");
			await page.waitForLoadState("networkidle");
		}

		await use(page);
	},
});

export { expect } from "@playwright/test";
