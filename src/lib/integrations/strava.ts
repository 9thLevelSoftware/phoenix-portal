import { initiateOAuthConnect } from "./initiateOAuthConnect";

/**
 * Initiate Strava OAuth connection via the initiate-oauth Edge Function.
 * The server generates a cryptographic CSRF state token and returns
 * the Strava authorization URL. The request is `initiateOAuthConnect`.
 *
 * @param accessToken - The authenticated user's Supabase JWT access token
 */
export function initiateStravaConnect(accessToken: string): Promise<void> {
	return initiateOAuthConnect("strava", accessToken);
}
