import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { requireSubscription } from '../_shared/requireSubscription.ts';

const PUBLIC_SUPABASE_URL =
  Deno.env.get('SUPABASE_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL')!;

/**
 * Initiate OAuth Edge Function
 *
 * Authenticates the user via JWT, generates a cryptographic state token,
 * stores it in `oauth_states` with a 10-minute expiry, and returns the
 * provider-specific authorization URL.
 *
 * Request body:
 *   - provider: 'strava' | 'fitbit' | 'garmin'
 *
 * Returns:
 *   - { url: string } - The provider authorization URL to redirect to
 *
 * Environment variables:
 *   - SUPABASE_URL, SUPABASE_PUBLIC_URL
 *   - SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - STRAVA_CLIENT_ID
 */

/** Providers the portal can actually start a connection for today. */
export const LAUNCHED_OAUTH_PROVIDERS = ['strava'] as const;

/**
 * Providers whose UI card says "coming soon" because their developer-program
 * application is still pending. The handlers exist, but minting a state token
 * for them would send the user to a consent screen that cannot succeed — and,
 * for Fitbit, would leave a live `fitbit` state row that the (still
 * `verify_jwt = false`) `fitbit-oauth` callback would honour. Refusing here is
 * what takes that path out of service.
 *
 * `complete-oauth` still lists `fitbit` in `COMPLETABLE_PROVIDERS` (and the
 * client in `COMPLETABLE_OAUTH_PROVIDERS`) on purpose: those stay in step with
 * each other, and completion is unreachable regardless, because
 * `complete-oauth` refuses any state row whose `provider` does not match — and
 * no `fitbit` row can be minted any more. Deleting `fitbit` from that pair when
 * the developer program approves would be the wrong direction of change; delete
 * it from this set instead.
 */
export const UNAVAILABLE_OAUTH_PROVIDERS = ['fitbit', 'garmin'] as const;

const KNOWN_PROVIDERS = new Set<string>([
  ...LAUNCHED_OAUTH_PROVIDERS,
  ...UNAVAILABLE_OAUTH_PROVIDERS,
]);
const UNAVAILABLE = new Set<string>(UNAVAILABLE_OAUTH_PROVIDERS);

/** State tokens minted per user per hour. */
const STATE_MINTS_PER_HOUR = 10;

export interface InitiateOAuthAuthClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

export interface InitiateOAuthHandlerDependencies {
  createAuthClient(authorization: string): InitiateOAuthAuthClient;
  createAdminClient(): SupabaseClient;
  /** Read an environment variable (injected so tests never touch Deno.env). */
  env(name: string): string | undefined;
  newStateToken(): string;
  now(): number;
}

function defaultInitiateOAuthDependencies(): InitiateOAuthHandlerDependencies {
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
    env(name: string) {
      return Deno.env.get(name);
    },
    newStateToken() {
      return crypto.randomUUID();
    },
    now() {
      return Date.now();
    },
  };
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

