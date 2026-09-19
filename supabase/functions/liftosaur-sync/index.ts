import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { errorMessage } from "../_shared/errorMessage.ts";
import { computeIncrementalWindow } from "../_shared/incrementalWindow.ts";
import {
	createLiftosaurPageFetcher,
	fetchLiftosaurHistory,
	LIFTOSAUR_MAX_PAGES,
	LiftosaurAuthError,
	type LiftosaurRecord,
	toLiftosaurActivityRow,
} from "../_shared/liftosaurSync.ts";
import { decryptOAuthSecret, encryptOAuthSecret } from "../_shared/oauthTokenCrypto.ts";
import { requireSubscription } from "../_shared/requireSubscription.ts";

/**
 * Liftosaur Sync Edge Function
 *
 * Like Hevy, Liftosaur uses API key authentication (Bearer token).
 * - Receives { user_id, api_key? } in request body
 * - If api_key provided, stores it in oauth_tokens.api_key (server-only)
 * - Fetches workout history from Liftosaur REST API (requires Premium) via
 *   the shared fetcher in ../_shared/liftosaurSync.ts
 * - Parses Liftoscript workout text format for metadata
 * - Normalizes and upserts to external_activities
 *
 * API docs: https://www.liftosaur.com/doc/api
 */

// deno-lint-ignore no-explicit-any
type DbClient = SupabaseClient<any, any, any>;

export interface LiftosaurSyncAuthClient {
	auth: {
		getUser(): Promise<{ data: { user: { id: string } | null } }>;
	};
}

export interface LiftosaurSyncHandlerDependencies {
	createAuthClient(authorization: string): LiftosaurSyncAuthClient;
	createAdminClient(): DbClient;
}

function defaultLiftosaurSyncDependencies(): LiftosaurSyncHandlerDependencies {
	return {
		createAuthClient(authorization: string) {
			return createClient(
				Deno.env.get("SUPABASE_URL")!,
				Deno.env.get("SUPABASE_ANON_KEY")!,
				{ global: { headers: { Authorization: authorization } } }
			) as unknown as LiftosaurSyncAuthClient;
		},
		createAdminClient() {
			return createClient(
				Deno.env.get("SUPABASE_URL")!,
				Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
			);
		},
	};
}

