import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Strava OAuth Callback Edge Function — RELAY ONLY (KD-13, part 2).
 *
 * Strava redirects the browser here because this URL is what `initiate-oauth`
 * registers as `redirect_uri`. This function no longer exchanges the code and
 * no longer writes `oauth_tokens`, `user_integrations` or `sync_queue`.
 *
 * F-046: this endpoint is `verify_jwt = false` (Strava cannot send a portal
 * JWT), so it has no idea which portal account the browser is signed into. It
 * used to trust the `oauth_states` row alone and store tokens for whoever that
 * row named. Now it only forwards to `/integrations/callback` in the portal,
 * where `complete-oauth` re-checks the state against the *caller's own
 * session* before anything is stored.
 *
 * What it still does is a cheap pre-flight: sweep expired state rows, confirm
 * the state exists, has not expired and was minted for Strava. That turns the
 * common failure modes into a clean error page instead of a portal round-trip.
 * It deliberately does NOT consume the state (`complete-oauth` owns the
 * single-use DELETE) and deliberately does NOT delete the row it looked up on
 * any refusal path: the `state` is attacker-supplied on an unauthenticated
 * endpoint, so a DELETE here would let anyone holding a leaked state token
 * cancel its owner's in-flight connection.
 *
 * PR 63 (no `code`/`state` in a response body, redirect or log line) has one
 * deliberate exception, and it is the whole point of this function: the success
 * 302 carries `code` and `state` to the portal route. That hop is how the
 * provider's response reaches the user's session at all. The portal page reads
 * them once and immediately `history.replaceState`s them out of the address
 * bar, and it renders under `<meta name="referrer" content="no-referrer">`.
 * Every *error* redirect and every log line here stays clean.
 *
 * Expected query params:
 *   - code: Authorization code from Strava
 *   - state: CSRF state token (checked, not consumed, here)
 *   - error: set instead of `code` when the user pressed Authorize's "Cancel"
 *
 * Environment variables:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - APP_URL (portal origin; the provider 302 targets it)
 */

const DEFAULT_APP_URL = 'http://localhost:5173';

export interface StravaOAuthHandlerDependencies {
  createAdminClient(): SupabaseClient;
  /** Portal origin the browser is sent back to. */
  appUrl(): string;
  now(): number;
}

function defaultStravaOAuthDependencies(): StravaOAuthHandlerDependencies {
  return {
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    },
    appUrl() {
      return Deno.env.get('APP_URL') ?? DEFAULT_APP_URL;
    },
    now() {
      return Date.now();
    },
  };
}

/**
 * Build an absolute portal URL. Params go through `URLSearchParams`, never
 * string interpolation, so a value containing `&` or `#` cannot graft extra
 * parameters onto the redirect.
 */
function portalRedirect(
  appUrl: string,
  path: string,
  params: Record<string, string>,
): Response {
  const base = appUrl.replace(/\/+$/, '') || DEFAULT_APP_URL;
  let url: URL;
  try {
    url = new URL(`${base}${path}`);
  } catch {
    // A misconfigured APP_URL must not turn into a 500 that strands the user
    // on a Supabase error page.
    console.error('strava-oauth: APP_URL is not a valid absolute URL');
    url = new URL(`${DEFAULT_APP_URL}${path}`);
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return Response.redirect(url.toString(), 302);
}

/** Error redirects never carry `code` or `state`. */
function failure(appUrl: string, slug: string): Response {
  return portalRedirect(appUrl, '/integrations', { error: slug });
}

async function stravaOAuthHandler(
  req: Request,
  dependencies: StravaOAuthHandlerDependencies,
): Promise<Response> {
  const appUrl = dependencies.appUrl();

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return failure(appUrl, 'missing_params');
  }

  // The user pressed Cancel on Strava's consent screen (or Strava refused).
  // Nothing to forward; the state row is left to expire on its own.
  if (url.searchParams.get('error')) {
    return failure(appUrl, 'access_denied');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return failure(appUrl, 'missing_params');
  }

  try {
    const supabase = dependencies.createAdminClient();

    const nowMs = dependencies.now();
    const nowIso = new Date(nowMs).toISOString();

    // Clean up expired state tokens (prevents table bloat). This is the only
    // DELETE this function issues, and its predicate is time, not the
    // attacker-supplied `state`.
    await supabase.from('oauth_states').delete().lt('expires_at', nowIso);

    const { data: stateRow, error: stateError } = await supabase
      .from('oauth_states')
      .select('provider, expires_at')
      .eq('state_token', state)
      .maybeSingle();

    if (stateError || !stateRow) {
      return failure(appUrl, 'invalid_state');
    }

    if (new Date(stateRow.expires_at).getTime() <= nowMs) {
      // Refuse, but leave the row for the sweep: see the header note on why
      // this function never deletes a row keyed by the supplied state.
      return failure(appUrl, 'state_expired');
    }

    if (stateRow.provider !== 'strava') {
      return failure(appUrl, 'provider_mismatch');
    }

    // Hand the provider's response to the portal session. `complete-oauth`
    // re-runs every check above against the authenticated caller and is the
    // only thing that consumes the state or stores a token.
    return portalRedirect(appUrl, '/integrations/callback', {
      provider: 'strava',
      code,
      state,
    });

    if (queueError) {
      // A reconnect while the first initial import is still queued or running
      // hits `sync_queue_one_active` (23505). That is the intended outcome —
      // the import is already on its way — so it is not even worth an error.
      if ((queueError as { code?: string }).code === '23505') {
        console.log('Strava initial sync already queued for this user');
      } else {
        // Non-fatal: tokens are saved, sync can be triggered manually later
        console.error('Failed to queue initial sync:', queueError);
      }
    }

    // ----------------------------------------------------------------
    // Redirect back to the portal
    // ----------------------------------------------------------------
    return Response.redirect(
      `${APP_URL()}/integrations?connected=strava`,
      302
    );
  } catch (err) {
    // Name only: a thrown fetch/URL error can carry the request URL, and with
    // it the authorization code.
    console.error(
      'strava-oauth error:',
      err instanceof Error ? err.name : 'unknown',
    );
    return failure(appUrl, 'auth_failed');
  }
}

export function createStravaOAuthHandler(
  dependencies: StravaOAuthHandlerDependencies = defaultStravaOAuthDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => stravaOAuthHandler(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createStravaOAuthHandler());
}
