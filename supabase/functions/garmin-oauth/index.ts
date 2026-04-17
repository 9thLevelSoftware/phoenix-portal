import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';

const GARMIN_CONSUMER_KEY = Deno.env.get('GARMIN_CONSUMER_KEY')!;
const GARMIN_CONSUMER_SECRET = Deno.env.get('GARMIN_CONSUMER_SECRET')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173';

/**
 * Garmin Connect OAuth 1.0a callback handler.
 *
 * Garmin uses OAuth 1.0a (NOT OAuth 2.0), which is a multi-step flow:
 * 1. Validate CSRF state token, get request token (initiation step)
 * 2. User authorizes at Garmin (redirects back here with oauth_token + oauth_verifier)
 * 3. Exchange for access token (this function, callback step)
 *
 * OAuth 1.0a requires HMAC-SHA1 signature generation for requests.
 * Tokens are stored in oauth_tokens (server-only table).
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
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const url = new URL(req.url);

    // Check if this is the initiation step (has state param) or callback step (has oauth_token)
    const oauthToken = url.searchParams.get('oauth_token');
    const oauthVerifier = url.searchParams.get('oauth_verifier');
    const stateParam = url.searchParams.get('state');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // =========================================================================
    // Step 1: Initiate - Validate CSRF state, get request token, redirect
    // Called when initiate-oauth redirects here with a state token
    // =========================================================================
    if (!oauthToken && !oauthVerifier) {
      if (!stateParam) {
        return Response.redirect(`${APP_URL}/integrations?error=missing_state`);
      }

      // Clean up expired state tokens
      await supabase
        .from('oauth_states')
        .delete()
        .lt('expires_at', new Date().toISOString());

      // Validate CSRF state token
      const { data: stateRow, error: stateError } = await supabase
        .from('oauth_states')
        .select('user_id, provider, expires_at')
        .eq('state_token', stateParam)
        .single();

      if (stateError || !stateRow) {
        return Response.redirect(`${APP_URL}/integrations?error=invalid_state`);
      }

      if (new Date(stateRow.expires_at) < new Date()) {
        await supabase.from('oauth_states').delete().eq('state_token', stateParam);
        return Response.redirect(`${APP_URL}/integrations?error=state_expired`);
      }

      if (stateRow.provider !== 'garmin') {
        return Response.redirect(`${APP_URL}/integrations?error=provider_mismatch`);
      }

      const userId = stateRow.user_id;

      // Delete used state token (single-use)
      await supabase.from('oauth_states').delete().eq('state_token', stateParam);

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
        console.error('Garmin request token failed: status', requestTokenResponse.status);
        return Response.redirect(`${APP_URL}/integrations?error=garmin_request_token_failed`);
      }

      const responseText = await requestTokenResponse.text();
      const responseParams = new URLSearchParams(responseText);
      const requestToken = responseParams.get('oauth_token')!;
      const requestTokenSecret = responseParams.get('oauth_token_secret')!;

      // Store request token temporarily in oauth_tokens (server-only)
      await supabase.from('oauth_tokens').upsert(
        {
          user_id: userId,
          provider: 'garmin',
          access_token: requestToken, // Temporarily store request token
          refresh_token: requestTokenSecret, // Temporarily store request token secret
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

      // Update user_integrations with non-sensitive status
      await supabase.from('user_integrations').upsert(
        {
          user_id: userId,
          provider: 'garmin',
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
      // Look up the stored request token secret in oauth_tokens
      const { data: pendingToken, error: lookupError } = await supabase
        .from('oauth_tokens')
        .select('user_id, refresh_token')
        .eq('provider', 'garmin')
        .eq('access_token', oauthToken) // We stored request token here
        .single();

      if (lookupError || !pendingToken) {
        console.error('Garmin pending token not found:', lookupError);
        return Response.redirect(`${APP_URL}/integrations?error=garmin_state_lost`);
      }

      const requestTokenSecret = pendingToken.refresh_token!;
      const userId = pendingToken.user_id;

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
        console.error('Garmin access token exchange failed: status', accessTokenResponse.status);
        return Response.redirect(`${APP_URL}/integrations?error=garmin_token_exchange_failed`);
      }

      const responseText = await accessTokenResponse.text();
      const responseParams = new URLSearchParams(responseText);
      const accessToken = responseParams.get('oauth_token')!;
      const accessTokenSecret = responseParams.get('oauth_token_secret')!;

      // Store the permanent access token in oauth_tokens (server-only)
      // OAuth 1.0a tokens don't expire (no refresh_token concept)
      await supabase.from('oauth_tokens').upsert(
        {
          user_id: userId,
          provider: 'garmin',
          access_token: await encryptOAuthSecret(accessToken),
          refresh_token: await encryptOAuthSecret(accessTokenSecret), // OAuth 1.0a token secret
          token_expires_at: null, // OAuth 1.0a tokens don't expire
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

      // Update user_integrations with non-sensitive data only
      await supabase.from('user_integrations').upsert(
        {
          user_id: userId,
          provider: 'garmin',
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
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Garmin OAuth error:', err);
    return Response.redirect(`${APP_URL}/integrations?error=unexpected`);
  }
});
