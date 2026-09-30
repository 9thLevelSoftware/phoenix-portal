import {
	oauthInitiateError,
	redirectToValidatedOAuthUrl,
} from "./oauthRedirect";

/**
 * Initiate Garmin Connect OAuth 1.0a connection via the initiate-oauth Edge Function.
 * The server generates a cryptographic CSRF state token and returns
 * the Garmin OAuth initiation URL.
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 *
 * NOTE: Garmin developer program approval may be pending.
 * This function is ready but untested until credentials are available.
 */
export async function initiateGarminConnect(
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
		body: JSON.stringify({ provider: "garmin" }),
	});

	if (!response.ok) {
		throw await oauthInitiateError("Garmin", response);
	}

	const { url } = await response.json();
	redirectToValidatedOAuthUrl("garmin", url, { supabaseUrl });
}
