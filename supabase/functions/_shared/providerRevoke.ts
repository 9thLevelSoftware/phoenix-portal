/**
 * Provider grant revocation and the single disconnect path (FP-5, PR 54).
 *
 * `disconnect-integration`, the mobile disconnect action in
 * `mobile-integration-sync` and the account purge (`accountPurge.ts`) all
 * disconnect through `revokeAndDisconnect`, in this order:
 *
 *   1. read the stored token and decrypt it
 *   2. revoke the grant at the provider (best effort); for Strava, first
 *      refresh an expired access token
 *   3. `rpc('disconnect_integration')`, which deletes the token, resets the
 *      integration and cancels queued syncs in one transaction
 *
 * Revocation is best effort: a provider error, a timeout or an undecryptable
 * token is logged (never with token text) and the local token is still
 * deleted by step 3. A database error in step 1 or 3 fails the disconnect so
 * the caller can report it and the user can retry.
 *
 * Why revoke comes before the RPC (review R-6): the revoke needs the token
 * and the RPC deletes it. Revoking first means an RPC failure leaves a clean,
 * idempotent retry: the row still exists (with a refreshed Strava pair
 * persisted, see below), a second revoke of a dead grant just logs a
 * warning, and the RPC then succeeds. The cost is that, until that retry,
 * the integration still shows `connected` with a token the provider no
 * longer honours. Running the RPC first would avoid that window, but a crash
 * or timeout between the RPC and the revoke would then lose the token for
 * good and leave the grant live with no way to revoke it. Revoke-first keeps
 * every failure retryable, so it is kept.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { signedGarminAuthorization } from './garminOAuth1.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from './oauthTokenCrypto.ts';
import {
  refreshStravaAccessToken,
  StravaRefreshError,
  stravaTokenNeedsRefresh,
} from './stravaToken.ts';

const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const FITBIT_REVOKE_URL = 'https://api.fitbit.com/oauth2/revoke';
const GARMIN_DEREGISTRATION_URL = 'https://apis.garmin.com/wellness-api/rest/user/registration';
const REVOKE_TIMEOUT_MS = 10_000;

/**
 * Providers with a server-side grant we can revoke. Hevy and Liftosaur use
 * user-supplied API keys and Apple Health / Google Health Connect are
 * device-local, so they have nothing to revoke.
 */
const REVOCABLE_PROVIDERS = new Set(['strava', 'fitbit', 'garmin']);

export interface ProviderTokens {
  accessToken?: string | null;
  refreshToken?: string | null;
  /** `oauth_tokens.token_expires_at` (ISO), or null. */
  tokenExpiresAt?: string | null;
}

export interface ProviderRevokeDependencies {
  fetch: typeof fetch;
  fitbitClientId: string | undefined;
  fitbitClientSecret: string | undefined;
  stravaClientId: string | undefined;
  stravaClientSecret: string | undefined;
  garminConsumerKey: string | undefined;
  garminConsumerSecret: string | undefined;
}

export function defaultProviderRevokeDependencies(): ProviderRevokeDependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    fitbitClientId: Deno.env.get('FITBIT_CLIENT_ID'),
    fitbitClientSecret: Deno.env.get('FITBIT_CLIENT_SECRET'),
    stravaClientId: Deno.env.get('STRAVA_CLIENT_ID'),
    stravaClientSecret: Deno.env.get('STRAVA_CLIENT_SECRET'),
    garminConsumerKey: Deno.env.get('GARMIN_CONSUMER_KEY'),
    garminConsumerSecret: Deno.env.get('GARMIN_CONSUMER_SECRET'),
  };
}

/**
 * `ok: true` means the provider accepted the request (2xx). It is not proof
 * that the grant is gone: Fitbit's revoke endpoint follows RFC 7009 and
 * answers 200 even for an unknown or already-invalid token, e.g. a refresh
 * token that fitbit-sync rotated but failed to persist (review R-5).
 */
export type ProviderRevokeResult =
  | { attempted: false; reason: string }
  | { attempted: true; ok: boolean; status: number | null };

export function isRevocableProvider(provider: string): boolean {
  return REVOCABLE_PROVIDERS.has(provider);
}

async function send(
  deps: ProviderRevokeDependencies,
  url: string,
  init: RequestInit,
): Promise<ProviderRevokeResult> {
  try {
    const res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS) });
    // Drain without reading: Strava's deauthorize response echoes the token.
    await res.body?.cancel();
    return { attempted: true, ok: res.ok, status: res.status };
  } catch {
    // The error can carry the request; never log it.
    return { attempted: true, ok: false, status: null };
  }
}

