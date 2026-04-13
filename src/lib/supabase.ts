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
 * Supabase client configuration.
 *
 * autoRefreshToken is DISABLED to prevent refresh token rotation conflicts
 * with the mobile app. Both clients share the same Supabase auth backend —
 * when one client auto-refreshes, Supabase rotates the refresh token,
 * invalidating the other client's token.
 *
 * With autoRefreshToken disabled:
 * - The portal handles token refresh on-demand when receiving 401 errors
 * - The mobile app's tokens remain valid between its own refresh cycles
 * - Users can use both portal and mobile simultaneously
 *
 * See: https://supabase.com/docs/reference/javascript/initializing#with-additional-parameters
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
	auth: {
		// Disable automatic background token refresh to prevent refresh token
		// rotation from invalidating the mobile app's tokens
		autoRefreshToken: false,
		// Keep session persistence — user stays logged in across tabs/refreshes
		persistSession: true,
		// Detect OAuth redirects in URL
		detectSessionInUrl: true,
	},
});
