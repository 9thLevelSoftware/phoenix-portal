import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

/**
 * Complete OAuth Edge Function (KD-13).
 *
 * Live since PR 48: `strava-oauth` no longer exchanges anything, it relays the
 * provider's response to `/integrations/callback` in the portal, and that page
 * posts it here inside the user's own session.
 *
 * Request: `POST {provider, code, state}` with the user's Supabase JWT
 * (`verify_jwt = true` in supabase/config.toml).
 *
 * F-046: the existing provider callbacks are `verify_jwt=false` GETs that trust
 * the `oauth_states` row alone, so the browser completing the flow is never
 * checked against the account the state was minted for. Here the state row must
 * belong to the *authenticated caller* or nothing happens.
 *
 * State discipline matches `initiate-oauth` / the provider callbacks exactly:
 * expired rows are swept, `expires_at` is re-checked, and the row is deleted on
 * use. The delete is the atomic single-use gate (see `consumeState`).
 *
 * Nothing in a response body, redirect or log line carries `code`, `state` or a
 * token value (PR 63).
 *
 * Environment variables:
 *   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   - STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
 *   - FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET
 *   - OAUTH_TOKEN_ENCRYPTION_KEY (see _shared/oauthTokenCrypto.ts)
 */

/**
 * Providers whose authorization-code grant this endpoint can complete.
 *
 * `fitbit` stays listed although PR 48 made `initiate-oauth` refuse to mint a
 * `fitbit` state token: this list must stay in step with the client's
 * `COMPLETABLE_OAUTH_PROVIDERS`, and completion is unreachable either way,
 * because the state row's `provider` is checked below and no `fitbit` row can
 * exist any more. The provider is launched or withdrawn by editing
 * `UNAVAILABLE_OAUTH_PROVIDERS` in `initiate-oauth`, not this list.
 */
export const COMPLETABLE_PROVIDERS = ['strava', 'fitbit'] as const;
export type CompletableProvider = (typeof COMPLETABLE_PROVIDERS)[number];

/**
 * Garmin is OAuth 1.0a — it has no authorization `code` and its callback
 * carries `oauth_token`/`oauth_verifier` instead, so it can never be completed
 * through this endpoint.
 */
const OAUTH1_PROVIDERS = new Set(['garmin']);

export interface ProviderTokens {
  providerUserId: string;
  accessToken: string;
  refreshToken: string;
  /** ISO-8601, or null when the provider does not report an expiry. */
  tokenExpiresAt: string | null;
}

export type ExchangeOutcome =
  | { ok: true; tokens: ProviderTokens }
  | { ok: false; error: 'auth_failed' | 'token_payload_invalid' | 'provider_not_configured' };

export interface CompleteOAuthAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface CompleteOAuthHandlerDependencies {
  createAuthClient(authorization: string): CompleteOAuthAuthClient;
  createAdminClient(): SupabaseClient;
  exchangeCode(
    provider: CompletableProvider,
    code: string,
  ): Promise<ExchangeOutcome>;
  encryptSecret(value: string): Promise<string>;
  now(): number;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Provider code exchange (live network calls; injected so tests never make one)
// ---------------------------------------------------------------------------

async function exchangeStravaCode(code: string): Promise<ExchangeOutcome> {
  const clientId = Deno.env.get('STRAVA_CLIENT_ID');
  const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    console.error('complete-oauth: STRAVA_CLIENT_ID/SECRET is not configured');
    return { ok: false, error: 'provider_not_configured' };
  }

  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    // Status only — the body can echo the authorization code back.
    console.error('complete-oauth: Strava token exchange failed: status', response.status);
    return { ok: false, error: 'auth_failed' };
  }

  const tokens = await response.json();
  if (
    typeof tokens?.access_token !== 'string' ||
    typeof tokens?.refresh_token !== 'string' ||
    typeof tokens?.expires_at !== 'number' ||
    tokens?.athlete?.id == null
  ) {
    console.error('complete-oauth: Strava token response missing required fields');
    return { ok: false, error: 'token_payload_invalid' };
  }

  return {
    ok: true,
    tokens: {
      providerUserId: String(tokens.athlete.id),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(tokens.expires_at * 1000).toISOString(),
    },
  };
}

