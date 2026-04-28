import type { Page } from "@playwright/test";

const DEFAULT_SUPABASE_URL = "https://test-project.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "test-anon-key";
const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_EMAIL = "e2e@example.com";

export const E2E_SUPABASE_URL =
	process.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
export const E2E_SUPABASE_ANON_KEY =
	process.env.VITE_SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;
export const E2E_SUPABASE_PROJECT_REF = (() => {
	try {
		return new URL(E2E_SUPABASE_URL).hostname.split(".")[0] ?? "test-project";
	} catch {
		return "test-project";
	}
})();
export const E2E_SUPABASE_STORAGE_KEY = `sb-${E2E_SUPABASE_PROJECT_REF}-auth-token`;

interface SessionUser {
	id: string;
	email: string;
	aud: string;
	role: string;
	app_metadata: Record<string, unknown>;
	user_metadata: Record<string, unknown>;
	created_at: string;
}

interface StoredSession {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	expires_in: number;
	token_type: "bearer";
	user: SessionUser;
}

export function createStoredSession(overrides?: {
	userId?: string;
	email?: string;
	userMetadata?: Record<string, unknown>;
}): StoredSession {
	const userId = overrides?.userId ?? DEFAULT_USER_ID;
	const email = overrides?.email ?? DEFAULT_EMAIL;

	return {
		access_token: `access-${userId}`,
		refresh_token: `refresh-${userId}`,
		expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
		expires_in: 60 * 60,
		token_type: "bearer",
		user: {
			id: userId,
			email,
			aud: "authenticated",
			role: "authenticated",
			app_metadata: {},
			user_metadata: overrides?.userMetadata ?? {},
			created_at: new Date().toISOString(),
		},
	};
}

export async function seedStoredSession(
	page: Page,
	session: StoredSession = createStoredSession(),
) {
	await page.addInitScript(
		({ key, data }) => {
			window.localStorage.setItem(key, JSON.stringify(data));
		},
		{ key: E2E_SUPABASE_STORAGE_KEY, data: session },
	);
}