/**
 * Revokes the user's grant at `provider` with already-fresh tokens. Never
 * throws, and never logs or returns the token or the provider's response
 * body.
 */
export async function providerRevoke(
  provider: string,
  tokens: ProviderTokens,
  deps: ProviderRevokeDependencies = defaultProviderRevokeDependencies(),
): Promise<ProviderRevokeResult> {
  if (provider === 'strava') {
    if (!tokens.accessToken) return { attempted: false, reason: 'no_access_token' };
    return await send(deps, STRAVA_DEAUTHORIZE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: tokens.accessToken }),
    });
  }

  if (provider === 'fitbit') {
    // Revoking the refresh token revokes the whole grant; the access token
    // is the fallback when no refresh token is stored.
    const token = tokens.refreshToken || tokens.accessToken;
    if (!token) return { attempted: false, reason: 'no_token' };
    if (!deps.fitbitClientId || !deps.fitbitClientSecret) {
      return { attempted: false, reason: 'fitbit_client_not_configured' };
    }
    return await send(deps, FITBIT_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${deps.fitbitClientId}:${deps.fitbitClientSecret}`)}`,
      },
      body: new URLSearchParams({ token }),
    });
  }

  if (provider === 'garmin') {
    // OAuth 1.0a: access_token holds the permanent token and refresh_token
    // its secret (garmin-oauth). A row with an expiry is a pending request
    // token from an unfinished connect, which Garmin never registered.
    if (tokens.tokenExpiresAt) return { attempted: false, reason: 'garmin_pending_request_token' };
    if (!tokens.accessToken || !tokens.refreshToken) {
      return { attempted: false, reason: 'no_token' };
    }
    if (!deps.garminConsumerKey || !deps.garminConsumerSecret) {
      return { attempted: false, reason: 'garmin_client_not_configured' };
    }
    let authorization: string;
    try {
      authorization = await signedGarminAuthorization('DELETE', GARMIN_DEREGISTRATION_URL, {
        consumerKey: deps.garminConsumerKey,
        consumerSecret: deps.garminConsumerSecret,
        token: tokens.accessToken,
        tokenSecret: tokens.refreshToken,
      });
    } catch {
      return { attempted: false, reason: 'garmin_signing_failed' };
    }
    return await send(deps, GARMIN_DEREGISTRATION_URL, {
      method: 'DELETE',
      headers: { Authorization: authorization },
    });
  }

  return { attempted: false, reason: 'provider_not_revocable' };
}

export type DisconnectResult =
  | { ok: true; revoke: ProviderRevokeResult }
  | { ok: false; stage: 'token_read' | 'disconnect_rpc'; detail: string };

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: string; message?: string };
    return [code, message].filter(Boolean).join(': ') || 'unknown error';
  }
  return String(error);
}

