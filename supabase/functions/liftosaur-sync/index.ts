import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { errorMessage } from "../_shared/errorMessage.ts";
import { decryptOAuthSecret, encryptOAuthSecret } from "../_shared/oauthTokenCrypto.ts";
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
 * - Fetches workout history from Liftosaur REST API (requires Premium)
 * - Parses Liftoscript workout text format for metadata
 * - Normalizes and upserts to external_activities
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

const LIFTOSAUR_API_BASE = "https://www.liftosaur.com/api/v1";

/**
 * Renew the sync_queue lease after this many upserted records. Records are
 * upserted one by one, so a 2,000-record history can outlast
 * process-sync-queue's heartbeat lease without it.
 */
const HEARTBEAT_EVERY_RECORDS = 100;

/** Per-request ceiling for Liftosaur calls, so a hung request cannot outlast the lease. */
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export interface LiftosaurSyncDependencies {
	env: (key: string) => string | undefined;
	// deno-lint-ignore no-explicit-any
	createClient: (url: string, key: string, options?: any) => DbClient;
	/** Used for Liftosaur API calls. */
	fetch: typeof fetch;
	now: () => Date;
}

function defaultLiftosaurSyncDependencies(): LiftosaurSyncDependencies {
	return {
		env: (key) => Deno.env.get(key),
		createClient: (url, key, options) => createClient(url, key, options),
		fetch: (input, init) => fetch(input, init),
		now: () => new Date(),
	};
}

export function createLiftosaurSyncHandler(
	dependencies: LiftosaurSyncDependencies = defaultLiftosaurSyncDependencies(),
): (req: Request) => Promise<Response> {
	return (req) => liftosaurSync(req, dependencies);
}

if (import.meta.main) {
	Deno.serve(createLiftosaurSyncHandler());
}

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
		/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/
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
		const supabaseAuth = deps.createClient(
			deps.env("SUPABASE_URL")!,
			deps.env("SUPABASE_ANON_KEY")!,
			{ global: { headers: { Authorization: authHeader } } }
		);
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

		const supabase = deps.createClient(
			deps.env("SUPABASE_URL")!,
			deps.env("SUPABASE_SERVICE_ROLE_KEY")!
		);

		// Cap browser-initiated invocations per user. Keyed on the JWT-verified
		// id, so nobody can spend another user's budget; the queue path (service
		// role) is exempt and has its own budget under the `liftosaur` key.
		//
		// A call carrying `api_key` is both a credential write and a full sync. It
		// spends the roomier connect bucket first, then the ordinary sync bucket;
		// otherwise resending a valid key would bypass the provider-read limit.
		if (jwtUser) {
			if (api_key) {
				const credentialRateCheck = await checkManualSyncRateLimit(
					supabase,
					{ provider: "liftosaur", userId, credentialWrite: true },
					cors,
				);
				if (!credentialRateCheck.allowed) return credentialRateCheck.response!;
			}
			const syncRateCheck = await checkManualSyncRateLimit(
				supabase,
				{ provider: "liftosaur", userId },
				cors,
			);
			if (!syncRateCheck.allowed) return syncRateCheck.response!;
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
				syncType: typeof sync_type === "string" ? sync_type : "manual",
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
		// date range instead of re-scanning the user's entire history every run.
		const { data: integration } = await supabase
			.from("user_integrations")
			.select("last_sync_at")
			.eq("user_id", userId)
			.eq("provider", "liftosaur")
			.maybeSingle();

		const lastSyncAt = (integration?.last_sync_at as string | null) ?? null;
		const incrementalSince =
			sync_type !== "initial" && lastSyncAt ? lastSyncAt : null;

		// Capture the watermark before fetching so records Liftosaur writes while
		// this run is in flight fall inside the next window rather than being
		// skipped. Upserts are idempotent, so the overlap costs nothing.
		const syncStartedAt = deps.now().toISOString();

		// Fetch workout history from Liftosaur API with pagination
		let allRecords: LiftosaurRecord[] = [];
		let cursor: number | null = null;
		let hasMore = true;
		const MAX_PAGES = 10; // Safety limit
		let page = 0;

		try {
			while (hasMore && page < MAX_PAGES) {
				const params = new URLSearchParams({ limit: "200" });
				// GET /history supports startDate/endDate (ISO 8601) alongside the
				// cursor. Passing it turns a full-history rescan into a delta fetch.
				if (incrementalSince) {
					params.set("startDate", incrementalSince);
				}
				if (cursor !== null) {
					params.set("cursor", cursor.toString());
				}

				const response = await deps.fetch(
					`${LIFTOSAUR_API_BASE}/history?${params.toString()}`,
					{
						headers: {
							Authorization: `Bearer ${storedApiKey}`,
							"Content-Type": "application/json",
						},
						signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
					}
				);

				if (response.status === 401 || response.status === 403) {
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

				if (!response.ok) {
					throw new Error(`Liftosaur API returned ${response.status}`);
				}

				const result: LiftosaurHistoryResponse = await response.json();
				allRecords = allRecords.concat(result.data.records);
				hasMore = result.data.hasMore;
				cursor = result.data.nextCursor;
				page++;
				await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now());
			}
		} catch (fetchError) {
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

		// The page cap is a safety bound, not a successful end-of-history signal.
		// Persisting these first pages and advancing last_sync_at would make every
		// unread older record unreachable to later incremental syncs. Fail before
		// any activity write or watermark update. This bound is deterministic, so
		// return a terminal client error rather than retrying the same ten pages.
		if (hasMore) {
			const pageLimitMessage =
				`Liftosaur history still has more records after ${MAX_PAGES} pages`;
			console.error(pageLimitMessage);
			await supabase
				.from("user_integrations")
				.update({
					status: "error",
					error_message: "Liftosaur history exceeds the safe sync page limit",
				})
				.eq("user_id", userId)
				.eq("provider", "liftosaur");

			return new Response(
				JSON.stringify({
					error: "Liftosaur history sync is incomplete",
					code: "history_page_limit_exceeded",
				}),
				{
					status: 422,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// Normalize and upsert records to external_activities

		// Capture the sync invocation time once. Records whose Liftoscript text
		// contains no parseable ISO timestamp use this as a sentinel value instead
		// of per-record wall-clock time. Using a single shared value makes it
		// clear that these rows were imported at a known sync boundary, not that
		// the wall clock happened to match the workout time.
		const syncInvokedAt = deps.now().toISOString();

		let importedCount = 0;
		let failedCount = 0;
		let processedRecords = 0;
		for (const record of allRecords) {
			processedRecords++;
			if (processedRecords % HEARTBEAT_EVERY_RECORDS === 0) {
				await heartbeatSyncQueueEntry(supabase, ownedQueueId, userId, deps.now());
			}
			const meta = parseLiftoscriptMetadata(record.text);

			// Build a readable workout name
			const name = meta.dayName
				? meta.program
					? `${meta.program} — ${meta.dayName}`
					: meta.dayName
				: meta.program ?? `Workout #${record.id}`;

			// Use the parsed timestamp when available; fall back to the sync
			// invocation sentinel when the Liftoscript text has no parseable date.
			// The sentinel makes clear that started_at reflects import time, not
			// actual workout time.
			const startedAt = meta.timestamp
				? new Date(meta.timestamp).toISOString()
				: syncInvokedAt;

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
					{ onConflict: "user_id,provider,external_id" }
				);

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
		// `errorMessage` is a deliberate passthrough of `.message`, which for a
		// driver error carries constraint/column/relation names and for a parse
		// failure carries a slice of the provider's body. Log it, return a code.
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
