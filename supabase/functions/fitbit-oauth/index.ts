import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const FITBIT_CLIENT_ID = Deno.env.get('FITBIT_CLIENT_ID')!;
const FITBIT_CLIENT_SECRET = Deno.env.get('FITBIT_CLIENT_SECRET')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173';

/**
 * Fitbit OAuth 2.0 callback handler.
 *
 * Fitbit uses standard Authorization Code flow but requires Basic auth header
 * for the token exchange (base64-encoded client_id:client_secret).
 *
 * Flow: User redirected from Fitbit -> this function -> exchanges code -> stores tokens -> redirects to app.
 */
Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // Contains user_id

    if (!code || !state) {
      return Response.redirect(`${APP_URL}/integrations?error=missing_params`);
    }

    // Fitbit requires Basic auth: base64(client_id:client_secret)
    const basicAuth = btoa(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`);
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/fitbit-oauth`;

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error('Fitbit token exchange failed:', tokenResponse.status, errorBody);
      return Response.redirect(`${APP_URL}/integrations?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();
    // Fitbit response: { access_token, refresh_token, user_id, expires_in, scope, token_type }

    // Calculate token expiry from expires_in (seconds from now)
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Store tokens using service role (bypasses RLS for write access to token fields)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error: upsertError } = await supabase.from('user_integrations').upsert(
      {
        user_id: state,
        provider: 'fitbit',
        provider_user_id: tokens.user_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokenExpiresAt,
        connected_at: new Date().toISOString(),
        status: 'connected',
        error_message: null,
      },
      { onConflict: 'user_id,provider' },
    );

    if (upsertError) {
      console.error('Failed to store Fitbit tokens:', upsertError);
      return Response.redirect(`${APP_URL}/integrations?error=storage_failed`);
    }

    // Queue initial sync
    await supabase.from('sync_queue').insert({
      user_id: state,
      provider: 'fitbit',
      sync_type: 'initial',
      status: 'pending',
    });

    return Response.redirect(`${APP_URL}/integrations?connected=fitbit`);
  } catch (err) {
    console.error('Fitbit OAuth error:', err);
    return Response.redirect(`${APP_URL}/integrations?error=unexpected`);
  }
});
