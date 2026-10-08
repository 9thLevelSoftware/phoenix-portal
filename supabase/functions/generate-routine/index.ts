/**
 * generate-routine — the only server entry point for AI routine generation.
 * Issue #1223 implementation-spec packet BE-C.
 *
 * Contract (implementation-spec §BE-C; ordering is contractual per binding
 * amendment 2):
 *   1. auth.getUser() on the user client — 401 bad token vs 503 auth outage.
 *      A body `userId` is ignored.
 *   2. Kill switch AI_ROUTINE_GENERATION_ENABLED (default OFF) → 403.
 *   3. Parse/validate body → 400 invalid_request / program_generation_not_enabled.
 *   4. requireSubscription(..., "FLAME") → 402 subscription_required / 503.
 *   5. Build the catalog slice + model request. Empty compliant slice →
 *      422 generation_invalid BEFORE quota admission and before any provider
 *      call (binding amendment 1).
 *   6. Provider configuration present → else 503 model_unavailable, no admission.
 *   7. Quota admission immediately before provider initiation: burst
 *      (5/600s) then daily (20/86400s rolling window). Admission is a
 *      RESERVATION: timeout, provider failure, or cancellation after
 *      admission does not refund it; a repair call shares the same admission;
 *      burst may be consumed on a daily denial; fail-closed on limiter outage.
 *   8. Provider call with no further fallible preparation. One repair call.
 *   9. Validate (routineDraft.validateGeneratedDraft). Still unusable → 422.
 *  10. 200 { kind, remainingToday, disclaimer, draft }.
 *
 * Writes: `rate_limit_tracking` only (via the existing limiter). Logs:
 * SAFE_LOG_FIELDS only — never prompt text, load context, draft bodies, or
 * raw provider errors.
 *
 * `verify_jwt = false` in config.toml (same reason as mobile-sync-pull): the
 * handler calls auth.getUser(userJwt) so the phone can tell a bad token (401)
 * from an Auth outage (503).
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { AI_ROUTINE_GENERATION_ENABLED } from "../_shared/flags.ts";
import {
	AI_ROUTINE_BURST_KEY,
	AI_ROUTINE_BURST_LIMIT,
	AI_ROUTINE_BURST_WINDOW_SECONDS,
	AI_ROUTINE_DAILY_KEY,
	AI_ROUTINE_DAILY_LIMIT,
	AI_ROUTINE_DAILY_WINDOW_SECONDS,
	AI_ROUTINE_DISCLAIMER,
	buildModelRequest,
	buildRepairPrompt,
	type CatalogCandidateRow,
	mapPromptToHints,
	parseGenerateRoutineRequest,
	type PromptHints,
	SAFE_LOG_FIELDS,
	selectGenerationCatalogSlice,
	type SliceRow,
	validateGeneratedDraft,
} from "../_shared/routineDraft.ts";
import { generateRoutineDraft, type GenerateDraftResult, isModelConfigured } from "../_shared/routineModel.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { requireSubscription } from "../_shared/requireSubscription.ts";

/** Loose client type: `ReturnType<typeof createClient>` collapses to `never`. */
// deno-lint-ignore no-explicit-any
type DbClient = SupabaseClient<any, any, any>;

type EnvReader = (name: string) => string | undefined;

export interface GenerateRoutineDependencies {
	/** Environment lookup (Deno.env.get in production). */
	env: EnvReader;
	/** Service-role client factory. Created only after the user id is known. */
	createAdminClient: (url: string, serviceRoleKey: string) => DbClient;
	/** Anon client carrying the caller's Authorization header. */
	createUserClient: (url: string, anonKey: string, authHeader: string) => DbClient;
	/** Model adapter (injectable for tests — no network in unit tests). */
	generateDraft: (
		modelRequest: Parameters<typeof generateRoutineDraft>[0],
		opts: Parameters<typeof generateRoutineDraft>[1],
	) => Promise<GenerateDraftResult>;
	/** Candidate catalog rows for the slice (injectable for tests). */
	fetchCatalogCandidates: (supabaseAdmin: DbClient, callerId: string) => Promise<CatalogCandidateRow[]>;
	/** Kill switch value (defaults to the cold-start flags.ts read). */
	aiRoutineGenerationEnabled: boolean;
	now: () => number;
}

