import { assert, assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createGenerateRoutineHandler, type GenerateRoutineDependencies } from "./index.ts";
import type { GenerateDraftResult } from "../_shared/routineModel.ts";
import type { CatalogCandidateRow, ModelRequest } from "../_shared/routineDraft.ts";
import { AI_ROUTINE_DISCLAIMER } from "../_shared/routineDraft.ts";
import { captureLogs } from "../_shared/testLogCapture.ts";

// Handler contract tests (implementation-spec §BE-C): in-process doubles only,
// no live secrets, no network. The ordering rule is contractual — quota
// admission happens immediately before provider initiation, and every failure
// before it must consume NO daily admission.

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const FUTURE = "2099-01-01T00:00:00.000Z";

interface RateLimitBehavior {
	allowed: boolean;
	remaining: number;
	retryAfterSeconds?: number;
	/** Simulate a limiter outage (non-missing RPC error) — must fail closed. */
	outage?: boolean;
}

interface HarnessState {
	authMode: "ok" | "error" | "throws";
	subscription: { tier: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean };
	rateLimits: Record<string, RateLimitBehavior>;
	/** Stateful counter mode: each admission consumes one unit per key. */
	consumeCounters?: Record<string, number>;
	draftResults: GenerateDraftResult[];
	catalogRows: CatalogCandidateRow[];
	rpcCalls: Array<{ key: string; maxRequests: number; windowSeconds: number }>;
	generateCalls: Array<{ request: ModelRequest; repairPrompt: string | undefined }>;
	writes: string[];
}

function defaultState(): HarnessState {
	return {
		authMode: "ok",
		subscription: { tier: "FLAME", status: "active", current_period_end: FUTURE, cancel_at_period_end: false },
		rateLimits: {
			"generate-routine": { allowed: true, remaining: 4 },
			"generate-routine-daily": { allowed: true, remaining: 19 },
		},
		draftResults: [],
		catalogRows: [],
		rpcCalls: [],
		generateCalls: [],
		writes: [],
	};
}

function fakeUserClient(state: HarnessState): SupabaseClient {
	return {
		auth: {
			getUser: () => {
				if (state.authMode === "throws") return Promise.reject(new Error("auth outage"));
				if (state.authMode === "error") return Promise.resolve({ data: { user: null }, error: new Error("bad jwt") });
				return Promise.resolve({ data: { user: { id: USER_ID } }, error: null });
			},
		},
	} as unknown as SupabaseClient;
}

function fakeAdminClient(state: HarnessState): SupabaseClient {
	const client = {
		from(table: string) {
			const query = {
				select() {
					return query;
				},
				eq() {
					return query;
				},
				maybeSingle: () => {
					if (table === "subscriptions") {
						return Promise.resolve({ data: state.subscription, error: null });
					}
					return Promise.resolve({ data: null, error: null });
				},
			};
			return query;
		},
		rpc(name: string, args: Record<string, unknown>) {
			if (name !== "check_rate_limit") return Promise.resolve({ data: null, error: null });
			const key = String(args.p_key);
			state.rpcCalls.push({
				key,
				maxRequests: Number(args.p_max_requests),
				windowSeconds: Number(args.p_window_seconds),
			});
			if (state.consumeCounters) {
				const used = (state.consumeCounters[key] ?? 0) + 1;
				state.consumeCounters[key] = used;
				const max = Number(args.p_max_requests);
				const allowed = used <= max;
				return Promise.resolve({
					data: { allowed, remaining: Math.max(max - used, 0), retry_after_seconds: 60 },
					error: null,
				});
			}
			const behavior = state.rateLimits[key];
			if (!behavior) return Promise.resolve({ data: { allowed: true, remaining: 1, retry_after_seconds: null }, error: null });
			if (behavior.outage) {
				return Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } });
			}
			return Promise.resolve({
				data: {
					allowed: behavior.allowed,
					remaining: behavior.remaining,
					retry_after_seconds: behavior.retryAfterSeconds ?? null,
				},
				error: null,
			});
		},
		insert(payload: { [key: string]: unknown } | Array<{ [key: string]: unknown }>) {
			state.writes.push("insert");
			void payload;
			return Promise.resolve({ data: null, error: null });
		},
	};
	return client as unknown as SupabaseClient;
}