async function readTokens(
  admin: SupabaseClient,
  userId: string,
  provider: string,
): Promise<{ ok: true; tokens: ProviderTokens | null } | { ok: false; detail: string }> {
  const { data, error } = await admin
    .from('oauth_tokens')
    .select('access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) return { ok: false, detail: describe(error) };
  if (!data) return { ok: true, tokens: null };
  const row = data as {
    access_token?: string | null;
    refresh_token?: string | null;
    token_expires_at?: string | null;
  };
  try {
    return {
      ok: true,
      tokens: {
        accessToken: (await decryptOAuthSecret(row.access_token)) ?? null,
        refreshToken: (await decryptOAuthSecret(row.refresh_token)) ?? null,
        tokenExpiresAt: row.token_expires_at ?? null,
      },
    };
  } catch (err) {
    // A missing key or corrupt ciphertext is permanent: retrying cannot help,
    // so skip the revoke and still delete the local token. The error is one
    // of the crypto module's fixed codes, never token text.
    console.error('[PROVIDER_REVOKE] token decrypt failed; revoke skipped', {
      user_id: userId,
      provider,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return { ok: true, tokens: null };
  }
}

/**
 * Strava access tokens expire after about 6 hours and are only refreshed
 * when a sync runs, so the stored one has usually expired and deauthorize
 * would answer 401 (review R-1/R-3/R-11/R-13). Refresh it first.
 *
 * The refreshed pair is persisted before the revoke: Strava may rotate the
 * refresh token, and if the RPC then fails the row survives, so a retry (or
 * a later sync) must find the current refresh token. The persist uses
 * `update`, so it can never recreate a deleted row. A persist failure is
 * logged and the revoke still goes ahead.
 *
 * Returns the tokens to revoke with, or a skip reason when the refresh
 * failed.
 */
async function freshStravaTokens(
  admin: SupabaseClient,
  userId: string,
  tokens: ProviderTokens,
  deps: ProviderRevokeDependencies,
): Promise<{ tokens: ProviderTokens } | { skip: string }> {
  if (tokens.accessToken && !stravaTokenNeedsRefresh(tokens.tokenExpiresAt)) {
    return { tokens };
  }
  if (!tokens.refreshToken) {
    // Cannot refresh: try the stored access token (its recorded expiry may
    // be stale); a 401 is logged as a failed revoke.
    return tokens.accessToken ? { tokens } : { skip: 'strava_no_token' };
  }

  let refreshed;
  try {
    refreshed = await refreshStravaAccessToken(tokens.refreshToken, {
      fetch: deps.fetch,
      clientId: deps.stravaClientId,
      clientSecret: deps.stravaClientSecret,
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[PROVIDER_REVOKE] strava token refresh failed; revoke skipped', {
      user_id: userId,
      provider: 'strava',
      status: err instanceof StravaRefreshError ? err.status : null,
    });
    return { skip: 'strava_refresh_failed' };
  }

  const expiresAt = new Date(refreshed.expires_at * 1000).toISOString();
  try {
    const { error } = await admin
      .from('oauth_tokens')
      .update({
        access_token: await encryptOAuthSecret(refreshed.access_token),
        refresh_token: await encryptOAuthSecret(refreshed.refresh_token),
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', 'strava');
    if (error) throw error;
  } catch (err) {
    console.warn('[PROVIDER_REVOKE] refreshed strava tokens not persisted; revoking anyway', {
      user_id: userId,
      provider: 'strava',
      error: err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : 'unknown',
    });
  }
  return {
    tokens: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiresAt: expiresAt,
    },
  };
}

async function revokeStored(
  admin: SupabaseClient,
  userId: string,
  provider: string,
  tokens: ProviderTokens,
  deps: ProviderRevokeDependencies,
): Promise<ProviderRevokeResult> {
  if (provider === 'strava') {
    const fresh = await freshStravaTokens(admin, userId, tokens, deps);
    if ('skip' in fresh) return { attempted: false, reason: fresh.skip };
    return await providerRevoke(provider, fresh.tokens, deps);
  }
  return await providerRevoke(provider, tokens, deps);
}

/**
 * The one disconnect path: read and decrypt, revoke, then
 * `disconnect_integration`. Returns `ok: false` only for database errors.
 */
export async function revokeAndDisconnect(
  admin: SupabaseClient,
  userId: string,
  provider: string,
  deps: ProviderRevokeDependencies = defaultProviderRevokeDependencies(),
): Promise<DisconnectResult> {
  let revoke: ProviderRevokeResult = { attempted: false, reason: 'provider_not_revocable' };

  if (isRevocableProvider(provider)) {
    const read = await readTokens(admin, userId, provider);
    if (!read.ok) {
      console.error('[PROVIDER_REVOKE] token read failed; disconnect aborted', {
        user_id: userId,
        provider,
        detail: read.detail,
      });
      return { ok: false, stage: 'token_read', detail: read.detail };
    }
    revoke = read.tokens
      ? await revokeStored(admin, userId, provider, read.tokens, deps)
      : { attempted: false, reason: 'no_stored_token' };
    if (revoke.attempted && !revoke.ok) {
      console.warn('[PROVIDER_REVOKE] provider revoke failed; local token still deleted', {
        user_id: userId,
        provider,
        status: revoke.status,
      });
    } else if (!revoke.attempted && revoke.reason !== 'no_stored_token') {
      console.warn('[PROVIDER_REVOKE] provider revoke skipped', {
        user_id: userId,
        provider,
        reason: revoke.reason,
      });
    }
  }

  const { error } = await admin.rpc('disconnect_integration', {
    p_user_id: userId,
    p_provider: provider,
    p_timestamp: new Date().toISOString(),
  });
  if (error) {
    const detail = describe(error);
    console.error('[PROVIDER_REVOKE] disconnect_integration failed', {
      user_id: userId,
      provider,
      detail,
    });
    return { ok: false, stage: 'disconnect_rpc', detail };
  }
  return { ok: true, revoke };
}
