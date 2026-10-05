import {
	type OAuthRedirectProvider,
	oauthInitiateError,
	redirectToValidatedOAuthUrl,
} from "./oauthRedirect";

const OAUTH_PROVIDER_LABEL: Record<OAuthRedirectProvider, string> = {
	strava: "Strava",
	fitbit: "Fitbit",
	garmin: "Garmin",
};

/**
 * Start a provider connection through `initiate-oauth`, then redirect only
 * after the returned URL passes `validateOAuthRedirectUrl`.
 *
 * Fitbit and Garmin are unlaunched. `initiate-oauth` refuses them with
 * `provider_unavailable` and mints no state; this helper forwards that
 * refusal through `oauthInitiateError` and does not redirect. Their disabled
 * callbacks answer 410 Gone for every request and do not check `state`
 * (NF-46). A Garmin URL is this project's own `garmin-oauth` function, so
 * the redirect check receives the configured Supabase origin.
 */
export async function initiateOAuthConnect(
	provider: OAuthRedirectProvider,
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
		body: JSON.stringify({ provider }),
	});

	if (!response.ok) {
		throw await oauthInitiateError(OAUTH_PROVIDER_LABEL[provider], response);
	}

	const { url } = await response.json();
	redirectToValidatedOAuthUrl(
		provider,
		url,
		provider === "garmin" ? { supabaseUrl } : undefined,
	);
}
