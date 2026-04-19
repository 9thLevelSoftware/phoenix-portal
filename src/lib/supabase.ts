import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

/**
 * One-shot retry on 401 after `refreshSession()` so idle sessions recover when
 * a stale JWT reaches PostgREST before the client-side auto-refresh runs.
 * The retry must re-inject the freshly refreshed access token into the
 * Authorization header — reusing `init.headers` would send the stale JWT again.
 */
const fetchWithAuthRetry: typeof fetch = async (input, init) => {
	const response = await fetch(input, init);
	if (response.status !== 401 || !supabaseRef.current) {
		return response;
	}

	const { data, error } = await supabaseRef.current.auth.refreshSession();
	if (error || !data.session) {
		return response;
	}

	const headers = new Headers(
		init?.headers ?? (input instanceof Request ? input.headers : undefined),
	);
	headers.set("Authorization", `Bearer ${data.session.access_token}`);

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