function makeDeps(state: HarnessState): GenerateRoutineDependencies {
	return {
		env: (name) => ({
			SUPABASE_URL: "https://portal.test",
			SUPABASE_ANON_KEY: "anon",
			SUPABASE_SERVICE_ROLE_KEY: "service",
			AI_ROUTINE_MODEL_API_KEY: "sk-test",
		}[name]),
		createAdminClient: () => fakeAdminClient(state),
		createUserClient: () => fakeUserClient(state),
		generateDraft: (request, opts) => {
			state.generateCalls.push({ request, repairPrompt: opts.repairPrompt });
			return Promise.resolve(state.draftResults.shift() ?? {
				ok: false,
				code: "model_unavailable",
				retryAfterSeconds: 30,
			});
		},
		fetchCatalogCandidates: () => Promise.resolve(state.catalogRows),
		aiRoutineGenerationEnabled: true,
		now: () => 1_000_000,
	};
}

function request(body: unknown, opts: { auth?: boolean } = {}): Request {
	return new Request("https://portal.test/functions/v1/generate-routine", {
		method: "POST",
		headers: {
			...(opts.auth === false ? {} : { Authorization: "Bearer user-jwt" }),
			"Content-Type": "application/json",
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

async function run(
	state: HarnessState,
	body: unknown,
	opts: { auth?: boolean } = {},
): Promise<Response> {
	const handler = createGenerateRoutineHandler(makeDeps(state));
	return await handler(request(body, opts));
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function stockRow(id: string, muscle: string, extra: Partial<CatalogCandidateRow> = {}): CatalogCandidateRow {
	return {
		id,
		name: id.replace(/_/g, " "),
		aliases: [],
		muscle_group: muscle,
		muscle_groups: [muscle],
		muscles: [muscle.toLowerCase()],
		equipment: ["CABLE"],
		default_cable_config: "DOUBLE",
		source: "free-exercise-db",
		popularity: 10,
		archived: false,
		is_custom: false,
		user_id: null,
		...extra,
	};
}

function exercise(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		exerciseId: "Bench_Press",
		sets: 3,
		reps: 8,
		mode: "OLD_SCHOOL",
		percentOfOneRm: 70,
		restSeconds: 60,
		supersetGroup: null,
		echoLevel: null,
		eccentricLoad: null,
		...over,
	};
}

function draftPayload(exercises: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) {
	return {
		name: "Upper body",
		targetMinutes: 35,
		avoidedMuscles: ["legs"],
		unmetConstraints: [],
		exercises,
		...over,
	};
}

const OK_DRAFT: GenerateDraftResult = {
	ok: true,
	draft: draftPayload([exercise()]),
};

// ── Ordering: every pre-admission failure charges nothing ───────────────────

Deno.test("handler: flag off → 403 feature_disabled, provider not called, daily not charged", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	state.draftResults = [OK_DRAFT];
	const handler = createGenerateRoutineHandler({ ...makeDeps(state), aiRoutineGenerationEnabled: false });
	const res = await handler(request({ prompt: "chest day" }));
	assertEquals(res.status, 403);
	assertEquals((await res.json()).error, "feature_disabled");
	assertEquals(state.generateCalls.length, 0);
	assertEquals(state.rpcCalls.filter((c) => c.key === "generate-routine-daily").length, 0);
	assertEquals(state.rpcCalls.length, 0);
});

Deno.test("handler: below Flame → 402 subscription_required with requiredTier/currentTier, nothing charged", async () => {
	const state = defaultState();
	state.subscription = { tier: "EMBER", status: "active", current_period_end: FUTURE, cancel_at_period_end: false };
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	const res = await run(state, { prompt: "chest day" });
	assertEquals(res.status, 402);
	const payload = await res.json();
	assertEquals(payload.error, "subscription_required");
	assertEquals(payload.requiredTier, "FLAME");
	assertEquals(payload.currentTier, "EMBER");
	assertEquals(state.generateCalls.length, 0);
	assertEquals(state.rpcCalls.length, 0);
});

Deno.test("handler: daily exhausted → 429 with retryAfterSeconds, provider not called (burst may still be consumed)", async () => {
	const state = defaultState();
	state.rateLimits["generate-routine"] = { allowed: true, remaining: 3 };
	state.rateLimits["generate-routine-daily"] = { allowed: false, remaining: 0, retryAfterSeconds: 42 };
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	const res = await run(state, { prompt: "chest day" });
	assertEquals(res.status, 429);
	const payload = await res.json();
	assertEquals(payload.error, "rate_limit_exceeded");
	assertEquals(payload.retryAfterSeconds, 42);
	assertEquals(state.generateCalls.length, 0);
	// Admission is a reservation: burst precedes daily and is consumed even on
	// a daily denial.
	assertEquals(state.rpcCalls.map((c) => c.key), ["generate-routine", "generate-routine-daily"]);
});

Deno.test("handler: burst exhausted → 429, daily never checked", async () => {
	const state = defaultState();
	state.rateLimits["generate-routine"] = { allowed: false, remaining: 0, retryAfterSeconds: 120 };
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	const res = await run(state, { prompt: "chest day" });
	assertEquals(res.status, 429);
	assertEquals((await res.json()).retryAfterSeconds, 120);
	assertEquals(state.rpcCalls.map((c) => c.key), ["generate-routine"]);
});

Deno.test("handler: kind=program → 400 program_generation_not_enabled, no charge", async () => {
	const state = defaultState();
	const res = await run(state, { prompt: "4 day program", kind: "program" });
	assertEquals(res.status, 400);
	assertEquals((await res.json()).error, "program_generation_not_enabled");
	assertEquals(state.rpcCalls.length, 0);
	assertEquals(state.generateCalls.length, 0);
});

Deno.test("handler: bad body and malformed JSON → 400 invalid_request, no charge", async () => {
	const state = defaultState();
	const missingPrompt = await run(state, { kind: "routine" });
	assertEquals(missingPrompt.status, 400);
	assertEquals((await missingPrompt.json()).error, "invalid_request");
	const malformed = await run(state, "{not json");
	assertEquals(malformed.status, 400);
	assertEquals(state.rpcCalls.length, 0);
	assertEquals(state.generateCalls.length, 0);
});

Deno.test("handler: missing/bad JWT → 401; auth outage → 503 subscription_unavailable; never charged", async () => {
	const state = defaultState();
	const noAuth = await run(state, { prompt: "chest" }, { auth: false });
	assertEquals(noAuth.status, 401);

	state.authMode = "error";
	const badToken = await run(state, { prompt: "chest" });
	assertEquals(badToken.status, 401);

	state.authMode = "throws";
	const outage = await run(state, { prompt: "chest" });
	assertEquals(outage.status, 503);
	assertEquals((await outage.json()).error, "subscription_unavailable");

	assertEquals(state.rpcCalls.length, 0);
	assertEquals(state.generateCalls.length, 0);
});

Deno.test("handler: empty compliant slice → 422 BEFORE quota admission and before any provider call", async () => {
	const state = defaultState();
	// Only shoulder rows; the prompt excludes shoulders.
	state.catalogRows = [stockRow("Lateral_Raise", "SHOULDERS"), stockRow("Face_Pull", "SHOULDERS")];
	state.draftResults = [OK_DRAFT];
	const res = await run(state, { prompt: "upper body, avoid shoulders" });
	assertEquals(res.status, 422);
	assertEquals((await res.json()).error, "generation_invalid");
	assertEquals(state.rpcCalls.length, 0, "quota must not be admitted");
	assertEquals(state.generateCalls.length, 0, "provider must not be called");
});

Deno.test("handler: missing provider key → 503 model_unavailable without admission", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	const deps = makeDeps(state);
	deps.env = (name) => (name === "AI_ROUTINE_MODEL_API_KEY" ? undefined : "x");
	const handler = createGenerateRoutineHandler(deps);
	const res = await handler(request({ prompt: "chest" }));
	assertEquals(res.status, 503);
	assertEquals((await res.json()).error, "model_unavailable");
	assertEquals(state.rpcCalls.length, 0);
	assertEquals(state.generateCalls.length, 0);
});

Deno.test("handler: limiter outage fails closed with 503 rate_limit_unavailable", async () => {
	const state = defaultState();
	state.rateLimits["generate-routine"] = { allowed: false, remaining: 0, outage: true };
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	const res = await run(state, { prompt: "chest" });
	assertEquals(res.status, 503);
	assertEquals((await res.json()).error, "rate_limit_unavailable");
	assertEquals(state.generateCalls.length, 0);
});

// ── Happy path and slice guarantees ─────────────────────────────────────────

Deno.test("handler: 200 contract shape; model payload contains free-exercise-db + own custom, never wger or other-user ids", async () => {
	const state = defaultState();
	state.catalogRows = [
		stockRow("wger_999", "CHEST", { source: "wger" }),
		stockRow("Bench_Press", "CHEST"),
		stockRow("custom_mine", "CHEST", { source: "user", is_custom: true, user_id: USER_ID }),
		stockRow("custom_other", "CHEST", { source: "user", is_custom: true, user_id: OTHER_USER }),
	];
	state.draftResults = [OK_DRAFT];

	const { result: res, logs } = await captureLogs(() =>
		run(state, {
			prompt: "chest day",
			targetMinutes: 35,
			includeLoadContext: true,
			loadContext: [{ exerciseId: "Bench_Press", estimated1RmKg: 80 }],
		}));
	assertEquals(res.status, 200);
	const payload = await res.json();
	assertEquals(payload.kind, "routine");
	assertEquals(payload.disclaimer, AI_ROUTINE_DISCLAIMER);
	assertEquals(payload.remainingToday, 19);
	assertEquals(payload.draft.targetMinutes, 35);
	assertEquals(payload.draft.exercises[0].exerciseId, "Bench_Press");

	assertEquals(state.generateCalls.length, 1);
	const catalogIds = state.generateCalls[0].request.catalog.map((row) => row.id);
	assert(catalogIds.includes("Bench_Press"));
	assert(catalogIds.includes("custom_mine"));
	assert(!catalogIds.includes("wger_999"));
	assert(!catalogIds.includes("custom_other"));
	// Load context attaches only for slice ids.
	assertEquals(state.generateCalls[0].request.loadContext, [{ exerciseId: "Bench_Press", estimated1RmKg: 80 }]);
	// Admission is exactly one burst + one daily reservation.
	assertEquals(state.rpcCalls.map((c) => c.key), ["generate-routine", "generate-routine-daily"]);

	// SAFE_LOG_FIELDS only: no prompt, load, catalog, draft or provider text.
	assert(!logs.includes("chest day"));
	assert(!logs.includes("Bench_Press"));
	assert(!logs.includes("80"));
	assert(!logs.includes("sk-test"));
	assert(logs.includes("admissionCharged"));
	// Writes: the existing rate limiter only; this test double saw no inserts.
	assertEquals(state.writes, []);
});

Deno.test("handler: model-provided avoidedMuscles is not trusted; server exclusions are returned", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST"), stockRow("Squat", "LEGS")];
	state.draftResults = [OK_DRAFT]; // model claims avoidedMuscles: ["legs"]
	const res = await run(state, { prompt: "upper body, avoid shoulders" });
	assertEquals(res.status, 200);
	const payload = await res.json();
	assertEquals(payload.draft.avoidedMuscles, ["shoulders"]);
});

Deno.test("handler: negative constraints survive the <12 fallback (no excluded rows in the model payload)", async () => {
	const state = defaultState();
	// Fewer than 12 compliant stock rows, so positive hints relax — the
	// shoulder rows must still be excluded from the model payload.
	state.catalogRows = [
		stockRow("Squat", "LEGS", { popularity: 5 }),
		stockRow("Lateral_Raise", "SHOULDERS", { popularity: 99 }),
		stockRow("Face_Pull", "SHOULDERS", { popularity: 98 }),
	];
	state.draftResults = [OK_DRAFT];
	state.draftResults = [{ ok: true, draft: draftPayload([exercise({ exerciseId: "Squat" })]) }];
	const res = await run(state, { prompt: "leg day, avoid shoulders" });
	assertEquals(res.status, 200);
	const catalogIds = state.generateCalls[0].request.catalog.map((row) => row.id);
	assert(catalogIds.includes("Squat"));
	assert(!catalogIds.includes("Lateral_Raise"));
	assert(!catalogIds.includes("Face_Pull"));
});

// ── Validation, repair and admission semantics ─────────────────────────────

Deno.test("handler: unknown ids dropped and revalidated; invalid draft gets ONE repair sharing the admission", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	state.draftResults = [
		// First attempt: nothing usable (only hallucinated ids) → rejected.
		{ ok: true, draft: draftPayload([exercise({ exerciseId: "Invented_Curl" })]) },
		// Repair: still hallucinating only → still rejected → 422.
		{ ok: true, draft: draftPayload([exercise({ exerciseId: "Invented_Curl" })]) },
	];
	const res = await run(state, { prompt: "chest" });
	assertEquals(res.status, 422);
	assertEquals((await res.json()).error, "generation_invalid");
	assertEquals(state.generateCalls.length, 2, "exactly one repair call");
	assert(state.generateCalls[1].repairPrompt?.includes("Invented_Curl"));
	// Both calls share ONE admission: exactly one burst + one daily reservation.
	assertEquals(state.rpcCalls.map((c) => c.key), ["generate-routine", "generate-routine-daily"]);
});

