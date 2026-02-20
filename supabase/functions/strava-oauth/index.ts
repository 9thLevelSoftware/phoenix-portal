import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Strava OAuth Callback Edge Function
 *
 * Handles the redirect from Strava after user authorizes the app.
 * Exchanges the authorization code for tokens, stores them in user_integrations,
 * and queues an initial sync.
 *
 * Expected query params:
 *   - code: Authorization code from Strava
 *   - state: User ID (passed through OAuth state parameter)
 *   - scope: Granted scopes (informational)
 *
 * Environment variables:
 *   - STRAVA_CLIENT_ID
 *   - STRAVA_CLIENT_SECRET
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - APP_URL (portal URL for redirect after OAuth)
 */

const APP_URL = () => Deno.env.get('APP_URL') ?? 'http://localhost:5173';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // user_id

  // ------------------------------------------------------------------
  // Validate required params
  // ------------------------------------------------------------------
  if (!code || !state) {
    return Response.redirect(
      `${APP_URL()}/integrations?error=missing_params`,
      302
    );
  }

  const userId = state;

  try {
    // ----------------------------------------------------------------
    // Exchange authorization code for tokens
    // ----------------------------------------------------------------
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: Deno.env.get('STRAVA_CLIENT_ID'),
        client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      console.error(
        'Strava token exchange failed:',
        tokenResponse.status,
        await tokenResponse.text()
      );
      return Response.redirect(
        `${APP_URL()}/integrations?error=auth_failed`,
        302
      );
    }

    const tokens = await tokenResponse.json();

    // tokens shape: { token_type, expires_at, expires_in, refresh_token, access_token, athlete: { id, ... } }
    const providerUserId = String(tokens.athlete.id);
    const accessToken: string = tokens.access_token;
    const refreshToken: string = tokens.refresh_token;
    const tokenExpiresAt = new Date(tokens.expires_at * 1000).toISOString();

    // ----------------------------------------------------------------
    // Store tokens in user_integrations (service role for server-side write)
    // ----------------------------------------------------------------
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error: upsertError } = await supabase
      .from('user_integrations')
      .upsert(
        {
          user_id: userId,
          provider: 'strava',
          provider_user_id: providerUserId,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: tokenExpiresAt,
          status: 'connected',
          connected_at: new Date().toISOString(),
          error_message: null,
        },
        { onConflict: 'user_id,provider' }
      );

    if (upsertError) {
      console.error('Failed to store Strava tokens:', upsertError);
      return Response.redirect(
        `${APP_URL()}/integrations?error=save_failed`,
        302
      );
    }

    // ----------------------------------------------------------------
    // Queue initial sync
    // ----------------------------------------------------------------
    const { error: queueError } = await supabase.from('sync_queue').insert({
      user_id: userId,
      provider: 'strava',
      sync_type: 'initial',
      status: 'pending',
    });

    if (queueError) {
      // Non-fatal: tokens are saved, sync can be triggered manually later
      console.error('Failed to queue initial sync:', queueError);
    }

    // ----------------------------------------------------------------
    // Redirect back to the portal
    // ----------------------------------------------------------------
    return Response.redirect(
      `${APP_URL()}/integrations?connected=strava`,
      302
    );
  } catch (err) {
    console.error('Strava OAuth error:', err);
    return Response.redirect(
      `${APP_URL()}/integrations?error=auth_failed`,
      302
    );
  }
});
