import {
	oauthInitiateError,
	redirectToValidatedOAuthUrl,
} from "./oauthRedirect";

/**
 * Initiate Strava OAuth connection via the initiate-oauth Edge Function.
 * The server generates a cryptographic CSRF state token and returns
 * the Strava authorization URL.
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 */
export async function initiateStravaConnect(
	accessToken: string,
): Promise<void> {
	const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
	if (!supabaseUrl) {
		throw new Error("Supabase is not configured for OAuth redirects.");
	}

	const response = await fetch(`${supabaseUrl}/functions/v1/initiate-oauth`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ provider: "strava" }),
	});

	if (!response.ok) {
		throw await oauthInitiateError("Strava", response);
	}

	const { url } = await response.json();
	redirectToValidatedOAuthUrl("strava", url);
}