function defaultDependencies(): GenerateRoutineDependencies {
	return {
		env: (name) => Deno.env.get(name),
		createAdminClient: (url, key) => createClient(url, key),
		createUserClient: (url, anonKey, authHeader) =>
			createClient(url, anonKey, {
				global: { headers: { Authorization: authHeader } },
				auth: { persistSession: false },
			}),
		generateDraft: generateRoutineDraft,
		fetchCatalogCandidates: defaultFetchCatalogCandidates,
		aiRoutineGenerationEnabled: AI_ROUTINE_GENERATION_ENABLED,
		now: () => Date.now(),
	};
}

const CATALOG_COLUMNS =
	"id, name, aliases, muscle_group, muscle_groups, muscles, equipment, default_cable_config, source, popularity, archived, is_custom, user_id";

/**
 * Bounded candidate fetch: stock rows from the two phone-library sources only
 * (`free-exercise-db`, `phoenix-supplemental` — never `wger`), plus the
 * caller's own active custom rows. The pure slice function re-filters
 * everything (exclusions, sources, wger ids) regardless of what arrives here.
 */
async function defaultFetchCatalogCandidates(
	supabaseAdmin: DbClient,
	callerId: string,
): Promise<CatalogCandidateRow[]> {
	const { data: stockRows, error: stockError } = await supabaseAdmin
		.from("exercise_catalog")
		.select(CATALOG_COLUMNS)
		.eq("is_custom", false)
		.eq("archived", false)
		.in("source", ["free-exercise-db", "phoenix-supplemental"])
		.order("popularity", { ascending: false })
		.limit(200);
	if (stockError) {
		throw new Error(`catalog stock lookup failed: ${stockError.message}`);
	}

	const { data: customRows, error: customError } = await supabaseAdmin
		.from("exercise_catalog")
		.select(CATALOG_COLUMNS)
		.eq("is_custom", true)
		.eq("archived", false)
		.eq("user_id", callerId)
		.order("popularity", { ascending: false })
		.limit(50);
	if (customError) {
		throw new Error(`catalog custom lookup failed: ${customError.message}`);
	}

	return [...(stockRows ?? []), ...(customRows ?? [])];
}

export function createGenerateRoutineHandler(
	dependencies: GenerateRoutineDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
	return (req) => handle(req, dependencies);
}

if (import.meta.main) {
	Deno.serve(createGenerateRoutineHandler());
}

function json(
	cors: Record<string, string>,
	status: number,
	payload: unknown,
	extraHeaders: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { ...cors, "Content-Type": "application/json", ...extraHeaders },
	});
}

interface SafeLogRecord {
	status: number;
	latencyMs: number;
	admissionCharged: boolean;
	exerciseCount: number;
	validationFailureCode: string | null;
}

/**
 * Emit a log record restricted to SAFE_LOG_FIELDS. Prompt text, load context,
 * draft bodies and raw provider errors must never reach the logs.
 */
function safeLog(record: SafeLogRecord): void {
	const bounded: Record<string, unknown> = {};
	for (const field of SAFE_LOG_FIELDS) {
		bounded[field] = record[field as keyof SafeLogRecord];
	}
	console.log("[generate-routine]", bounded);
}

