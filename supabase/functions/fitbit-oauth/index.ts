import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { encryptOAuthSecret } from "../_shared/oauthTokenCrypto.ts";

const FITBIT_CLIENT_ID = Deno.env.get("FITBIT_CLIENT_ID")!;
const FITBIT_CLIENT_SECRET = Deno.env.get("FITBIT_CLIENT_SECRET")!;
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

/**
 * Fitbit OAuth 2.0 callback handler.
 *
 * Validates the CSRF state token against oauth_states, exchanges the
 * authorization code for tokens via Fitbit Basic auth, stores tokens
 * in oauth_tokens (server-only), and redirects to the app.
 *
 * Flow: User redirected from Fitbit -> this function -> validates state ->
 *       exchanges code -> stores tokens -> redirects to app.
 */
Deno.serve(async (req) => {
	const cors = getCorsHeaders(req);

	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: cors });
	}

	try {
		const url = new URL(req.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");

		if (!code || !state) {
			return Response.redirect(`${APP_URL}/integrations?error=missing_params`);
		}

		const supabase = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
		);

		// Clean up expired state tokens (prevents table bloat)
		await supabase
			.from("oauth_states")
			.delete()
			.lt("expires_at", new Date().toISOString());

		// Validate CSRF state token
		const { data: stateRow, error: stateError } = await supabase
			.from("oauth_states")
			.select("user_id, provider, expires_at")
			.eq("state_token", state)
			.single();

		if (stateError || !stateRow) {
			return Response.redirect(`${APP_URL}/integrations?error=invalid_state`);
		}

		if (new Date(stateRow.expires_at) < new Date()) {
			await supabase.from("oauth_states").delete().eq("state_token", state);
			return Response.redirect(`${APP_URL}/integrations?error=state_expired`);
		}

		if (stateRow.provider !== "fitbit") {
			return Response.redirect(
				`${APP_URL}/integrations?error=provider_mismatch`,
			);
		}

		const userId = stateRow.user_id;

		// Delete used state token (single-use)
		await supabase.from("oauth_states").delete().eq("state_token", state);

		// Fitbit requires Basic auth: base64(client_id:client_secret)
		const basicAuth = btoa(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`);
		const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/fitbit-oauth`;

		// Exchange authorization code for tokens
		const tokenResponse = await fetch("https://api.fitbit.com/oauth2/token", {
			method: "POST",
			headers: {
				Authorization: `Basic ${basicAuth}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
			}),
		});

		if (!tokenResponse.ok) {
			console.error(
				"Fitbit token exchange failed: status",
				tokenResponse.status,
			);
			return Response.redirect(
				`${APP_URL}/integrations?error=token_exchange_failed`,
			);
		}

		const tokens = await tokenResponse.json();
		// Fitbit response: { access_token, refresh_token, user_id, expires_in, scope, token_type }

		// Calculate token expiry from expires_in (seconds from now)
		const tokenExpiresAt = new Date(
			Date.now() + tokens.expires_in * 1000,
		).toISOString();

		// Store tokens in oauth_tokens (server-only table)
		const { error: tokenError } = await supabase.from("oauth_tokens").upsert(
			{
				user_id: userId,
				provider: "fitbit",
				access_token: await encryptOAuthSecret(tokens.access_token),
				refresh_token: await encryptOAuthSecret(tokens.refresh_token),
				token_expires_at: tokenExpiresAt,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "user_id,provider" },
		);

		if (tokenError) {
			console.error("Failed to store Fitbit tokens:", tokenError);
			return Response.redirect(`${APP_URL}/integrations?error=storage_failed`);
		}

		// Update user_integrations with non-sensitive fields only
		const { error: upsertError } = await supabase
			.from("user_integrations")
			.upsert(
				{
					user_id: userId,
					provider: "fitbit",
					provider_user_id: tokens.user_id,
					connected_at: new Date().toISOString(),
					status: "connected",
					error_message: null,
				},
				{ onConflict: "user_id,provider" },
			);

		if (upsertError) {
			console.error("Failed to update Fitbit integration:", upsertError);
			return Response.redirect(`${APP_URL}/integrations?error=storage_failed`);
		}

		// Queue initial sync
		await supabase.from("sync_queue").insert({
			user_id: userId,
			provider: "fitbit",
			sync_type: "initial",
			status: "pending",
		});

		return Response.redirect(`${APP_URL}/integrations?connected=fitbit`);
	} catch (err) {
		console.error("Fitbit OAuth error:", err);
		return Response.redirect(`${APP_URL}/integrations?error=unexpected`);
	}
});
