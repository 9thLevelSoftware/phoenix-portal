import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export type SocialAuthProvider = "google" | "apple";

export type SocialAuthAvailability = Record<SocialAuthProvider, boolean>;

export const DEFAULT_SOCIAL_AUTH_AVAILABILITY: SocialAuthAvailability = {
	google: false,
	apple: false,
};

export const OAUTH_CALLBACK_PATH = "/auth/callback";
export const GOOGLE_OAUTH_SCOPES =
	"https://www.googleapis.com/auth/userinfo.email";

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error(
		"Missing Supabase environment variables. " +
			"Copy .env.example to .env.local and fill in your Supabase project values. " +
			"See: https://supabase.com/dashboard/project/_/settings/api",
	);
}

/**
 * Mutable ref so the custom `fetch` can call `refreshSession` without a circular
 * initialization dependency on `supabase`.
 */
const supabaseRef: {
	current: ReturnType<typeof createClient<Database>> | null;
} = { current: null };

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

/**
 * Single in-flight refresh shared across concurrent 401s. React Query commonly
 * fires several requests at once when an idle tab resumes; without coalescing,
 * the first would refresh while the rest surfaced auth errors. Sharing the
 * promise also bounds refreshes to one at a time (no re-entrant storm).
 */
let refreshPromise: ReturnType<
	NonNullable<typeof supabaseRef.current>["auth"]["refreshSession"]
> | null = null;

/**
 * One-shot retry on 401 after `refreshSession()` so idle sessions recover when
 * a stale JWT reaches PostgREST before the client-side auto-refresh runs.
 * The retry must re-inject the freshly refreshed access token into the
 * Authorization header — reusing `init.headers` would send the stale JWT again.
 */
const fetchWithAuthRetry: typeof fetch = async (input, init) => {
	const response = await fetch(input, init);
	const client = supabaseRef.current;
	if (response.status !== 401 || !client) {
		return response;
	}

	// Never refresh-and-retry for Supabase auth endpoints themselves. The
	// `refreshSession()` call below issues a request through this same custom
	// fetch; if that auth request (or a failed refresh) returns 401, retrying it
	// would recursively call `refreshSession()` and loop until resource
	// exhaustion.
	const url = requestUrl(input);
	if (url.includes("/auth/v1/")) {
		return response;
	}

	// Coalesce concurrent 401s onto a single refresh, then all retry with the
	// freshly minted token.
	if (!refreshPromise) {
		refreshPromise = client.auth.refreshSession();
		refreshPromise.finally(() => {
			refreshPromise = null;
		});
	}
	const refreshed = await refreshPromise;
	if (refreshed.error || !refreshed.data.session) {
		return response;
	}

	const headers = new Headers(
		init?.headers ?? (input instanceof Request ? input.headers : undefined),
	);
	headers.set("Authorization", `Bearer ${refreshed.data.session.access_token}`);

	return fetch(input, { ...init, headers });
};

/**
 * Supabase client configuration.
 *
 * Background token refresh is enabled so JWTs renew before expiry. Multi-client
 * refresh is mitigated by `refresh_token_reuse_interval` in `supabase/config.toml`.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
	global: { fetch: fetchWithAuthRetry },
	auth: {
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: true,
	},
});

supabaseRef.current = supabase;

type AuthSettingsResponse = {
	external?: Partial<Record<SocialAuthProvider, boolean>>;
};

export async function getSocialAuthAvailability(
	fetchImpl: typeof fetch = fetch,
): Promise<SocialAuthAvailability> {
	const response = await fetchImpl(`${supabaseUrl}/auth/v1/settings`, {
		headers: {
			apikey: supabaseAnonKey,
			Authorization: `Bearer ${supabaseAnonKey}`,
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to load auth settings (${response.status})`);
	}

	const settings = (await response.json()) as AuthSettingsResponse;

	return {
		google: settings.external?.google === true,
		apple: settings.external?.apple === true,
	};
}

export function buildSocialAuthRedirectUrl(
	provider: SocialAuthProvider,
): string {
	const redirectUrl = new URL(OAUTH_CALLBACK_PATH, window.location.origin);
	redirectUrl.searchParams.set("provider", provider);
	return redirectUrl.toString();
}
