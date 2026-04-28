import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
	decryptOAuthSecret,
	encryptOAuthSecret,
} from "../_shared/oauthTokenCrypto.ts";
import { requireSubscription } from "../_shared/requireSubscription.ts";

/**
 * Hevy Sync Edge Function
 *
 * Unlike OAuth providers, Hevy uses API key authentication.
 * - Receives { user_id, api_key? } in request body
 * - If api_key provided, stores it in oauth_tokens.api_key (server-only)
 * - Fetches workouts from Hevy API (requires Hevy PRO subscription)
 * - Falls back gracefully if API returns 401/403
 * - Normalizes and upserts to external_activities
 *
 * Note: Hevy API documentation is limited. The CSV import path in
 * the portal UI is the primary import mechanism for most users.
 */

const HEVY_API_BASE = "https://api.hevyapp.com/v1";

interface HevyWorkout {
	id: string;
	title: string;
	start_time: string;
	end_time: string;
	exercises: Array<{
		title: string;
		sets: Array<{
			set_type: string;
			weight_kg: number;
			reps: number;
			rpe: number | null;
		}>;
	}>;
}

Deno.serve(async (req) => {
	const cors = getCorsHeaders(req);

	// CORS preflight
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: cors });
	}

	try {
		// Parse request body first (needed for both auth paths)
		const body = await req.json();

		// ---- Auth: Dual-path (browser JWT or service-role key) ----
		const authHeader = req.headers.get("Authorization");

		if (!authHeader) {
			return new Response(JSON.stringify({ error: "Missing authorization" }), {
				status: 401,
				headers: { ...cors, "Content-Type": "application/json" },
			});
		}

		let userId: string;

		// Try JWT auth first (browser-initiated calls)
		const supabaseAuth = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_ANON_KEY")!,
			{ global: { headers: { Authorization: authHeader } } },
		);
		const {
			data: { user: jwtUser },
		} = await supabaseAuth.auth.getUser();

		if (jwtUser) {
			// Browser-initiated: use JWT-verified user ID, ignore body.user_id
			userId = jwtUser.id;
		} else {
			// Not a valid user JWT -- must be service-role call from process-sync-queue
			// Verify the caller is actually using the service role key
			const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
			const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

			if (!isServiceRole || !body.user_id) {
				return new Response(JSON.stringify({ error: "Not authenticated" }), {
					status: 401,
					headers: { ...cors, "Content-Type": "application/json" },
				});
			}
			userId = body.user_id;
		}

		const { api_key, sync_type } = body;

		const supabase = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
		);

		// Subscription gate — FLAME or higher required for integrations
		const gate = await requireSubscription(supabase, userId, "FLAME", cors);
		if (!gate.allowed) return gate.response;

		// If api_key provided, store it in oauth_tokens (server-only table)
		if (api_key) {
			const { error: tokenUpsertError } = await supabase
				.from("oauth_tokens")
				.upsert(
					{
						user_id: userId,
						provider: "hevy",
						api_key: await encryptOAuthSecret(api_key),
						updated_at: new Date().toISOString(),
					},
					{ onConflict: "user_id,provider" },
				);

			if (tokenUpsertError) {
				console.error("Failed to store Hevy API key:", tokenUpsertError);
				return new Response(
					JSON.stringify({ error: "Failed to store API key" }),
					{
						status: 500,
						headers: { ...cors, "Content-Type": "application/json" },
					},
				);
			}

			// Update user_integrations with non-sensitive status only
			await supabase.from("user_integrations").upsert(
				{
					user_id: userId,
					provider: "hevy",
					status: "connected",
					connected_at: new Date().toISOString(),
				},
				{ onConflict: "user_id,provider" },
			);
		}

		// Retrieve the stored API key from oauth_tokens (server-only)
		const { data: tokenData } = await supabase
			.from("oauth_tokens")
			.select("api_key")
			.eq("user_id", userId)
			.eq("provider", "hevy")
			.single();

		const storedApiKey = (await decryptOAuthSecret(tokenData?.api_key)) ?? "";

		if (!storedApiKey) {
			return new Response(
				JSON.stringify({
					error: "No Hevy API key found. Use CSV import or provide an API key.",
					requires_pro: true,
				}),
				{
					status: 400,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// Attempt to fetch workouts from Hevy API
		let workouts: HevyWorkout[] = [];
		try {
			const response = await fetch(`${HEVY_API_BASE}/workouts`, {
				headers: {
					"api-key": storedApiKey,
					"Content-Type": "application/json",
				},
			});

			if (response.status === 401 || response.status === 403) {
				// API key invalid or Hevy PRO required
				await supabase
					.from("user_integrations")
					.update({
						status: "error",
						error_message: "API key invalid or Hevy PRO subscription required",
					})
					.eq("user_id", userId)
					.eq("provider", "hevy");

				return new Response(
					JSON.stringify({
						error:
							"Hevy API access denied. Verify your API key and Hevy PRO subscription.",
						requires_pro: true,
					}),
					{
						status: 403,
						headers: { ...cors, "Content-Type": "application/json" },
					},
				);
			}

			if (!response.ok) {
				throw new Error(`Hevy API returned ${response.status}`);
			}

			const data = await response.json();
			workouts = data.workouts ?? data ?? [];
		} catch (fetchError) {
			console.error("Hevy API fetch error:", fetchError);

			await supabase
				.from("user_integrations")
				.update({
					status: "error",
					error_message: `Sync failed: ${fetchError.message}`,
				})
				.eq("user_id", userId)
				.eq("provider", "hevy");

			return new Response(
				JSON.stringify({ error: `Hevy API error: ${fetchError.message}` }),
				{
					status: 502,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// Normalize and upsert workouts to external_activities
		let importedCount = 0;
		for (const workout of workouts) {
			const startTime = new Date(workout.start_time);
			const endTime = new Date(workout.end_time);
			const durationSeconds = Math.round(
				(endTime.getTime() - startTime.getTime()) / 1000,
			);

			const { error: activityError } = await supabase
				.from("external_activities")
				.upsert(
					{
						user_id: userId,
						external_id: `hevy-${workout.id}`,
						provider: "hevy",
						name: workout.title,
						activity_type: "strength",
						started_at: startTime.toISOString(),
						duration_seconds: durationSeconds > 0 ? durationSeconds : null,
						calories: null, // Hevy API does not provide calorie data
						raw_data: workout,
					},
					{ onConflict: "user_id,provider,external_id" },
				);

			if (!activityError) {
				importedCount++;
			}
		}

		// Update last sync timestamp and status
		await supabase
			.from("user_integrations")
			.update({
				last_sync_at: new Date().toISOString(),
				status: "connected",
				error_message: null,
			})
			.eq("user_id", userId)
			.eq("provider", "hevy");

		// Mark sync queue entry as completed
		if (sync_type) {
			await supabase
				.from("sync_queue")
				.update({
					status: "completed",
					completed_at: new Date().toISOString(),
				})
				.eq("user_id", userId)
				.eq("provider", "hevy")
				.eq("status", "pending");
		}

		return new Response(
			JSON.stringify({
				success: true,
				imported: importedCount,
				total: workouts.length,
			}),
			{
				headers: { ...cors, "Content-Type": "application/json" },
			},
		);
	} catch (err) {
		console.error("Hevy sync error:", err);
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}
});
