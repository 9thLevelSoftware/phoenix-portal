/**
 * Provider grant revocation and the single disconnect path (FP-5, PR 54).
 *
 * `disconnect-integration`, the mobile disconnect action in
 * `mobile-integration-sync` and the account purge (`accountPurge.ts`) all
 * disconnect through `revokeAndDisconnect`, in this order:
 *
 *   1. read the stored token and decrypt it
 *   2. revoke the grant at the provider (best effort)
 *   3. `rpc('disconnect_integration')`, which deletes the token, resets the
 *      integration and cancels queued syncs in one transaction
 *
 * Revocation is best effort: a provider error, a timeout or an undecryptable
 * token is logged (never with token text) and the local token is still
 * deleted by step 3. A database error in step 1 or 3 fails the disconnect so
 * the caller can report it and the user can retry.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decryptOAuthSecret } from './oauthTokenCrypto.ts';

const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const FITBIT_REVOKE_URL = 'https://api.fitbit.com/oauth2/revoke';
const REVOKE_TIMEOUT_MS = 10_000;

/** Providers whose grant can be revoked server-side. */
const REVOCABLE_PROVIDERS = new Set(['strava', 'fitbit']);

export interface ProviderTokens {
  accessToken?: string | null;
  refreshToken?: string | null;
}

export interface ProviderRevokeDependencies {
  fetch: typeof fetch;
  fitbitClientId: string | undefined;
  fitbitClientSecret: string | undefined;
}

export function defaultProviderRevokeDependencies(): ProviderRevokeDependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    fitbitClientId: Deno.env.get('FITBIT_CLIENT_ID'),
    fitbitClientSecret: Deno.env.get('FITBIT_CLIENT_SECRET'),
  };
}

export type ProviderRevokeResult =
  | { attempted: false; reason: string }
  | { attempted: true; ok: boolean; status: number | null };

export function isRevocableProvider(provider: string): boolean {
  return REVOCABLE_PROVIDERS.has(provider);
}

/**
 * Revokes the user's grant at `provider`. Never throws, and never logs or
 * returns the token or the provider's response body (Strava's deauthorize
 * response echoes the access token).
 */
export async function providerRevoke(
  provider: string,
  tokens: ProviderTokens,
  deps: ProviderRevokeDependencies = defaultProviderRevokeDependencies(),
): Promise<ProviderRevokeResult> {
  let url: string;
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  let body: URLSearchParams;

  if (provider === 'strava') {
    if (!tokens.accessToken) return { attempted: false, reason: 'no_access_token' };
    url = STRAVA_DEAUTHORIZE_URL;
    body = new URLSearchParams({ access_token: tokens.accessToken });
  } else if (provider === 'fitbit') {
    // Revoking the refresh token revokes the whole grant; the access token
    // is the fallback when no refresh token is stored.
    const token = tokens.refreshToken || tokens.accessToken;
    if (!token) return { attempted: false, reason: 'no_token' };
    if (!deps.fitbitClientId || !deps.fitbitClientSecret) {
      return { attempted: false, reason: 'fitbit_client_not_configured' };
    }
    url = FITBIT_REVOKE_URL;
    headers.Authorization = `Basic ${btoa(`${deps.fitbitClientId}:${deps.fitbitClientSecret}`)}`;
    body = new URLSearchParams({ token });
  } else {
    return { attempted: false, reason: 'provider_not_revocable' };
  }

  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    // Drain without reading the body into a log.
    await res.body?.cancel();
    return { attempted: true, ok: res.ok, status: res.status };
  } catch {
    return { attempted: true, ok: false, status: null };
  }
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
    .select('access_token, refresh_token')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) return { ok: false, detail: describe(error) };
  if (!data) return { ok: true, tokens: null };
  const row = data as { access_token?: string | null; refresh_token?: string | null };
  try {
    return {
      ok: true,
      tokens: {
        accessToken: (await decryptOAuthSecret(row.access_token)) ?? null,
        refreshToken: (await decryptOAuthSecret(row.refresh_token)) ?? null,
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
      ? await providerRevoke(provider, read.tokens, deps)
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