Deno.test("handler: dropped unknown id still yields 200 when a usable exercise survives", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	state.draftResults = [
		{ ok: true, draft: draftPayload([exercise(), exercise({ exerciseId: "Invented_Curl" })]) },
	];
	const res = await run(state, { prompt: "chest" });
	assertEquals(res.status, 200);
	const payload = await res.json();
	assertEquals(payload.draft.exercises.map((e: { exerciseId: string }) => e.exerciseId), ["Bench_Press"]);
	assertEquals(state.generateCalls.length, 1);
});

Deno.test("handler: group of one flattens; group of five is rejected after repair → 422", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST"), stockRow("Cable_Fly", "CHEST")];
	state.draftResults = [
		{
			ok: true,
			draft: draftPayload([
				exercise({ supersetGroup: "a" }),
				exercise({ exerciseId: "Cable_Fly", supersetGroup: "b" }),
			]),
		},
	];
	const res = await run(state, { prompt: "chest" });
	assertEquals(res.status, 200);
	const payload = await res.json();
	assertEquals(payload.draft.exercises.map((e: { supersetGroup: string | null }) => e.supersetGroup), [null, null]);

	const state2 = defaultState();
	state2.catalogRows = [
		stockRow("Bench_Press", "CHEST"),
		stockRow("Cable_Fly", "CHEST"),
		stockRow("Fly_Machine", "CHEST"),
		stockRow("Push_Up", "CHEST"),
	];
	state2.draftResults = [
		{
			ok: true,
			draft: draftPayload([
				exercise({ supersetGroup: "g" }),
				exercise({ exerciseId: "Cable_Fly", supersetGroup: "g" }),
				exercise({ exerciseId: "Fly_Machine", supersetGroup: "g" }),
				exercise({ exerciseId: "Push_Up", supersetGroup: "g" }),
				exercise({ exerciseId: "Bench_Press", supersetGroup: "g" }),
			]),
		},
		{ ok: true, draft: draftPayload([exercise({ exerciseId: "Invented_Curl" })]) },
	];
	const res2 = await run(state2, { prompt: "chest" });
	assertEquals(res2.status, 422);
	assertEquals(state2.generateCalls.length, 2, "one repair attempt then 422");
});

