import { checkRateLimit } from './rateLimit.ts';

/**
 * Per-user budgets for browser-initiated (JWT) provider syncs. One definition
 * for all four sync handlers so the numbers cannot drift apart.
 *
 * The bucket counts INVOCATIONS, not provider requests: the gate runs before
 * the subscription gate and the "is this provider connected" lookup, so a
 * refused 402/404 spends a token too. That is deliberate — failing fast also
 * caps the DB work an unentitled caller can force — but it means "3 syncs per
 * 15 minutes" is an upper bound on calls, not on provider traffic.
 */
export const MANUAL_SYNC_MAX_REQUESTS = 3;
export const MANUAL_SYNC_WINDOW_SECONDS = 900;

/**
 * Credential writes get their own, larger budget.
 *
 * For the API-key providers (hevy, liftosaur) invoking `<provider>-sync` with
 * `body.api_key` is the ONLY way to store a key — the browser cannot write
 * `oauth_tokens`. They also carry no provider-quota argument: an API key is
 * per user, unlike Strava's application-wide read quota. An API-key call is
 * charged to this bucket ONLY (NF-27): charging it to the ordinary sync bucket
 * as well let three mistyped keys lock a user out of saving the corrected one.
 * This bucket still bounds the provider reads that key saves trigger.
 */
export const CREDENTIAL_WRITE_MAX_REQUESTS = 10;

/**
 * Enforce the manual-sync budget for `provider` on the JWT path.
 *
 * `credentialWrite` routes to the `<provider>-sync-connect` bucket. Both keys
 * are distinct from the `<provider>` rows `process-sync-queue` accounts its
 * own per-provider budget to, so none of the three can cannibalise another.
 */
export function checkManualSyncRateLimit(
  supabase: Parameters<typeof checkRateLimit>[0],
  options: {
    provider: string;
    userId: string;
    credentialWrite?: boolean;
  },
  corsHeaders: Record<string, string>,
): ReturnType<typeof checkRateLimit> {
  const { provider, userId, credentialWrite = false } = options;
  return checkRateLimit(
    supabase,
    credentialWrite
      ? {
        key: `${provider}-sync-connect`,
        userId,
        maxRequests: CREDENTIAL_WRITE_MAX_REQUESTS,
        windowSeconds: MANUAL_SYNC_WINDOW_SECONDS,
      }
      : {
        key: `${provider}-sync`,
        userId,
        maxRequests: MANUAL_SYNC_MAX_REQUESTS,
        windowSeconds: MANUAL_SYNC_WINDOW_SECONDS,
      },
    corsHeaders,
  );
}
