import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { errorMessage } from "../_shared/errorMessage.ts";
import { computeIncrementalWindow } from "../_shared/incrementalWindow.ts";
import {
	createLiftosaurPageFetcher,
	fetchLiftosaurHistory,
	LIFTOSAUR_MAX_PAGES,
	LiftosaurAuthError,
	type LiftosaurFetchResult,
	toLiftosaurActivityRow,
	withoutStartedAt,
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
		// date range instead of re-scanning the user's entire history every run,
		// plus any in-progress backfill (see below).
		const { data: integration } = await supabase
			.from("user_integrations")
			.select("last_sync_at, backfill_before, backfill_started_at")
			.eq("user_id", userId)
			.eq("provider", "liftosaur")
			.maybeSingle();

		const lastSyncAt = (integration?.last_sync_at as string | null) ?? null;
		const backfillBefore =
			(integration?.backfill_before as string | null) ?? null;
		const backfillStartedAt =
			(integration?.backfill_started_at as string | null) ?? null;
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

		// Resumable backfill. /history is newest-first and one run reads at most
		// LIFTOSAUR_MAX_PAGES pages, so a larger history is read DOWNWARD over
		// several runs: each run that stops early records `backfill_before`
		// (the `endDate` for the next run) and the chain's start time. The
		// watermark (`last_sync_at`, hence `startDate`) is left alone until the
		// chain reaches the end — moving it earlier would make the next window
		// start after its own `endDate`. Every run of a chain, whatever its
		// sync_type, continues the chain.
		const inBackfill = backfillBefore !== null && backfillStartedAt !== null;
		const chainStartedAt = inBackfill ? backfillStartedAt! : syncStartedAt;

		// Fetch workout history from Liftosaur API with pagination (shared with
		// mobile-integration-sync).
		let fetched: LiftosaurFetchResult;
		try {
			fetched = await fetchLiftosaurHistory(
				createLiftosaurPageFetcher(storedApiKey),
				{
					startDate: incrementalSince,
					endDate: inBackfill ? backfillBefore : null,
				},
			);
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

			// Log the detail server-side; the card and the caller get a fixed
			// message and a short code, never provider-supplied text.
			console.error(
				"Liftosaur API fetch error:",
				errorMessage(fetchError),
			);
			const fetchFailure = `Liftosaur sync failed (${LIFTOSAUR_FETCH_ERROR_CODE}). It will be retried.`;

			await supabase
				.from("user_integrations")
				.update({ status: "error", error_message: fetchFailure })
				.eq("user_id", userId)
				.eq("provider", "liftosaur");

			return new Response(
				JSON.stringify({ error: fetchFailure, code: LIFTOSAUR_FETCH_ERROR_CODE }),
				{
					status: 502,
					headers: { ...cors, "Content-Type": "application/json" },
				}
			);
		}
		const allRecords = fetched.records;

		// Normalize and upsert records to external_activities.
		//
		// A record whose Liftoscript text has no parseable date still needs a
		// started_at (the column is NOT NULL), so its first import stamps the
		// import time. It is written insert-only (ignoreDuplicates: ON CONFLICT
		// DO NOTHING), so a re-sync never moves its stored date; its other
		// columns are then re-applied without started_at so edits still land.
		const importedAt = new Date().toISOString();

		let importedCount = 0;
		let failedCount = 0;
		const undatedRows: Array<Record<string, unknown>> = [];
		for (const record of allRecords) {
			const { undated, row } = toLiftosaurActivityRow(
				userId,
				record,
				importedAt
			);
			if (undated) undatedRows.push(withoutStartedAt(row));

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
		if (failedCount === 0) {
			for (const row of undatedRows) {
				// Every undated row exists now, so this is ON CONFLICT DO UPDATE of
				// the columns sent — everything except started_at.
				const { error: refreshError } = await supabase
					.from("external_activities")
					.upsert(row, { onConflict: "user_id,provider,external_id" });
				if (refreshError) {
					failedCount++;
					console.error(`Failed to update Liftosaur record ${row.external_id}:`, refreshError);
				}
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

		if (fetched.truncated) {
			return await handleTruncatedFetch({
				supabase,
				userId,
				cors,
				fetched,
				importedCount,
				inBackfill,
				backfillBefore,
				chainStartedAt,
				incrementalSince,
				syncType: sync_type,
			});
		}

		// Everything in the window has been read and stored. Uses the chain's
		// pre-fetch timestamp so concurrent Liftosaur writes land in the next
		// window, and ends any backfill.
		await supabase
			.from("user_integrations")
			.update({
				last_sync_at: chainStartedAt,
				backfill_before: null,
				backfill_started_at: null,
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

/** Short code on fetch failures; the provider's own text is only logged. */
const LIFTOSAUR_FETCH_ERROR_CODE = "LIFTOSAUR_FETCH";

interface TruncationContext {
	supabase: DbClient;
	userId: string;
	cors: Record<string, string>;
	fetched: LiftosaurFetchResult;
	importedCount: number;
	inBackfill: boolean;
	backfillBefore: string | null;
	chainStartedAt: string;
	incrementalSince: string | null;
	syncType: string | undefined;
}

/**
 * Liftosaur still had records this run did not read. Never advance the
 * watermark past them; continue the import where it is safe to, and fail with
 * an explicit, non-retryable error where it is not.
 */
async function handleTruncatedFetch(ctx: TruncationContext): Promise<Response> {
	const { supabase, userId, cors, fetched, importedCount } = ctx;
	const json = { ...cors, "Content-Type": "application/json" };
	const why = fetched.reason === "missing_cursor"
		? "Liftosaur reported more history but no cursor to continue from"
		: `Liftosaur history is larger than one run can read (${LIFTOSAUR_MAX_PAGES} pages)`;
	const updateIntegration = (values: Record<string, unknown>) =>
		supabase
			.from("user_integrations")
			.update(values)
			.eq("user_id", userId)
			.eq("provider", "liftosaur");

	let cannotResume =
		"the records read were not in a clear date order (fewer than two distinct dates, or mixed order)";

	// Newest-first — the documented /history order. Everything newer than the
	// oldest record read is stored, so the next run continues below it with
	// `endDate`. +1s because `endDate` may be exclusive; re-reading the boundary
	// second is idempotent.
	if (fetched.order === "descending" && fetched.oldestDatedAt) {
		const nextBefore = new Date(
			Date.parse(fetched.oldestDatedAt) + 1000,
		).toISOString();
		const progresses =
			!ctx.inBackfill ||
			Date.parse(nextBefore) < Date.parse(ctx.backfillBefore!);

		if (progresses) {
			const progressMessage =
				`Importing Liftosaur history: ${why}. ${importedCount} records stored ` +
				"this run; older records are imported by the next run.";
			await updateIntegration({
				backfill_before: nextBefore,
				backfill_started_at: ctx.chainStartedAt,
				status: "connected",
				error_message: progressMessage,
			});
			console.warn(progressMessage);

			// Make sure a run follows. If the follow-up cannot be queued, ask the
			// queue to retry this task instead (502) — it continues the chain.
			const enqueueFailed = await ensureFollowUpTask(supabase, userId);
			return new Response(
				JSON.stringify({
					success: !enqueueFailed,
					...(enqueueFailed ? { error: progressMessage } : {}),
					partial: true,
					continuing: true,
					truncated: true,
					reason: fetched.reason,
					imported: importedCount,
					backfill_before: nextBefore,
				}),
				{ status: enqueueFailed ? 502 : 200, headers: json }
			);
		}
		cannotResume =
			"more records share one date than a single run can read";
	}

	// Oldest-first fallback (not the documented order): the newest record read
	// is a safe watermark. Retry (502) only when the retry reads further: the
	// new window must start later than this one, and an `initial` sync ignores
	// the watermark and would repeat the same request.
	if (!ctx.inBackfill && fetched.order === "ascending" && fetched.newestDatedAt) {
		const resumeAt = fetched.newestDatedAt;
		const resumeWindow = computeIncrementalWindow({ lastWatermark: resumeAt });
		const windowMoves =
			resumeWindow !== null &&
			(ctx.incrementalSince === null ||
				resumeWindow.after.getTime() > Date.parse(ctx.incrementalSince));
		if (windowMoves) {
			const retryReadsFurther = ctx.syncType !== "initial";
			const message =
				`${why}; ${importedCount} records stored, ` +
				(retryReadsFurther
					? `resuming from ${resumeAt}`
					: `the next incremental sync resumes from ${resumeAt}`);
			await updateIntegration({
				last_sync_at: resumeAt,
				status: "connected",
				error_message: message,
			});
			console.warn(message);
			return new Response(
				JSON.stringify({
					error: message,
					truncated: true,
					reason: fetched.reason,
					imported: importedCount,
					resume_at: resumeAt,
				}),
				// 502 is retryable per process-sync-queue; 500 is not.
				{ status: retryReadsFurther ? 502 : 500, headers: json }
			);
		}
		cannotResume = "more records share this window than a single run can read";
	}

	const message =
		`${why}; ${importedCount} records stored, but the import cannot resume: ` +
		`${cannotResume}.`;
	await updateIntegration({ status: "error", error_message: message });
	console.warn(message);
	return new Response(
		JSON.stringify({
			error: message,
			truncated: true,
			reason: fetched.reason,
			imported: importedCount,
			resume_at: null,
		}),
		{ status: 500, headers: json }
	);
}

/**
 * Ensure a pending Liftosaur sync_queue task exists for the user so the
 * backfill continues on the next queue pass. The task running now is
 * `processing` (or absent for a direct call), so it does not count; a pending
 * manual-sync row does. Returns true when the follow-up could not be queued.
 */
async function ensureFollowUpTask(
	supabase: DbClient,
	userId: string
): Promise<boolean> {
	const { data: pending, error: lookupError } = await supabase
		.from("sync_queue")
		.select("id")
		.eq("user_id", userId)
		.eq("provider", "liftosaur")
		.eq("status", "pending")
		.limit(1);
	if (lookupError) {
		console.error("Failed to look up pending Liftosaur tasks:", lookupError);
		return true;
	}
	if ((pending ?? []).length > 0) return false;

	const { error: insertError } = await supabase.from("sync_queue").insert({
		user_id: userId,
		provider: "liftosaur",
		sync_type: "incremental",
		status: "pending",
	});
	if (insertError) {
		console.error("Failed to queue the Liftosaur backfill follow-up:", insertError);
		return true;
	}
	return false;
}

export function createLiftosaurSyncHandler(
	deps: LiftosaurSyncHandlerDependencies = defaultLiftosaurSyncDependencies()
): (req: Request) => Promise<Response> {
	return (req) => liftosaurSyncHandler(req, deps);
}

if (import.meta.main) {
	Deno.serve(createLiftosaurSyncHandler());
}