async function initiateOAuthHandler(
  req: Request,
  dependencies: InitiateOAuthHandlerDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Authenticate user via JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401, cors);
    }

    const { data: { user } } = await dependencies
      .createAuthClient(authHeader)
      .auth.getUser();
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401, cors);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
    }

    const provider = (body as Record<string, unknown> | null)?.provider;
    if (typeof provider !== 'string' || !KNOWN_PROVIDERS.has(provider)) {
      return jsonResponse({ error: 'Invalid provider' }, 400, cors);
    }

    // Refuse the not-yet-launched providers before anything touches the
    // database. This is a constant-time check on a constant set, so it is
    // cheaper than the rate-limit call below and deliberately sits in front of
    // it: spamming it costs the database nothing.
    if (UNAVAILABLE.has(provider)) {
      return jsonResponse(
        {
          error: 'provider_unavailable',
          message:
            'This connection is coming soon. It is not available yet, so we did not start it.',
        },
        400,
        cors,
      );
    }

    const supabase = dependencies.createAdminClient();

    // State minting is the one unauthenticated-callback entry point an account
    // can create, so cap how fast an account can create them. Everything that
    // touches the database sits behind this (delete-account uses the same
    // shape: authenticate, then rate-limit, then work).
    const rateCheck = await checkRateLimit(supabase, {
      key: 'initiate-oauth',
      userId: user.id,
      maxRequests: STATE_MINTS_PER_HOUR,
      windowSeconds: 3600,
    }, cors);
    if (!rateCheck.allowed) return rateCheck.response!;

    // Integrations are a FLAME feature; enforce it before any OAuth state is
    // created (402 below FLAME, 503 if the subscription lookup fails).
    const gate = await requireSubscription(supabase, user.id, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    const nowMs = dependencies.now();

    // Integrations are a FLAME feature; enforce it before any OAuth state is
    // created (402 below FLAME, 503 if the subscription lookup fails).
    const gate = await requireSubscription(supabase, user.id, 'FLAME', cors);
    if (!gate.allowed) return gate.response;

    // Clean up expired state tokens (prevents table bloat)
    await supabase
      .from('oauth_states')
      .delete()
      .lt('expires_at', new Date(nowMs).toISOString());

    // Generate cryptographic state token
    const stateToken = dependencies.newStateToken();
    const expiresAt = new Date(nowMs + 10 * 60 * 1000).toISOString(); // 10 min

    // Validate required provider configuration before persisting state, so we never
    // hand back a malformed authorization URL (e.g. client_id=undefined) for a state
    // row that was already inserted.
    const clientId = dependencies.env('STRAVA_CLIENT_ID');
    if (!clientId) {
      console.error('Initiate OAuth: STRAVA_CLIENT_ID is not configured');
      return jsonResponse({ error: 'Provider not configured' }, 503, cors);
    }

    const publicSupabaseUrl = dependencies.env('SUPABASE_PUBLIC_URL') ??
      dependencies.env('SUPABASE_URL');
    if (!publicSupabaseUrl) {
      console.error('Initiate OAuth: SUPABASE_URL is not configured');
      return jsonResponse({ error: 'Provider not configured' }, 503, cors);
    }

    const { error: stateInsertError } = await supabase.from('oauth_states').insert({
      state_token: stateToken,
      user_id: user.id,
      provider,
      expires_at: expiresAt,
    });

    if (stateInsertError) {
      // Persisting the state failed — the callback would later reject with
      // invalid_state. Fail loudly here instead of returning a doomed auth URL.
      console.error(
        'Initiate OAuth: failed to persist state token:',
        stateInsertError.code,
      );
      return jsonResponse({ error: 'Failed to start OAuth flow' }, 500, cors);
    }

    // `redirect_uri` stays the Edge Function, because that is what is
    // registered with Strava. It now relays to `/integrations/callback` in the
    // portal instead of exchanging the code itself (KD-13). Moving the
    // registered URI to the portal means changing `strava-oauth` in the same
    // change.
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${publicSupabaseUrl}/functions/v1/strava-oauth`,
      response_type: 'code',
      scope: 'activity:read_all',
      state: stateToken,
      // `force`, not `auto`: with `auto` Strava silently re-issues the previous
      // grant, so a user reconnecting after a scope change, a revoke, or to fix
      // a broken link never sees what they are approving and cannot widen the
      // scope. It also means a connect started from a hijacked tab can complete
      // without the account owner ever seeing a consent screen.
      approval_prompt: 'force',
    });

    return jsonResponse(
      { url: `https://www.strava.com/oauth/authorize?${params}` },
      200,
      cors,
    );
  } catch (err) {
    console.error(
      'Initiate OAuth error:',
      err instanceof Error ? err.name : 'unknown',
    );
    return jsonResponse({ error: 'Internal server error' }, 500, cors);
  }
}

export function createInitiateOAuthHandler(
  dependencies: InitiateOAuthHandlerDependencies = defaultInitiateOAuthDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => initiateOAuthHandler(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createInitiateOAuthHandler());
}
