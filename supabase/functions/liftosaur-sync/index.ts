import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { decryptOAuthSecret, encryptOAuthSecret } from "../_shared/oauthTokenCrypto.ts";
import {
	completedSyncColumns,
	createLiftosaurPageFetcher,
	fetchLiftosaurHistory,
	LiftosaurAuthError,
	type LiftosaurFetchResult,
	type LiftosaurIntegrationState,
	planLiftosaurSync,
	resolveLiftosaurTruncation,
	toLiftosaurActivityRow,
	writeLiftosaurRows,
} from "../_shared/liftosaurSync.ts";
import { checkManualSyncRateLimit } from "../_shared/manualSyncRateLimit.ts";
import { requireSubscription } from "../_shared/requireSubscription.ts";
import {
	completeSyncQueueEntry,
	createSyncQueueEntry,
	type DbClient,
	heartbeatSyncQueueEntry,
	noOwnedQueueRow,
	type OwnedQueueRow,
	releaseOwnedQueueRow,
	syncAlreadyQueuedResponse,
	syncQueueUnavailableResponse,
} from "../_shared/syncQueue.ts";
import { isServiceRoleBearer } from "../_shared/timingSafe.ts";

/**
 * Liftosaur Sync Edge Function
 *
 * Like Hevy, Liftosaur uses API key authentication (Bearer token).
 * - Receives { user_id, api_key? } in request body
 * - If api_key provided, stores it in oauth_tokens.api_key (server-only)
 * - Fetches workout history from Liftosaur REST API (requires Premium) via
 *   the fetcher shared with mobile-integration-sync (_shared/liftosaurSync.ts)
 * - Parses Liftoscript workout text format for metadata
 * - Normalizes and upserts to external_activities
 * - A history larger than one run (10 pages) is imported over several runs:
 *   each run stores user_integrations.backfill_* and queues a follow-up,
 *   and last_sync_at moves only when the whole window has been read
 *
 * API docs: https://www.liftosaur.com/doc/api
 *
 * When dispatched by process-sync-queue the body also carries `queue_id`: the
 * run completes that row only, and renews its lease (heartbeat) while it runs.
 * process-sync-queue reclaims a liftosaur task after HEARTBEAT_LEASE_MS
 * (5 minutes) without a heartbeat. The longest silent window here is one
 * request (capped by PROVIDER_REQUEST_TIMEOUT_MS) or 100 record upserts.
 *
 * A browser-initiated run (user JWT, no `queue_id`) creates its OWN queue row
 * instead, directly in `processing`, and owns it exactly the same way. A
 * second concurrent sync loses the `sync_queue_one_active` race and is
 * answered with 409 `sync_already_queued`.
 */

/**
 * Renew the sync_queue lease after this many upserted records. A
 * 2,000-record history written chunk by chunk (with a row-by-row retry of a
 * refused chunk) can outlast process-sync-queue's heartbeat lease without it.
 */
const HEARTBEAT_EVERY_RECORDS = 100;

/** Per-request ceiling for Liftosaur calls, so a hung request cannot outlast the lease. */
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export interface LiftosaurSyncAuthClient {
	auth: {
		getUser(): Promise<{ data: { user: { id: string } | null } }>;
	};
}

/**
 * Fixtures reach this handler in two shapes: the client factories (PR 50's
 * tests) and `env` + `createClient` + `fetch` + `now` (PR 51's). Every field is
 * optional; `resolveDeps` fills in the rest so the body never branches.
 */
export interface LiftosaurSyncHandlerDependencies {
	createAuthClient?(authorization: string): LiftosaurSyncAuthClient;
	createAdminClient?(): DbClient;
	env?: (key: string) => string | undefined;
	// deno-lint-ignore no-explicit-any
	createClient?: (url: string, key: string, options?: any) => DbClient;
	/** Used for Liftosaur API calls; defaults to global fetch. */
	fetch?: typeof fetch;
	/** Wall clock; defaults to `new Date()`. */
	now?: () => Date;
}

/** The fully-resolved injection points the handler body runs against. */
export interface LiftosaurSyncDependencies {
	env: (key: string) => string | undefined;
	// deno-lint-ignore no-explicit-any
	createClient: (url: string, key: string, options?: any) => DbClient;
	/** Used for Liftosaur API calls. */
	fetch: typeof fetch;
	now: () => Date;
	createAuthClient(authorization: string): LiftosaurSyncAuthClient;
	createAdminClient(): DbClient;
}

