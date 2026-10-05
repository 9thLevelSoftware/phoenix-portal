import { initiateOAuthConnect } from "./oauthRedirect";

/**
 * Initiate Garmin Connect OAuth 1.0a connection via the initiate-oauth Edge Function.
 * A refusal from that function is forwarded (`oauthInitiateError`). Garmin
 * is unlaunched, so the refusal is `provider_unavailable` and no state is
 * minted. The disabled `garmin-oauth` callback does not check `state`; it
 * answers 410 Gone for every request (NF-46). A URL that does come back is
 * still checked against this project's Supabase origin and
 * `/functions/v1/garmin-oauth` (`initiateOAuthConnect`).
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 */
export function initiateGarminConnect(accessToken: string): Promise<void> {
	return initiateOAuthConnect("garmin", accessToken);
}
