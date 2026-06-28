import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { decryptOAuthSecret, encryptOAuthSecret } from '../_shared/oauthTokenCrypto.ts';
import { extractGarminProviderUserId } from '../_shared/garminIdentity.ts';

const GARMIN_CONSUMER_KEY = Deno.env.get('GARMIN_CONSUMER_KEY')!;
const GARMIN_CONSUMER_SECRET = Deno.env.get('GARMIN_CONSUMER_SECRET')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173';
const PUBLIC_SUPABASE_URL =
  Deno.env.get('SUPABASE_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL')!;

// How long a pending Garmin OAuth 1.0a request token stays valid before the
// callback stops considering it. Garmin request tokens are short-lived; the
// non-null expiry also distinguishes a pending request token from a permanent
// access token (stored with token_expires_at = null) during callback lookup.
const GARMIN_PENDING_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

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

      const requestTokenUrl = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
      const callbackUrl = `${PUBLIC_SUPABASE_URL}/functions/v1/garmin-oauth`;
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
      const requestToken = responseParams.get('oauth_token');
      const requestTokenSecret = responseParams.get('oauth_token_secret');

      // Validate the provider response shape before consuming state / storing tokens
      if (!requestToken || !requestTokenSecret) {
        console.error('Garmin request token response missing oauth_token/secret');
        return Response.redirect(`${APP_URL}/integrations?error=garmin_request_token_failed`);
      }

      // Store request token temporarily in oauth_tokens (server-only).
      // Encrypt the request token + secret with the same pattern as permanent
      // OAuth secrets so sensitive material is never persisted in plaintext.
      //
      // token_expires_at marks this row as a PENDING request token: it is set to
      // a short future time, whereas permanent OAuth 1.0a access tokens are
      // stored with token_expires_at = null ("don't expire"). The callback below
      // uses this to scan only in-flight pending rows instead of decrypting every
      // connected Garmin user's permanent token on each callback.
      const pendingTokenExpiresAt = new Date(
        Date.now() + GARMIN_PENDING_TOKEN_TTL_MS,
      ).toISOString();
      const { error: pendingTokenError } = await supabase.from('oauth_tokens').upsert(
        {
          user_id: userId,
          provider: 'garmin',
          access_token: await encryptOAuthSecret(requestToken), // Temporary request token
          refresh_token: await encryptOAuthSecret(requestTokenSecret), // Temporary request token secret
          token_expires_at: pendingTokenExpiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

      if (pendingTokenError) {
        console.error('Failed to store Garmin pending request token:', pendingTokenError);
        return Response.redirect(`${APP_URL}/integrations?error=storage_failed`);
      }

      // Update user_integrations with non-sensitive status
      const { error: pendingIntegrationError } = await supabase.from('user_integrations').upsert(
        {
          user_id: userId,
          provider: 'garmin',
          provider_user_id: null,
          status: 'disconnected', // Not yet connected
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

      if (pendingIntegrationError) {
        console.error('Failed to store Garmin pending integration state:', pendingIntegrationError);
        return Response.redirect(`${APP_URL}/integrations?error=storage_failed`);
      }

      // Consume the state token only after the request token has been persisted, so a
      // transient Garmin/API failure does not strand the user with an invalidated state.
      await supabase.from('oauth_states').delete().eq('state_token', stateParam);

      // Redirect user to Garmin authorization page
      const authUrl = `https://connect.garmin.com/oauthConfirm?oauth_token=${requestToken}`;
      return Response.redirect(authUrl);
    }

    // =========================================================================
    // Step 3: Callback - Exchange request token for access token
    // Garmin redirects here after user authorizes
    // =========================================================================
    if (oauthToken && oauthVerifier) {
      // Look up the stored pending request token. The request token + secret are
      // stored encrypted (see Step 1), so we cannot match on the ciphertext via a
      // column filter — decrypt each candidate row and compare to the returned
      // oauth_token. Candidates are restricted to PENDING request tokens: rows
      // with a non-null, not-yet-expired token_expires_at. Permanent access
      // tokens use token_expires_at = null, so this bounds the decrypt loop to
      // the handful of in-flight authorizations instead of every connected
      // Garmin user's permanent token (which would be an unbounded full-table
      // decrypt that can time out).
      const { data: pendingRows, error: lookupError } = await supabase
        .from('oauth_tokens')
        .select('user_id, access_token, refresh_token')
        .eq('provider', 'garmin')
        .not('token_expires_at', 'is', null)
        .gt('token_expires_at', new Date().toISOString());

      if (lookupError) {
        console.error('Garmin pending token lookup failed:', lookupError);
        return Response.redirect(`${APP_URL}/integrations?error=garmin_state_lost`);
      }

      let matchedUserId: string | null = null;
      let matchedSecret: string | null = null;
      for (const row of pendingRows ?? []) {
        let storedRequestToken: string | null | undefined;
        try {
          storedRequestToken = await decryptOAuthSecret(row.access_token);
        } catch (decryptErr) {
          console.error('Garmin pending token decrypt failed; skipping candidate:', decryptErr);
          continue;
        }
        if (storedRequestToken === oauthToken) {
          matchedUserId = row.user_id;
          try {
            matchedSecret = (await decryptOAuthSecret(row.refresh_token)) ?? null;
          } catch (decryptErr) {
            console.error('Garmin pending token secret decrypt failed:', decryptErr);
            return Response.redirect(`${APP_URL}/integrations?error=garmin_state_lost`);
          }
          break;
        }
      }

      if (!matchedUserId || !matchedSecret) {
        console.error('Garmin pending token not found for returned oauth_token');
        return Response.redirect(`${APP_URL}/integrations?error=garmin_state_lost`);
      }

      const requestTokenSecret = matchedSecret;
      const userId = matchedUserId;

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
      const accessToken = responseParams.get('oauth_token');
      const accessTokenSecret = responseParams.get('oauth_token_secret');
      const providerUserId = extractGarminProviderUserId(responseParams);

      // Validate the provider response shape before persisting
      if (!accessToken || !accessTokenSecret) {
        console.error('Garmin access token response missing oauth_token/secret');
        return Response.redirect(`${APP_URL}/integrations?error=garmin_token_exchange_failed`);
      }

      // Store the permanent access token in oauth_tokens (server-only)
      // OAuth 1.0a tokens don't expire (no refresh_token concept)
      const { error: tokenError } = await supabase.from('oauth_tokens').upsert(
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

      if (tokenError) {
        console.error('Failed to store Garmin access token:', tokenError);
        return Response.redirect(`${APP_URL}/integrations?error=storage_failed`);
      }

      // Update user_integrations with non-sensitive data only
      const { error: integrationError } = await supabase.from('user_integrations').upsert(
        {
          user_id: userId,
          provider: 'garmin',
          provider_user_id: providerUserId,
          connected_at: new Date().toISOString(),
          status: 'connected',
          error_message: null,
        },
        { onConflict: 'user_id,provider' },
      );

      if (integrationError) {
        console.error('Failed to update Garmin integration:', integrationError);
        return Response.redirect(`${APP_URL}/integrations?error=storage_failed`);
      }

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