// A server-side client keeps no session: without this supabase-js starts a
// token auto-refresh ticker per client that outlives the request.
const SERVER_AUTH = { persistSession: false, autoRefreshToken: false };

function resolveDeps(
	d: LiftosaurSyncHandlerDependencies,
): LiftosaurSyncDependencies {
	const env = d.env ?? ((key: string) => Deno.env.get(key));
	const make = d.createClient ??
		// deno-lint-ignore no-explicit-any
		((url: string, key: string, options?: any) => createClient(url, key, options));
	return {
		env,
		createClient: make,
		fetch: d.fetch ?? ((input, init) => fetch(input, init)),
		now: d.now ?? (() => new Date()),
		createAuthClient: d.createAuthClient ??
			((authorization: string) =>
				make(
					env("SUPABASE_URL")!,
					env("SUPABASE_ANON_KEY")!,
					{
						auth: SERVER_AUTH,
						global: { headers: { Authorization: authorization } },
					},
				) as unknown as LiftosaurSyncAuthClient),
		createAdminClient: d.createAdminClient ??
			(() =>
				make(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
					auth: SERVER_AUTH,
				})),
	};
}

export function createLiftosaurSyncHandler(
	dependencies: LiftosaurSyncHandlerDependencies = {},
): (req: Request) => Promise<Response> {
	const resolved = resolveDeps(dependencies);
	return (req) => liftosaurSync(req, resolved);
}

if (import.meta.main) {
	Deno.serve(createLiftosaurSyncHandler());
}

async function liftosaurSync(
	req: Request,
	deps: LiftosaurSyncDependencies,
): Promise<Response> {
	// A browser-initiated run owns the row it created: hand it back when the run
	// ends badly, so the user's next manual sync is not refused with a 409 until
	// the lease expires. Queue-dispatched rows deliberately stay `processing`
	// for process-sync-queue to re-run (PR 51).
	const owned: OwnedQueueRow = noOwnedQueueRow();
	const response = await runLiftosaurSync(req, deps, owned);
	if (!response.ok) await releaseOwnedQueueRow(owned);
	return response;
}

