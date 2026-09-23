/**
 * A provider OAuth callback that is out of service (NF-46).
 *
 * Fitbit and Garmin stay "coming soon" until their developer programs approve
 * the app. `initiate-oauth` already refuses to mint state for them
 * (`UNAVAILABLE_OAUTH_PROVIDERS`), but their callbacks are deployed with
 * `verify_jwt = false`, so the endpoints themselves must not do anything: every
 * request gets 410 Gone. The handler reads no environment variable and never
 * calls the provider. When a provider launches, restore its code exchange from
 * git history together with its tests.
 */
export type DisabledOAuthProvider = 'fitbit' | 'garmin';

export function createDisabledOAuthCallbackHandler(
  provider: DisabledOAuthProvider,
): (req: Request) => Response {
  const body = JSON.stringify({ error: 'provider_unavailable', provider });
  return () =>
    new Response(body, {
      status: 410,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}
