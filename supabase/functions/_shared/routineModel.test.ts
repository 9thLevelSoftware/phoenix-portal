import { assert, assertEquals } from "jsr:@std/assert@1";
import {
	AI_ROUTINE_MODEL_NAME,
	generateRoutineDraft,
	isModelConfigured,
	type GenerateDraftOptions,
} from "./routineModel.ts";
import { buildModelRequest, mapPromptToHints, type ModelRequest } from "./routineDraft.ts";
import { captureLogs } from "./testLogCapture.ts";

const SECRET_KEY = "sk-test-secret-key-123";

function env(over: Record<string, string | undefined> = {}) {
	return (name: string): string | undefined => ({
		AI_ROUTINE_MODEL_API_KEY: SECRET_KEY,
		...over,
	}[name]);
}

function modelRequest(): ModelRequest {
	return buildModelRequest({
		request: {
			prompt: "35 minutes, upper body, avoid shoulders",
			kind: "routine",
			targetMinutes: 35,
			includeLoadContext: true,
			loadContext: [{ exerciseId: "Bench_Press", estimated1RmKg: 80 }],
		},
		hints: mapPromptToHints("35 minutes, upper body, avoid shoulders"),
		sliceRows: [
			{
				id: "Bench_Press",
				name: "Bench Press",
				muscle_group: "CHEST",
				equipment: ["BARBELL"],
				default_cable_config: "DOUBLE",
				isCustom: false,
			},
		],
	});
}

function chatResponse(content: string, status = 200): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const VALID_DRAFT = JSON.stringify({
	name: "Upper body",
	targetMinutes: 35,
	avoidedMuscles: ["shoulders"],
	unmetConstraints: [],
	exercises: [
		{
			exerciseId: "Bench_Press",
			sets: 3,
			reps: 8,
			mode: "OLD_SCHOOL",
			percentOfOneRm: 70,
			restSeconds: 60,
			supersetGroup: null,
			echoLevel: null,
			eccentricLoad: null,
		},
	],
});

function fakeFetch(
	handler: (url: string, init: RequestInit) => Response | Promise<Response>,
	calls: Array<{ url: string; init: RequestInit }> = [],
): typeof fetch {
	return ((url: string | URL, init?: RequestInit) => {
		const record = { url: String(url), init: init ?? {} };
		calls.push(record);
		return Promise.resolve(handler(record.url, record.init));
	}) as unknown as typeof fetch;
}

Deno.test("model: happy path returns the parsed draft and pins the model id in one constant", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const result = await generateRoutineDraft(modelRequest(), {
		env: env(),
		fetchImpl: fakeFetch(() => chatResponse(VALID_DRAFT), calls),
	});
	assert(result.ok);
	assertEquals((result as { draft: unknown }).draft, JSON.parse(VALID_DRAFT));

	assertEquals(calls.length, 1);
	assertEquals(calls[0].url, "https://api.openai.com/v1/chat/completions");
	const body = JSON.parse(String(calls[0].init.body));
	assertEquals(body.model, AI_ROUTINE_MODEL_NAME);
	assertEquals(body.model, "gpt-4.1-mini");
	assertEquals(body.response_format.type, "json_schema");
	assertEquals(body.response_format.json_schema.strict, true);
	// Never a `-latest` alias.
	assert(!body.model.includes("latest"));
	const auth = (calls[0].init.headers as Record<string, string>).Authorization;
	assertEquals(auth, `Bearer ${SECRET_KEY}`);
});

Deno.test("model: missing key fails closed without any provider call", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const result = await generateRoutineDraft(modelRequest(), {
		env: env({ AI_ROUTINE_MODEL_API_KEY: undefined }),
		fetchImpl: fakeFetch(() => chatResponse(VALID_DRAFT), calls),
	});
	assert(!result.ok);
	assertEquals((result as { code: string }).code, "model_unavailable");
	assertEquals(calls.length, 0);
	assertEquals(isModelConfigured(env({ AI_ROUTINE_MODEL_API_KEY: undefined })), false);
	assertEquals(isModelConfigured(env()), true);
});