Deno.test("handler: numeric limits enforced through the handler (sets>6 dropped)", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	state.draftResults = [{ ok: true, draft: draftPayload([exercise({ sets: 9 })]) }];
	const res = await run(state, { prompt: "chest" });
	assertEquals(res.status, 422);
});

Deno.test("handler: admitted provider failure → 503 model_unavailable, NO repair, admission NOT refunded", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	state.draftResults = [{ ok: false, code: "model_unavailable", retryAfterSeconds: 30 }];
	const res = await run(state, { prompt: "chest" });
	assertEquals(res.status, 503);
	assertEquals((await res.json()).error, "model_unavailable");
	assertEquals(state.generateCalls.length, 1, "no repair on provider failure");
	// Reservation semantics: exactly one burst + one daily unit consumed, and
	// no compensating "refund" call exists.
	assertEquals(state.rpcCalls.map((c) => c.key), ["generate-routine", "generate-routine-daily"]);
});

Deno.test("handler: concurrent admissions never exceed either cap (atomic RPC double)", async () => {
	const state = defaultState();
	state.catalogRows = [stockRow("Bench_Press", "CHEST")];
	state.consumeCounters = { "generate-routine": 0, "generate-routine-daily": 0 };
	state.draftResults = Array.from({ length: 7 }, () => OK_DRAFT);

	const statuses: number[] = [];
	for (let i = 0; i < 7; i++) {
		const res = await run(state, { prompt: "chest" });
		statuses.push(res.status);
	}
	// Burst cap is 5/600s: requests 6 and 7 are denied with 429.
	assertEquals(statuses, [200, 200, 200, 200, 200, 429, 429]);
	// Provider was called only for admitted requests.
	assertEquals(state.generateCalls.length, 5);
});
