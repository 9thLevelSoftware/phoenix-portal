import {
	oauthInitiateError,
	redirectToValidatedOAuthUrl,
} from "./oauthRedirect";

/**
 * Initiate Fitbit OAuth 2.0 connection via the initiate-oauth Edge Function.
 * A refusal from that function is forwarded (`oauthInitiateError`). Fitbit
 * is unlaunched, so the refusal is `provider_unavailable` and no state is
 * minted. The disabled `fitbit-oauth` callback does not check `state`; it
 * answers 410 Gone for every request (NF-46).
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 */
export async function initiateFitbitConnect(
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
		body: JSON.stringify({ provider: "fitbit" }),
	});

	if (!response.ok) {
		throw await oauthInitiateError("Fitbit", response);
	}

	const { url } = await response.json();
	redirectToValidatedOAuthUrl("fitbit", url);
}
