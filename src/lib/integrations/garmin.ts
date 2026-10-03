import {
	oauthInitiateError,
	redirectToValidatedOAuthUrl,
} from "./oauthRedirect";

/**
 * Initiate Garmin Connect OAuth 1.0a connection via the initiate-oauth Edge Function.
 * A refusal from that function is forwarded (`oauthInitiateError`). Garmin
 * is unlaunched, so the refusal is `provider_unavailable` and no state is
 * minted. The disabled `garmin-oauth` callback does not check `state`; it
 * answers 410 Gone for every request (NF-46).
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
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