async function exchangeFitbitCode(code: string): Promise<ExchangeOutcome> {
  const clientId = Deno.env.get('FITBIT_CLIENT_ID');
  const clientSecret = Deno.env.get('FITBIT_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    console.error('complete-oauth: FITBIT_CLIENT_ID/SECRET is not configured');
    return { ok: false, error: 'provider_not_configured' };
  }

  const redirectUri = `${
    Deno.env.get('SUPABASE_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL')
  }/functions/v1/fitbit-oauth`;

  const response = await fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    console.error('complete-oauth: Fitbit token exchange failed: status', response.status);
    return { ok: false, error: 'auth_failed' };
  }

  const tokens = await response.json();
  if (
    typeof tokens?.access_token !== 'string' ||
    typeof tokens?.refresh_token !== 'string' ||
    typeof tokens?.user_id !== 'string' ||
    typeof tokens?.expires_in !== 'number'
  ) {
    console.error('complete-oauth: Fitbit token response missing required fields');
    return { ok: false, error: 'token_payload_invalid' };
  }

  return {
    ok: true,
    tokens: {
      providerUserId: tokens.user_id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    },
  };
}

function defaultCompleteOAuthDependencies(): CompleteOAuthHandlerDependencies {
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
    },
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    },
    exchangeCode(provider: CompletableProvider, code: string) {
      return provider === 'strava'
        ? exchangeStravaCode(code)
        : exchangeFitbitCode(code);
    },
    async encryptSecret(value: string) {
      // encryptOAuthSecret only returns null/undefined for null/empty input,
      // and the exchange validators reject those before we get here.
      return (await encryptOAuthSecret(value)) as string;
    },
    now() {
      return Date.now();
    },
  };
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

type ParsedBody =
  | { ok: true; provider: CompletableProvider; code: string; state: string }
  | { ok: false; status: number; error: string; message: string };

