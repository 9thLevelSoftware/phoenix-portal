import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const PUBLIC_SUPABASE_URL =
  Deno.env.get('SUPABASE_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL')!;

/**
 * Initiate OAuth Edge Function
 *
 * Authenticates user via JWT, generates a cryptographic state token,
 * stores it in oauth_states with 10-minute expiry, and returns
 * the provider-specific authorization URL.
 *
 * Request body:
 *   - provider: 'strava' | 'fitbit' | 'garmin'
 *
 * Returns:
 *   - { url: string } - The provider authorization URL to redirect to
 *
 * Environment variables:
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - STRAVA_CLIENT_ID
 *   - FITBIT_CLIENT_ID
 */

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Authenticate user via JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const provider = body.provider;
    if (!provider || typeof provider !== 'string' || !['strava', 'fitbit', 'garmin'].includes(provider)) {
      return new Response(JSON.stringify({ error: 'Invalid provider' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Clean up expired state tokens (prevents table bloat)
    await supabase.from('oauth_states').delete().lt('expires_at', new Date().toISOString());

    // Generate cryptographic state token
    const stateToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    // Validate required provider configuration before persisting state, so we never
    // hand back a malformed authorization URL (e.g. client_id=undefined) for a state
    // row that was already inserted.
    if (provider === 'strava' && !Deno.env.get('STRAVA_CLIENT_ID')) {
      console.error('Initiate OAuth: STRAVA_CLIENT_ID is not configured');
      return new Response(JSON.stringify({ error: 'Provider not configured' }), {
        status: 503, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    if (provider === 'fitbit' && !Deno.env.get('FITBIT_CLIENT_ID')) {
      console.error('Initiate OAuth: FITBIT_CLIENT_ID is not configured');
      return new Response(JSON.stringify({ error: 'Provider not configured' }), {
        status: 503, headers: { ...cors, 'Content-Type': 'application/json' },
      });
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
      console.error('Initiate OAuth: failed to persist state token:', stateInsertError);
      return new Response(JSON.stringify({ error: 'Failed to start OAuth flow' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Build provider-specific auth URL
    let authUrl: string;

    if (provider === 'strava') {
      const clientId = Deno.env.get('STRAVA_CLIENT_ID');
      const redirectUri = `${PUBLIC_SUPABASE_URL}/functions/v1/strava-oauth`;
      const params = new URLSearchParams({
        client_id: clientId!,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'activity:read_all',
        state: stateToken,
        approval_prompt: 'auto',
      });
      authUrl = `https://www.strava.com/oauth/authorize?${params}`;
    } else if (provider === 'fitbit') {
      const clientId = Deno.env.get('FITBIT_CLIENT_ID');
      const redirectUri = `${PUBLIC_SUPABASE_URL}/functions/v1/fitbit-oauth`;
      const params = new URLSearchParams({
        client_id: clientId!,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'activity',
        state: stateToken,
      });
      authUrl = `https://www.fitbit.com/oauth2/authorize?${params}`;
    } else {
      // Garmin: redirect to garmin-oauth Edge Function with state token
      authUrl = `${PUBLIC_SUPABASE_URL}/functions/v1/garmin-oauth?state=${stateToken}`;
    }

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Initiate OAuth error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