async function handle(
	req: Request,
	deps: GenerateRoutineDependencies,
): Promise<Response> {
	const { env } = deps;
	const cors = getCorsHeaders(req);
	const startedAt = deps.now();

	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: cors });
	}
	if (req.method !== "POST") {
		return json(cors, 405, { error: "invalid_request", message: "Method not allowed" });
	}

	let admissionCharged = false;
	let exerciseCount = 0;
	let validationFailureCode: string | null = null;
	const finish = (status: number): void => {
		safeLog({
			status,
			latencyMs: Math.max(deps.now() - startedAt, 0),
			admissionCharged,
			exerciseCount,
			validationFailureCode,
		});
	};
	const respond = (status: number, payload: unknown, headers?: Record<string, string>): Response => {
		finish(status);
		return json(cors, status, payload, headers);
	};

	// ── 1. Auth on the user client. Body userId is ignored. ─────────────────
	const authHeader = req.headers.get("Authorization");
	if (!authHeader) {
		return respond(401, { error: "invalid_request", message: "Missing Authorization header" });
	}

	const supabaseUser = deps.createUserClient(
		env("SUPABASE_URL") ?? "",
		env("SUPABASE_ANON_KEY") ?? "",
		authHeader,
	);

	let userId: string;
	try {
		const { data, error } = await supabaseUser.auth.getUser();
		const user = data?.user ?? null;
		if (error || !user) {
			// Definitive credential failure.
			return respond(401, { error: "invalid_request", message: "Not authenticated" });
		}
		userId = user.id;
	} catch {
		// Auth outage (network / Supabase Auth down): retryable, not a bad token.
		return respond(503, {
			error: "subscription_unavailable",
			message: "Subscription status is temporarily unavailable. Please retry shortly.",
		}, { "Retry-After": "30" });
	}

	// ── 2. Kill switch (default off). ───────────────────────────────────────
	if (!deps.aiRoutineGenerationEnabled) {
		return respond(403, {
			error: "feature_disabled",
			message: "AI workout generation is not available right now.",
		});
	}

	// ── 3. Parse/validate body. ────────────────────────────────────────────
	let rawBody: unknown;
	try {
		rawBody = await req.json();
	} catch {
		return respond(400, { error: "invalid_request", message: "Invalid JSON body" });
	}
	const parsed = parseGenerateRoutineRequest(rawBody);
	if (!parsed.ok) {
		return respond(400, { error: parsed.code, message: parsed.message });
	}
	const request = parsed.request;

	const supabaseAdmin = deps.createAdminClient(
		env("SUPABASE_URL") ?? "",
		env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
	);

	// ── 4. Entitlement: FLAME minimum. ─────────────────────────────────────
	const gate = await requireSubscription(supabaseAdmin, userId, "FLAME", cors);
	if (!gate.allowed) {
		return respond(gate.response.status, await gate.response.json(), Object.fromEntries(gate.response.headers));
	}

	// ── 5. Catalog slice + model request (before admission). ───────────────
	let sliceRows: SliceRow[];
	let hints: PromptHints;
	try {
		const candidates = await deps.fetchCatalogCandidates(supabaseAdmin, userId);
		hints = mapPromptToHints(request.prompt);
		const slice = selectGenerationCatalogSlice(candidates, hints, userId, request.prompt);
		if (!slice.ok) {
			// Empty compliant slice: fail BEFORE quota admission and before any
			// provider call (binding amendment 1).
			validationFailureCode = "slice_empty";
			return respond(422, {
				error: "generation_invalid",
				message: "Could not build a valid workout from the exercise catalog for this request.",
			});
		}
		sliceRows = slice.rows;
	} catch {
		return respond(503, {
			error: "model_unavailable",
			message: "Workout generation is temporarily unavailable. Please retry shortly.",
		}, { "Retry-After": "30" });
	}

	const modelRequest = buildModelRequest({ request, hints, sliceRows });
	const allowedIds = new Set(sliceRows.map((row) => row.id));

	// ── 6. Provider configuration check (no admission). ────────────────────
	if (!isModelConfigured(deps.env)) {
		return respond(503, {
			error: "model_unavailable",
			message: "Workout generation is temporarily unavailable. Please retry shortly.",
		}, { "Retry-After": "30" });
	}

	// ── 7. Quota admission — reservation semantics (amendment 2). ─────────
	// All parse/validate, auth/flag/entitlement, slice and model-request
	// preparation has completed; admission happens immediately before provider
	// initiation with no further fallible preparation between. No refunds:
	// timeout, provider failure, or client cancellation after admission does
	// NOT return the attempt. Burst may be consumed on a daily denial.
	const burst = await checkRateLimit(
		supabaseAdmin,
		{
			key: AI_ROUTINE_BURST_KEY,
			userId,
			maxRequests: AI_ROUTINE_BURST_LIMIT,
			windowSeconds: AI_ROUTINE_BURST_WINDOW_SECONDS,
		},
		cors,
	);
	if (!burst.allowed) {
		const payload = await burst.response!.json();
		return respond(burst.response!.status, payload, { "Retry-After": String(payload.retryAfterSeconds ?? 30) });
	}
	const daily = await checkRateLimit(
		supabaseAdmin,
		{
			key: AI_ROUTINE_DAILY_KEY,
			userId,
			maxRequests: AI_ROUTINE_DAILY_LIMIT,
			windowSeconds: AI_ROUTINE_DAILY_WINDOW_SECONDS,
		},
		cors,
	);
	admissionCharged = true; // Reservation taken (burst, and daily when allowed).
	if (!daily.allowed) {
		const payload = await daily.response!.json();
		return respond(daily.response!.status, payload, { "Retry-After": String(payload.retryAfterSeconds ?? 30) });
	}
	const remainingToday = daily.remaining;

	// ── 8. Provider initiation: no further fallible preparation. ───────────
	const draftOptions = { env: deps.env };
	const first: GenerateDraftResult = await deps.generateDraft(modelRequest, draftOptions);

	let draft: unknown | null = null;
	if (first.ok) {
		const validated = validateGeneratedDraft(first.draft, allowedIds);
		if (validated.ok) {
			draft = validated.draft;
			exerciseCount = validated.draft.exercises.length;
		} else {
			// ── 9. One repair call, sharing the same admission. ─────────────
			validationFailureCode = validated.code;
			const rejections = [
				...validated.issues,
				...validated.dropped.map((d) =>
					`dropped ${d.exerciseId ?? "unknown"}: ${d.reason}`
				),
			];
			const repair: GenerateDraftResult = await deps.generateDraft(modelRequest, {
				...draftOptions,
				repairPrompt: buildRepairPrompt(rejections),
			});
			if (repair.ok) {
				const revalidated = validateGeneratedDraft(repair.draft, allowedIds);
				if (revalidated.ok) {
					draft = revalidated.draft;
					exerciseCount = revalidated.draft.exercises.length;
					validationFailureCode = null;
				} else {
					validationFailureCode = revalidated.code;
				}
			}
		}
	}

	if (draft === null) {
		if (first.ok || validationFailureCode !== null) {
			// Usable draft never produced within the one allowed repair.
			validationFailureCode = validationFailureCode ?? "generation_invalid";
			return respond(422, {
				error: "generation_invalid",
				message: "Could not build a valid workout from the exercise catalog for this request.",
			});
		}
		// Provider failure after admission — the reservation is NOT refunded.
		return respond(503, {
			error: "model_unavailable",
			message: "Workout generation is temporarily unavailable. Please retry shortly.",
		}, { "Retry-After": "30" });
	}

	// ── 10. Success payload, exactly the architecture contract. ────────────
	const normalized = draft as {
		name: string;
		targetMinutes: number | null;
		avoidedMuscles: string[];
		unmetConstraints: string[];
		exercises: unknown[];
	};
	const unmetConstraints = [...normalized.unmetConstraints];
	// Server-side truth for exclusions (model-provided avoidedMuscles is not
	// proof): the recognized exclusions are what the slice actually enforced.
	const avoidedMuscles = hints.excludedMuscles.map((family) => family.toLowerCase());

	return respond(200, {
		kind: "routine",
		remainingToday,
		disclaimer: AI_ROUTINE_DISCLAIMER,
		draft: {
			name: normalized.name,
			targetMinutes: request.targetMinutes,
			avoidedMuscles,
			unmetConstraints,
			exercises: normalized.exercises,
		},
	});
}