function parseBody(raw: unknown): ParsedBody {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_body',
      message: 'Expected a JSON object.',
    };
  }

  const record = raw as Record<string, unknown>;
  const provider = record.provider;
  const code = record.code;
  const state = record.state;

  if (typeof provider !== 'string' || provider === '') {
    return {
      ok: false,
      status: 400,
      error: 'invalid_provider',
      message: 'A provider is required.',
    };
  }

  if (OAUTH1_PROVIDERS.has(provider)) {
    return {
      ok: false,
      status: 400,
      error: 'provider_unsupported',
      message: 'This provider does not use an authorization code.',
    };
  }

  if (!(COMPLETABLE_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_provider',
      message: 'Unknown provider.',
    };
  }

  if (typeof code !== 'string' || code === '' || typeof state !== 'string' || state === '') {
    return {
      ok: false,
      status: 400,
      error: 'missing_params',
      message: 'The authorization response was incomplete.',
    };
  }

  return { ok: true, provider: provider as CompletableProvider, code, state };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function completeOAuthHandler(
  req: Request,
  dependencies: CompleteOAuthHandlerDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'method_not_allowed', message: 'Method not allowed' },
      405,
      cors,
    );
  }

  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) {
      return jsonResponse(
        { error: 'unauthorized', message: 'Missing authorization' },
        401,
        cors,
      );
    }

    const { data: { user } } = await dependencies
      .createAuthClient(authorization)
      .auth.getUser();
    if (!user) {
      return jsonResponse(
        { error: 'unauthorized', message: 'Unauthorized' },
        401,
        cors,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonResponse(
        { error: 'invalid_body', message: 'Invalid JSON body' },
        400,
        cors,
      );
    }

    const parsed = parseBody(rawBody);
    if (!parsed.ok) {
      return jsonResponse(
        { error: parsed.error, message: parsed.message },
        parsed.status,
        cors,
      );
    }

    const supabase = dependencies.createAdminClient();

    // Integrations are FLAME. PR 9 gates the *start* of the flow; this endpoint
    // is a fourth callback-like path, so it re-checks rather than inheriting the
    // provider callbacks' documented exemption. Nothing touches the state row
    // until the gate passes, so a denial leaves the flow resumable.
    const gate = await requireSubscription(supabase, user.id, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    const nowMs = dependencies.now();
    const nowIso = new Date(nowMs).toISOString();

    // Sweep expired state tokens (prevents table bloat) — same as the other
    // OAuth functions.
    await supabase.from('oauth_states').delete().lt('expires_at', nowIso);

    const { data: stateRow, error: stateError } = await supabase
      .from('oauth_states')
      .select('user_id, provider, expires_at')
      .eq('state_token', parsed.state)
      .maybeSingle();

    if (stateError || !stateRow) {
      return jsonResponse(
        { error: 'invalid_state', message: 'This connection link is no longer valid.' },
        403,
        cors,
      );
    }

    // F-046: the browser finishing the flow must be the account the state was
    // minted for. Do NOT delete on mismatch — that would let anyone holding a
    // leaked state token cancel its owner's in-flight connection.
    if (stateRow.user_id !== user.id) {
      console.error('complete-oauth: state/session user mismatch');
      return jsonResponse(
        { error: 'state_mismatch', message: 'This connection link belongs to a different account.' },
        403,
        cors,
      );
    }

    if (new Date(stateRow.expires_at).getTime() <= nowMs) {
      await supabase.from('oauth_states').delete().eq('state_token', parsed.state);
      return jsonResponse(
        { error: 'state_expired', message: 'This connection link expired. Please try again.' },
        403,
        cors,
      );
    }

    if (stateRow.provider !== parsed.provider) {
      return jsonResponse(
        { error: 'provider_mismatch', message: 'This connection link was issued for another provider.' },
        403,
        cors,
      );
    }

    // Single-use gate. The DELETE — not the SELECT above — decides: it re-states
    // every condition, so a replay or a concurrent request deletes zero rows and
    // is refused. It runs BEFORE the code exchange, which deliberately departs
    // from strava-oauth's "delete after exchange": the user is already in the
    // portal and can restart with one click, whereas a state that stays live
    // across a multi-second network call is replayable.
    const { data: consumed, error: consumeError } = await supabase
      .from('oauth_states')
      .delete()
      .eq('state_token', parsed.state)
      .eq('user_id', user.id)
      .eq('provider', parsed.provider)
      .gt('expires_at', nowIso)
      .select('id');

    if (consumeError) {
      console.error('complete-oauth: failed to consume state:', consumeError.code);
      return jsonResponse(
        { error: 'state_unavailable', message: 'Could not complete the connection. Please try again.' },
        503,
        cors,
      );
    }

    if (!Array.isArray(consumed) || consumed.length !== 1) {
      return jsonResponse(
        { error: 'state_consumed', message: 'This connection link has already been used.' },
        403,
        cors,
      );
    }

    const exchange = await dependencies.exchangeCode(parsed.provider, parsed.code);
    if (!exchange.ok) {
      const status = exchange.error === 'provider_not_configured' ? 503 : 502;
      return jsonResponse(
        {
          error: exchange.error,
          message: 'Could not complete the connection with the provider. Please try again.',
        },
        status,
        cors,
      );
    }

    const { tokens } = exchange;
    const { error: bindError } = await supabase.rpc('bind_integration_tokens', {
      p_user_id: user.id,
      p_provider: parsed.provider,
      p_provider_user_id: tokens.providerUserId,
      p_access_token: await dependencies.encryptSecret(tokens.accessToken),
      p_refresh_token: await dependencies.encryptSecret(tokens.refreshToken),
      p_token_expires_at: tokens.tokenExpiresAt,
    });

    if (bindError) {
      // The RPC raises already_linked (P0001) from its own pre-check; a request
      // that races another binding of the same provider account loses on
      // idx_user_integrations_provider_user_id_unique (23505) instead. Both mean
      // the same thing to the user, and in both cases nothing was stored.
      const alreadyLinked =
        bindError.code === '23505' ||
        (typeof bindError.message === 'string' &&
          bindError.message.includes('already_linked'));
      if (alreadyLinked) {
        return jsonResponse(
          {
            error: 'already_linked',
            message: 'That account is already connected to another Phoenix user.',
          },
          409,
          cors,
        );
      }
      console.error('complete-oauth: bind_integration_tokens failed:', bindError.code);
      return jsonResponse(
        { error: 'save_failed', message: 'Could not save the connection. Please try again.' },
        500,
        cors,
      );
    }

    // Queue the initial sync, mirroring the provider callbacks. Non-fatal: the
    // tokens are stored and a sync can be triggered manually.
    const { error: queueError } = await supabase.from('sync_queue').insert({
      user_id: user.id,
      provider: parsed.provider,
      sync_type: 'initial',
      status: 'pending',
    });
    if (queueError) {
      console.error('complete-oauth: failed to queue initial sync:', queueError.code);
    }

    return jsonResponse({ connected: parsed.provider }, 200, cors);
  } catch (err) {
    // Never interpolate the caught value: an exchange failure can carry the
    // request URL, and with it the authorization code.
    console.error(
      'complete-oauth error:',
      err instanceof Error ? err.name : 'unknown',
    );
    return jsonResponse(
      { error: 'internal_error', message: 'Internal server error' },
      500,
      cors,
    );
  }
}

export function createCompleteOAuthHandler(
  dependencies: CompleteOAuthHandlerDependencies = defaultCompleteOAuthDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => completeOAuthHandler(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createCompleteOAuthHandler());
}
