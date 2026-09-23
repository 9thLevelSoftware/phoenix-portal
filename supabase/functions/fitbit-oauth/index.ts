/**
 * Fitbit OAuth callback: out of service (NF-46).
 *
 * Fitbit is not launched, and `initiate-oauth` refuses to mint `fitbit` state.
 * This `verify_jwt = false` endpoint answers 410 Gone to every request; see
 * `_shared/disabledOAuthCallback.ts`.
 */
import { createDisabledOAuthCallbackHandler } from '../_shared/disabledOAuthCallback.ts';

export const handler = createDisabledOAuthCallbackHandler('fitbit');

if (import.meta.main) {
  Deno.serve(handler);
}
