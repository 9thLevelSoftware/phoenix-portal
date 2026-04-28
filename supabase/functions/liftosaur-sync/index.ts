import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
	decryptOAuthSecret,
	encryptOAuthSecret,
} from "../_shared/oauthTokenCrypto.ts";
import { requireSubscription } from "../_shared/requireSubscription.ts";

/**
 * Liftosaur Sync Edge Function
 *
 * Like Hevy, Liftosaur uses API key authentication (Bearer token).
 * - Receives { user_id, api_key? } in request body
 * - If api_key provided, stores it in oauth_tokens.api_key (server-only)
 * - Fetches workout history from Liftosaur REST API (requires Premium)
 * - Parses Liftoscript workout text format for metadata
 * - Normalizes and upserts to external_activities
 *
 * API docs: https://www.liftosaur.com/doc/api
 */

const LIFTOSAUR_API_BASE = "https://www.liftosaur.com/api/v1";

interface LiftosaurRecord {
	id: number;
	text: string;
}

interface LiftosaurHistoryResponse {
	data: {
		records: LiftosaurRecord[];
		hasMore: boolean;
		nextCursor: number | null;
	};
}

/**
 * Parses Liftoscript workout text to extract metadata.
 *
 * Format example:
 * 2026-03-01T10:00:00Z / program: "5/3/1" / dayName: "Squat Day" / week: 1 / dayInWeek: 1 / duration: 3600s / exercises: { ... }
 */
function parseLiftoscriptMetadata(text: string): {
	timestamp: string | null;
	program: string | null;
	dayName: string | null;
	durationSeconds: number | null;
} {
	// Extract timestamp (ISO 8601 at the start)
	const tsMatch = text.match(
		/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/,
	);
	const timestamp = tsMatch?.[1] ?? null;

	// Extract program name
	const programMatch = text.match(/program:\s*"([^"]+)"/);
	const program = programMatch?.[1] ?? null;

	// Extract day name
	const dayNameMatch = text.match(/dayName:\s*"([^"]+)"/);
	const dayName = dayNameMatch?.[1] ?? null;

	// Extract duration in seconds
	const durationMatch = text.match(/duration:\s*(\d+)s/);
	const durationSeconds = durationMatch ? parseInt(durationMatch[1], 10) : null;

	return { timestamp, program, dayName, durationSeconds };
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
						provider: "liftosaur",
						api_key: await encryptOAuthSecret(api_key),
						updated_at: new Date().toISOString(),
					},
					{ onConflict: "user_id,provider" },
				);

			if (tokenUpsertError) {
				console.error("Failed to store Liftosaur API key:", tokenUpsertError);
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
					provider: "liftosaur",
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
			.eq("provider", "liftosaur")
			.single();

		const storedApiKey = (await decryptOAuthSecret(tokenData?.api_key)) ?? "";

		if (!storedApiKey) {
			return new Response(
				JSON.stringify({
					error:
						"No Liftosaur API key found. Enter your API key from Liftosaur Settings.",
					requires_premium: true,
				}),
				{
					status: 400,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// Fetch workout history from Liftosaur API with pagination
		let allRecords: LiftosaurRecord[] = [];
		let cursor: number | null = null;
		let hasMore = true;
		const MAX_PAGES = 10; // Safety limit
		let page = 0;

		try {
			while (hasMore && page < MAX_PAGES) {
				const params = new URLSearchParams({ limit: "200" });
				if (cursor !== null) {
					params.set("cursor", cursor.toString());
				}

				const response = await fetch(
					`${LIFTOSAUR_API_BASE}/history?${params.toString()}`,
					{
						headers: {
							Authorization: `Bearer ${storedApiKey}`,
							"Content-Type": "application/json",
						},
					},
				);

				if (response.status === 401 || response.status === 403) {
					await supabase
						.from("user_integrations")
						.update({
							status: "error",
							error_message: "API key invalid or Liftosaur Premium required",
						})
						.eq("user_id", userId)
						.eq("provider", "liftosaur");

					return new Response(
						JSON.stringify({
							error:
								"Liftosaur API access denied. Verify your API key and Premium subscription.",
							requires_premium: true,
						}),
						{
							status: 403,
							headers: {
								...cors,
								"Content-Type": "application/json",
							},
						},
					);
				}

				if (!response.ok) {
					throw new Error(`Liftosaur API returned ${response.status}`);
				}

				const result: LiftosaurHistoryResponse = await response.json();
				allRecords = allRecords.concat(result.data.records);
				hasMore = result.data.hasMore;
				cursor = result.data.nextCursor;
				page++;
			}
		} catch (fetchError) {
			console.error("Liftosaur API fetch error:", fetchError);

			await supabase
				.from("user_integrations")
				.update({
					status: "error",
					error_message: `Sync failed: ${fetchError.message}`,
				})
				.eq("user_id", userId)
				.eq("provider", "liftosaur");

			return new Response(
				JSON.stringify({
					error: `Liftosaur API error: ${fetchError.message}`,
				}),
				{
					status: 502,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// Normalize and upsert records to external_activities
		let importedCount = 0;
		for (const record of allRecords) {
			const meta = parseLiftoscriptMetadata(record.text);

			// Build a readable workout name
			const name = meta.dayName
				? meta.program
					? `${meta.program} — ${meta.dayName}`
					: meta.dayName
				: (meta.program ?? `Workout #${record.id}`);

			const startedAt = meta.timestamp
				? new Date(meta.timestamp).toISOString()
				: new Date().toISOString();

			const { error: activityError } = await supabase
				.from("external_activities")
				.upsert(
					{
						user_id: userId,
						external_id: `liftosaur-${record.id}`,
						provider: "liftosaur",
						name,
						activity_type: "strength",
						started_at: startedAt,
						duration_seconds: meta.durationSeconds ?? null,
						calories: null,
						raw_data: { id: record.id, text: record.text },
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
			.eq("provider", "liftosaur");

		// Mark sync queue entry as completed
		if (sync_type) {
			await supabase
				.from("sync_queue")
				.update({
					status: "completed",
					completed_at: new Date().toISOString(),
				})
				.eq("user_id", userId)
				.eq("provider", "liftosaur")
				.eq("status", "pending");
		}

		return new Response(
			JSON.stringify({
				success: true,
				imported: importedCount,
				total: allRecords.length,
			}),
			{
				headers: { ...cors, "Content-Type": "application/json" },
			},
		);
	} catch (err) {
		console.error("Liftosaur sync error:", err);
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}
});
