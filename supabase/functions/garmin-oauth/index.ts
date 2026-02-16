import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const GARMIN_CONSUMER_KEY = Deno.env.get('GARMIN_CONSUMER_KEY')!;
const GARMIN_CONSUMER_SECRET = Deno.env.get('GARMIN_CONSUMER_SECRET')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173';

/**
 * Garmin Connect OAuth 1.0a callback handler.
 *
 * Garmin uses OAuth 1.0a (NOT OAuth 2.0), which is a multi-step flow:
 * 1. Get request token (handled by client-side initiation)
 * 2. User authorizes at Garmin (redirects back here with oauth_token + oauth_verifier)
 * 3. Exchange for access token (this function)
 *
 * OAuth 1.0a requires HMAC-SHA1 signature generation for requests.
 *
 * NOTE: Garmin developer program approval may be pending.
 * Edge Function is ready but untested until credentials are available.
 */

/**
 * Generate OAuth 1.0a signature base string and HMAC-SHA1 signature.
 * Per RFC 5849 Section 3.4.
 */
async function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string = '',
): Promise<string> {
  // Sort parameters alphabetically and encode
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  // Create signature base string
  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  // Signing key = consumer_secret&token_secret
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  // HMAC-SHA1
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signatureBase));
  return btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
}

/**
 * Generate a random nonce for OAuth requests.
 */
function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Build an OAuth 1.0a Authorization header.
 */
function buildAuthHeader(params: Record<string, string>): string {
  const headerParts = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');
  return `OAuth ${headerParts}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Check if this is the initiation step (get request token) or callback step
    const oauthToken = url.searchParams.get('oauth_token');
    const oauthVerifier = url.searchParams.get('oauth_verifier');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // =========================================================================
    // Step 1: Initiate - Get request token and redirect to Garmin for auth
    // Called from client-side when user clicks "Connect Garmin"
    // =========================================================================
    if (!oauthToken && !oauthVerifier) {
      const userId = url.searchParams.get('user_id');
      if (!userId) {
        return Response.redirect(`${APP_URL}/integrations?error=missing_user_id`);
      }

      const requestTokenUrl = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
      const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/garmin-oauth`;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = generateNonce();

      const oauthParams: Record<string, string> = {
        oauth_consumer_key: GARMIN_CONSUMER_KEY,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_version: '1.0',
        oauth_callback: callbackUrl,
      };

      const signature = await generateOAuthSignature(
        'POST',
        requestTokenUrl,
        oauthParams,
        GARMIN_CONSUMER_SECRET,
      );

      oauthParams.oauth_signature = signature;

      const requestTokenResponse = await fetch(requestTokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': buildAuthHeader(oauthParams),
        },
      });

      if (!requestTokenResponse.ok) {
        const errorBody = await requestTokenResponse.text();
        console.error('Garmin request token failed:', requestTokenResponse.status, errorBody);
        return Response.redirect(`${APP_URL}/integrations?error=garmin_request_token_failed`);
      }

      const responseText = await requestTokenResponse.text();
      const responseParams = new URLSearchParams(responseText);
      const requestToken = responseParams.get('oauth_token')!;
      const requestTokenSecret = responseParams.get('oauth_token_secret')!;

      // Temporarily store the request token secret and user_id for the callback
      // Using user_integrations with a 'pending' status
      await supabase.from('user_integrations').upsert(
        {
          user_id: userId,
          provider: 'garmin',
          access_token: requestToken, // Temporarily store request token
          refresh_token: requestTokenSecret, // Temporarily store request token secret
          status: 'disconnected', // Not yet connected
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

      // Redirect user to Garmin authorization page
      const authUrl = `https://connect.garmin.com/oauthConfirm?oauth_token=${requestToken}`;
      return Response.redirect(authUrl);
    }

    // =========================================================================
    // Step 3: Callback - Exchange request token for access token
    // Garmin redirects here after user authorizes
    // =========================================================================
    if (oauthToken && oauthVerifier) {
      // Look up the stored request token secret by matching the oauth_token
      const { data: pendingIntegration, error: lookupError } = await supabase
        .from('user_integrations')
        .select('user_id, refresh_token')
        .eq('provider', 'garmin')
        .eq('access_token', oauthToken) // We stored request token here
        .eq('status', 'disconnected')
        .single();

      if (lookupError || !pendingIntegration) {
        console.error('Garmin pending integration not found:', lookupError);
        return Response.redirect(`${APP_URL}/integrations?error=garmin_state_lost`);
      }

      const requestTokenSecret = pendingIntegration.refresh_token!;
      const userId = pendingIntegration.user_id;

      const accessTokenUrl = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = generateNonce();

      const oauthParams: Record<string, string> = {
        oauth_consumer_key: GARMIN_CONSUMER_KEY,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_token: oauthToken,
        oauth_verifier: oauthVerifier,
        oauth_version: '1.0',
      };

      const signature = await generateOAuthSignature(
        'POST',
        accessTokenUrl,
        oauthParams,
        GARMIN_CONSUMER_SECRET,
        requestTokenSecret,
      );

      oauthParams.oauth_signature = signature;

      const accessTokenResponse = await fetch(accessTokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': buildAuthHeader(oauthParams),
        },
      });

      if (!accessTokenResponse.ok) {
        const errorBody = await accessTokenResponse.text();
        console.error('Garmin access token exchange failed:', accessTokenResponse.status, errorBody);
        return Response.redirect(`${APP_URL}/integrations?error=garmin_token_exchange_failed`);
      }

      const responseText = await accessTokenResponse.text();
      const responseParams = new URLSearchParams(responseText);
      const accessToken = responseParams.get('oauth_token')!;
      const accessTokenSecret = responseParams.get('oauth_token_secret')!;

      // Store the permanent access token and secret
      // OAuth 1.0a tokens don't expire (no refresh_token concept)
      await supabase.from('user_integrations').upsert(
        {
          user_id: userId,
          provider: 'garmin',
          access_token: accessToken,
          refresh_token: accessTokenSecret, // OAuth 1.0a token secret
          token_expires_at: null, // OAuth 1.0a tokens don't expire
          connected_at: new Date().toISOString(),
          status: 'connected',
          error_message: null,
        },
        { onConflict: 'user_id,provider' },
      );

      // No initial sync queue for Garmin -- relies on webhook push notifications
      // for real-time activity updates. User can trigger manual sync if needed.

      return Response.redirect(`${APP_URL}/integrations?connected=garmin`);
    }

    return new Response(
      JSON.stringify({ error: 'Invalid OAuth callback parameters' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Garmin OAuth error:', err);
    return Response.redirect(`${APP_URL}/integrations?error=unexpected`);
  }
});