async function liftosaurSyncHandler(
	req: Request,
	deps: LiftosaurSyncHandlerDependencies
): Promise<Response> {
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
			return new Response(
				JSON.stringify({ error: "Missing authorization" }),
				{
					status: 401,
					headers: { ...cors, "Content-Type": "application/json" },
				}
			);
		}

		let userId: string;

		// Try JWT auth first (browser-initiated calls)
		const supabaseAuth = deps.createAuthClient(authHeader);
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
				return new Response(
					JSON.stringify({ error: "Not authenticated" }),
					{
						status: 401,
						headers: { ...cors, "Content-Type": "application/json" },
					}
				);
			}
			userId = body.user_id;
		}

		const { api_key, sync_type } = body;

		const supabase = deps.createAdminClient();

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
					{ onConflict: "user_id,provider" }
				);

			if (tokenUpsertError) {
				console.error(
					"Failed to store Liftosaur API key:",
					tokenUpsertError
				);
				return new Response(
					JSON.stringify({ error: "Failed to store API key" }),
					{
						status: 500,
						headers: { ...cors, "Content-Type": "application/json" },
					}
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
				{ onConflict: "user_id,provider" }
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
					error: "No Liftosaur API key found. Enter your API key from Liftosaur Settings.",
					requires_premium: true,
				}),
				{
					status: 400,
					headers: { ...cors, "Content-Type": "application/json" },
				}
			);
		}

		// Read the prior watermark so incremental syncs can ask Liftosaur for a
		// date range instead of re-scanning the user's entire history every run.
		const { data: integration } = await supabase
			.from("user_integrations")
			.select("last_sync_at")
			.eq("user_id", userId)
			.eq("provider", "liftosaur")
			.maybeSingle();

		const lastSyncAt = (integration?.last_sync_at as string | null) ?? null;
		// `startDate` filters on workout date, but the watermark is wall-clock
		// sync time. Reach back a lookback (shared with Strava) so a workout that
		// was in progress during the last sync, or logged retroactively, is still
		// requested. Upserts are idempotent, so the overlap is free.
		const incrementalWindow =
			sync_type !== "initial"
				? computeIncrementalWindow({ lastWatermark: lastSyncAt })
				: null;
		const incrementalSince = incrementalWindow
			? incrementalWindow.after.toISOString()
			: null;

		// Capture the watermark before fetching so records Liftosaur writes while
		// this run is in flight fall inside the next window rather than being
		// skipped. Upserts are idempotent, so the overlap costs nothing.
		const syncStartedAt = new Date().toISOString();

		// Fetch workout history from Liftosaur API with pagination (shared with
		// mobile-integration-sync so both paths truncate and resume the same way).
		let allRecords: LiftosaurRecord[] = [];
		let truncated = false;
		let resumeAt: string | null = null;

		try {
			const result = await fetchLiftosaurHistory(
				createLiftosaurPageFetcher(storedApiKey),
				{ startDate: incrementalSince },
			);
			allRecords = result.records;
			truncated = result.truncated;
			resumeAt = result.resumeAt;
		} catch (fetchError) {
			if (fetchError instanceof LiftosaurAuthError) {
				await supabase
					.from("user_integrations")
					.update({
						status: "error",
						error_message:
							"API key invalid or Liftosaur Premium required",
					})
					.eq("user_id", userId)
					.eq("provider", "liftosaur");

				return new Response(
					JSON.stringify({
						error: "Liftosaur API access denied. Verify your API key and Premium subscription.",
						requires_premium: true,
					}),
					{
						status: 403,
						headers: {
							...cors,
							"Content-Type": "application/json",
						},
					}
				);
			}

			console.error("Liftosaur API fetch error:", fetchError);
			const fetchMessage = errorMessage(fetchError);

			await supabase
				.from("user_integrations")
				.update({
					status: "error",
					error_message: `Sync failed: ${fetchMessage}`,
				})
				.eq("user_id", userId)
				.eq("provider", "liftosaur");

			return new Response(
				JSON.stringify({
					error: `Liftosaur API error: ${fetchMessage}`,
				}),
				{
					status: 502,
					headers: { ...cors, "Content-Type": "application/json" },
				}
			);
		}

		// Normalize and upsert records to external_activities.
		//
		// A record whose Liftoscript text has no parseable date still needs a
		// started_at (the column is NOT NULL), so its first import stamps the
		// import time. It is then written with ignoreDuplicates (ON CONFLICT DO
		// NOTHING): a re-sync of an already stored undated record leaves the row,
		// and its stored date, untouched instead of moving it to "now" each run.
		const importedAt = new Date().toISOString();

		let importedCount = 0;
		let failedCount = 0;
		for (const record of allRecords) {
			const { undated, row } = toLiftosaurActivityRow(
				userId,
				record,
				importedAt
			);

			const { error: activityError } = await supabase
				.from("external_activities")
				.upsert(row, {
					onConflict: "user_id,provider,external_id",
					ignoreDuplicates: undated,
				});

			if (activityError) {
				failedCount++;
				console.error(`Failed to persist Liftosaur record ${record.id}:`, activityError);
			} else {
				importedCount++;
			}
		}

		// If any record failed to persist, do NOT advance last_sync_at (it is the
		// incremental cutoff and would skip the dropped rows). Returning non-2xx
		// lets the queue processor retry; upserts are idempotent.
		if (failedCount > 0) {
			const failMessage = `Failed to persist ${failedCount} of ${allRecords.length} records`;
			await supabase
				.from("user_integrations")
				.update({ status: "error", error_message: failMessage })
				.eq("user_id", userId)
				.eq("provider", "liftosaur");

			return new Response(
				JSON.stringify({ error: failMessage, imported: importedCount, failed: failedCount }),
				{ status: 502, headers: { ...cors, "Content-Type": "application/json" } }
			);
		}

		// Truncated: Liftosaur still had pages after LIFTOSAUR_MAX_PAGES. The
		// watermark must not jump to syncStartedAt — that would move startDate
		// past records never read. It may only move to the newest record read,
		// and only when the pages arrived oldest-first (resumeAt is null
		// otherwise), because everything before that record was then stored.
		//
		// Ask for a retry (502) only when the retry will read further: the new
		// window (resumeAt minus the lookback) must start later than this one,
		// and the retry must actually use it (an `initial` sync ignores the
		// watermark and re-reads full history). Otherwise fail with a
		// non-retryable 500 and say why, rather than burning the queue's retry
		// budget on identical requests.
		if (truncated) {
			const resumeWindow = resumeAt
				? computeIncrementalWindow({ lastWatermark: resumeAt })
				: null;
			const windowMoves =
				resumeWindow !== null &&
				(incrementalSince === null ||
					resumeWindow.after.getTime() > Date.parse(incrementalSince));
			const retryReadsFurther = windowMoves && sync_type !== "initial";

			let truncMessage: string;
			if (windowMoves) {
				truncMessage =
					`Liftosaur fetch hit the ${LIFTOSAUR_MAX_PAGES}-page budget; ` +
					`${importedCount} records stored, ` +
					(retryReadsFurther
						? `resuming from ${resumeAt}`
						: `the next incremental sync resumes from ${resumeAt}`);
				await supabase
					.from("user_integrations")
					.update({
						last_sync_at: resumeAt,
						status: "connected",
						error_message: truncMessage,
					})
					.eq("user_id", userId)
					.eq("provider", "liftosaur");
			} else {
				truncMessage =
					`Liftosaur history exceeded the ${LIFTOSAUR_MAX_PAGES}-page budget ` +
					`(${importedCount} records stored) and cannot resume: ` +
					(resumeAt
						? "more records share this window than one run can read."
						: "the records read were not in date order (or had no dates), so there is no safe resume point.");
				await supabase
					.from("user_integrations")
					.update({ status: "error", error_message: truncMessage })
					.eq("user_id", userId)
					.eq("provider", "liftosaur");
			}
			console.warn(truncMessage);

			return new Response(
				JSON.stringify({
					error: truncMessage,
					truncated: true,
					imported: importedCount,
					resume_at: windowMoves ? resumeAt : null,
				}),
				{
					// 502 is retryable per process-sync-queue; 500 is not.
					status: retryReadsFurther ? 502 : 500,
					headers: { ...cors, "Content-Type": "application/json" },
				}
			);
		}

		// Update last sync timestamp and status (all records persisted). Uses the
		// pre-fetch timestamp so concurrent Liftosaur writes land in the next window.
		await supabase
			.from("user_integrations")
			.update({
				last_sync_at: syncStartedAt,
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
			}
		);
	} catch (err) {
		console.error("Liftosaur sync error:", err);
		return new Response(JSON.stringify({ error: errorMessage(err) }), {
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}
}

export function createLiftosaurSyncHandler(
	deps: LiftosaurSyncHandlerDependencies = defaultLiftosaurSyncDependencies()
): (req: Request) => Promise<Response> {
	return (req) => liftosaurSyncHandler(req, deps);
}

if (import.meta.main) {
	Deno.serve(createLiftosaurSyncHandler());
}