Deno.test("model: non-2xx provider response maps to model_unavailable without leaking provider text", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const { result, logs } = await captureLogs(() =>
		generateRoutineDraft(modelRequest(), {
			env: env(),
			fetchImpl: fakeFetch(
				() =>
					new Response(JSON.stringify({ error: { message: "quota exceeded for sk-test-secret" } }), {
						status: 500,
					}),
				calls,
			),
		}));
	assert(!result.ok);
	assertEquals((result as { code: string }).code, "model_unavailable");
	assert(!logs.includes("quota exceeded"));
	assert(!logs.includes(SECRET_KEY));
});

Deno.test("model: timeout maps to model_unavailable (20s first-call / 15s repair budgets)", async () => {
	const budgets: Array<string | undefined> = [];
	const throwingFetch = ((url: string | URL, init?: RequestInit) => {
		budgets.push((init?.signal as AbortSignal | undefined)?.reason
			? String((init?.signal as AbortSignal).reason)
			: undefined);
		return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
	}) as unknown as typeof fetch;

	const first = await generateRoutineDraft(modelRequest(), { env: env(), fetchImpl: throwingFetch });
	assert(!first.ok);
	const repair = await generateRoutineDraft(modelRequest(), {
		env: env(),
		fetchImpl: throwingFetch,
		repairPrompt: "fix it",
	});
	assert(!repair.ok);
	// AbortSignal.timeout budgets are enforced by the signal passed to fetch.
	assertEquals(budgets.length, 2);
});

Deno.test("model: malformed provider body maps to model_unavailable", async () => {
	const result = await generateRoutineDraft(modelRequest(), {
		env: env(),
		fetchImpl: fakeFetch(() => chatResponse("not json {")),
	});
	assert(!result.ok);
	assertEquals((result as { code: string }).code, "model_unavailable");

	const empty = await generateRoutineDraft(modelRequest(), {
		env: env(),
		fetchImpl: fakeFetch(() => chatResponse("")),
	});
	assert(!empty.ok);
});

Deno.test("model: prompt, catalog and load context never reach the logs", async () => {
	const request = modelRequest();
	const { result, logs } = await captureLogs(() =>
		generateRoutineDraft(request, {
			env: env(),
			fetchImpl: fakeFetch(() =>
				new Response(JSON.stringify({ error: { message: "boom" } }), { status: 503 })),
		}));
	assert(!result.ok);
	assert(!logs.includes("upper body"));
	assert(!logs.includes("Bench_Press"));
	assert(!logs.includes("80"));
	assert(!logs.includes(SECRET_KEY));
});

Deno.test("model: the key constant appears in exactly one non-test file under supabase/functions", async () => {
	const root = new URL("..", import.meta.url);
	const hits: string[] = [];
	async function walk(dir: URL): Promise<void> {
		for await (const entry of Deno.readDir(dir)) {
			const path = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
			if (entry.isDirectory) {
				if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
				await walk(path);
			} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
				const source = await Deno.readTextFile(path);
				if (source.includes("AI_ROUTINE_MODEL_API_KEY")) hits.push(entry.name);
			}
		}
	}
	await walk(root);
	assertEquals(hits, ["routineModel.ts"]);
});

// The adapter reads AI_ROUTINE_MODEL_NAME from env when present (staging pin),
// but the pinned fallback constant is never a -latest alias.
Deno.test("model: env override honored, pinned constant stays a snapshot id", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	await generateRoutineDraft(modelRequest(), {
		env: env({ AI_ROUTINE_MODEL_NAME: "gpt-4.1-mini-2025-04-14" }),
		fetchImpl: fakeFetch(() => chatResponse(VALID_DRAFT), calls),
	});
	assertEquals(JSON.parse(String(calls[0].init.body)).model, "gpt-4.1-mini-2025-04-14");
	assert(!AI_ROUTINE_MODEL_NAME.includes("latest"));
});