async function runLiftosaurSync(
	req: Request,
	deps: LiftosaurSyncDependencies,
	owned: OwnedQueueRow,
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
			// Not a valid user JWT -- must be service-role call from process-sync-queue.
			// Verify the caller is actually using the service role key, in constant
			// time so the comparison leaks neither the key's bytes nor its length.
			const isServiceRole = isServiceRoleBearer(
				authHeader,
				deps.env("SUPABASE_SERVICE_ROLE_KEY"),
			);

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
		const calledByQueueProcessor = !jwtUser;
		// The dispatched row (queue path only): a browser caller's `queue_id` is
		// ignored — it may name any row at all — and replaced by its own below.
		const dispatchedQueueId =
			calledByQueueProcessor && typeof body.queue_id === "string"
				? body.queue_id
				: null;
		// The row this run owns and leases.
		let ownedQueueId = dispatchedQueueId;

		const supabase = deps.createAdminClient();

		// Cap browser-initiated invocations per user. Keyed on the JWT-verified
		// id, so nobody can spend another user's budget; the queue path (service
		// role) is exempt and has its own budget under the `liftosaur` key.
		//
		// A call carrying `api_key` spends ONLY the credential bucket (NF-27).
		// Charging it to the 3-per-15-minute sync bucket too meant three mistyped
		// keys locked the user out of saving the corrected one. The credential
		// bucket (10 per 15 minutes) still bounds the provider reads that key
		// saves trigger, so resending a key cannot bypass the read limit.
		if (jwtUser) {
			const rateCheck = await checkManualSyncRateLimit(
				supabase,
				{ provider: "liftosaur", userId, credentialWrite: Boolean(api_key) },
				cors,
			);
			if (!rateCheck.allowed) return rateCheck.response!;
		}

		// Renew the lease immediately: the processor claimed this row before it
		// called us, so the work below must not run on that claim's clock.
		await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now());

		// Subscription gate — FLAME or higher required for integrations
		const gate = await requireSubscription(supabase, userId, "FLAME", cors);
		if (!gate.allowed) return gate.response;

		// Browser-initiated: take a queue row of our own so this run is visible
		// to the portal, holds a lease, and blocks a concurrent duplicate sync.
		if (!calledByQueueProcessor) {
			const created = await createSyncQueueEntry(supabase, {
				userId,
				provider: "liftosaur",
				// A key-bearing call is a (re)connect: its row, and so every
				// process-sync-queue retry of it, runs as a fresh initial read.
				syncType: api_key ? "initial" : typeof sync_type === "string" ? sync_type : "manual",
				now: deps.now(),
			});
			if (created.conflict) return syncAlreadyQueuedResponse(cors);
			if (!created.queueId) return syncQueueUnavailableResponse(cors);
			ownedQueueId = created.queueId;
			owned.supabase = supabase;
			owned.queueId = ownedQueueId;
			owned.userId = userId;
		}

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
		// plus any in-progress backfill (20260920005000; see planLiftosaurSync).
		const { data: integration } = await supabase
			.from("user_integrations")
			.select("last_sync_at, backfill_before, backfill_after, backfill_started_at")
			.eq("user_id", userId)
			.eq("provider", "liftosaur")
			.maybeSingle();

		// A call carrying `api_key` is a (re)connect, possibly to another
		// Liftosaur account: read the full history as a fresh chain, like
		// mobile-integration-sync's connect, instead of resuming a backfill
		// window or incremental watermark left by the previous key.
		const effectiveSyncType = api_key ? "initial" : sync_type;
		const plan = planLiftosaurSync(
			(integration ?? null) as LiftosaurIntegrationState | null,
			effectiveSyncType,
			deps.now(),
		);

		// Fetch workout history (shared with mobile-integration-sync). Every page
		// renews the lease and every request carries a timeout.
		let fetched: LiftosaurFetchResult;
		try {
			fetched = await fetchLiftosaurHistory(
				createLiftosaurPageFetcher(storedApiKey, deps.fetch, PROVIDER_REQUEST_TIMEOUT_MS),
				{
					startDate: plan.startDate,
					endDate: plan.endDate,
					onPage: () =>
						heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now()),
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

			// The thrown error is logged above and goes no further. The fetch+parse
			// is wrapped as a whole, so besides our own fixed "Liftosaur API
			// returned N" it can be a V8 JSON parse message quoting the provider's
			// body, or a transport/TLS internal.
			// `user_integrations.error_message` is rendered by ProviderCard and the
			// response body is copied into `sync_queue.error_message` by the
			// processor, so both get fixed text.
			console.error("Liftosaur API fetch error:", fetchError);

			await supabase
				.from("user_integrations")
				.update({
					status: "error",
					error_message: "Liftosaur sync failed; will retry",
				})
				.eq("user_id", userId)
				.eq("provider", "liftosaur");

			return new Response(
				JSON.stringify({
					error: "Liftosaur API error",
					code: "provider_fetch_failed",
				}),
				{
					status: 502,
					headers: { ...cors, "Content-Type": "application/json" },
				}
			);
		}

		const allRecords = fetched.records;

		// Normalize and persist. An undated record gets ONE per-run import time on
		// first insert and is never re-dated afterwards (writeLiftosaurRows).
		const importedAt = deps.now().toISOString();
		let lastHeartbeatAt = 0;
		const { written: importedCount, failed: failedCount } = await writeLiftosaurRows(
			supabase,
			userId,
			allRecords.map((record) => toLiftosaurActivityRow(userId, record, importedAt)),
			{},
			async (n) => {
				// n is a running count reported per chunk, so renew on crossing
				// each boundary rather than on an exact multiple.
				if (n - lastHeartbeatAt >= HEARTBEAT_EVERY_RECORDS) {
					lastHeartbeatAt = n;
					await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now());
				}
			},
		);

		// If any record failed to persist, do NOT advance last_sync_at (it is the
		// incremental cutoff and would skip the dropped rows). Returning non-2xx
		// lets the queue processor retry; the writes are idempotent.
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

		const updateIntegration = (values: Record<string, unknown>) =>
			supabase
				.from("user_integrations")
				.update(values)
				.eq("user_id", userId)
				.eq("provider", "liftosaur");

		// supabase-js resolves a failed write as `{ error }`; it does not throw.
		// A lost cursor or watermark must not be reported as progress: leave this
		// run's row `processing` (so the processor retries it), queue nothing, and
		// return the retryable 502. The rows already imported are idempotent.
		const saveFailed = async (code: string, error: unknown) => {
			console.error("Liftosaur sync state save failed:", error);
			await supabase
				.from("user_integrations")
				.update({
					status: "error",
					error_message: "Liftosaur sync failed; will retry",
				})
				.eq("user_id", userId)
				.eq("provider", "liftosaur");
			return new Response(
				JSON.stringify({ error: "Liftosaur sync failed; will retry", code }),
				{ status: 502, headers: { ...cors, "Content-Type": "application/json" } },
			);
		};

		// Liftosaur still has records this run did not read: never advance the
		// watermark past them. Continue the import where it is safe to, and fail
		// with an explicit, non-retryable error where it is not.
		if (fetched.truncated) {
			const outcome = resolveLiftosaurTruncation(fetched, plan, effectiveSyncType, importedCount);
			const { error: cursorError } = await updateIntegration(outcome.columns);
			if (cursorError) return await saveFailed("cursor_save_failed", cursorError);
			console.warn(outcome.message);
			const base = {
				truncated: true,
				reason: fetched.reason,
				imported: importedCount,
			};
			if (outcome.kind === "continue") {
				// This run is done; complete its row FIRST, because
				// sync_queue_one_active allows one active row per user/provider
				// and this one is still `processing`. Then make sure a run follows.
				const completed = await completeSyncQueueEntry(supabase, {
					userId,
					provider: "liftosaur",
					queueId: ownedQueueId,
				});
				// A row still `processing` would make the follow-up insert
				// conflict and read as "already queued". Retry instead: the row
				// stays processing, so the processor re-queues it, and the saved
				// cursor makes the retry continue where this run stopped.
				if (!completed) {
					return new Response(
						JSON.stringify({ ...base, error: "Failed to complete the sync queue entry", code: "queue_complete_failed" }),
						{ status: 502, headers: { ...cors, "Content-Type": "application/json" } },
					);
				}
				// The cursor is stored either way, so any later non-initial sync
				// continues the chain even if the follow-up could not be queued.
				// (A 502 here would not help: the processor only re-queues rows
				// that are still `processing`, and this one is completed.)
				const followUpQueued = await ensureFollowUpTask(supabase, userId);
				return new Response(
					JSON.stringify({
						...base,
						success: true,
						partial: true,
						continuing: true,
						follow_up_queued: followUpQueued,
						backfill_before: outcome.nextBefore,
					}),
					{ status: 200, headers: { ...cors, "Content-Type": "application/json" } },
				);
			}
			if (outcome.kind === "resume") {
				return new Response(
					JSON.stringify({ ...base, error: outcome.message, code: "history_truncated", resume_at: outcome.resumeAt }),
					// 502 is retryable per process-sync-queue; 500 is not.
					{ status: outcome.retryReadsFurther ? 502 : 500, headers: { ...cors, "Content-Type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({ ...base, error: outcome.message, code: "history_cannot_resume", resume_at: null }),
				{ status: 500, headers: { ...cors, "Content-Type": "application/json" } },
			);
		}

		// Everything in the window has been read and stored. Uses the chain's
		// pre-fetch timestamp so concurrent Liftosaur writes land in the next
		// window, and ends any backfill.
		const { error: watermarkError } = await updateIntegration(completedSyncColumns(plan));
		if (watermarkError) return await saveFailed("watermark_save_failed", watermarkError);

		// Complete only the row this run owns. Never sweep every pending row:
		// a second queued task (a kept `initial`) must still run.
		await completeSyncQueueEntry(supabase, {
			userId,
			provider: "liftosaur",
			queueId: ownedQueueId,
		});

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
		// A driver error's `.message` carries constraint/column/relation names and
		// a parse failure's carries a slice of the provider's body. Log it, return
		// a code.
		console.error("Liftosaur sync error:", err);
		return new Response(
			JSON.stringify({ error: "Liftosaur sync failed", code: "internal_error" }),
			{
				status: 500,
				headers: { ...cors, "Content-Type": "application/json" },
			}
		);
	}
}

/**
 * Make sure a pending, non-initial Liftosaur task exists so an in-progress
 * backfill continues on the next queue pass (a non-initial run resumes the
 * chain; an `initial` one would restart it). Returns true when one is queued,
 * including when `sync_queue_one_active` reports that one already is (23505).
 */
async function ensureFollowUpTask(supabase: DbClient, userId: string): Promise<boolean> {
	const { error } = await supabase.from("sync_queue").insert({
		user_id: userId,
		provider: "liftosaur",
		sync_type: "incremental",
		status: "pending",
	});
	if (!error) return true;
	if ((error as { code?: string }).code === "23505") return true;
	console.error("Failed to queue the Liftosaur backfill follow-up:", error);
	return false;
}
