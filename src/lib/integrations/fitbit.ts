import { initiateOAuthConnect } from "./oauthRedirect";

/**
 * Initiate Fitbit OAuth 2.0 connection via the initiate-oauth Edge Function.
 * A refusal from that function is forwarded (`oauthInitiateError`). Fitbit
 * is unlaunched, so the refusal is `provider_unavailable` and no state is
 * minted. The disabled `fitbit-oauth` callback does not check `state`; it
 * answers 410 Gone for every request (NF-46). The request is
 * `initiateOAuthConnect`.
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 */
export function initiateFitbitConnect(accessToken: string): Promise<void> {
	return initiateOAuthConnect("fitbit", accessToken);
}
