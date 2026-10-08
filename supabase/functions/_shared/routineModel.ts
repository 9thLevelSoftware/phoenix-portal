/**
 * AI routine generation — the ONE adapter that talks to the external model
 * provider. Issue #1223 implementation-spec packet BE-B (binding amendment 3).
 *
 * Server-only configuration: `AI_ROUTINE_MODEL_API_KEY` and
 * `AI_ROUTINE_MODEL_NAME` are read ONLY in this file (via the injected env
 * reader — `Deno.env.get` in production, fakes in tests). The key never
 * appears in `VITE_` config, the mobile binary, responses, or logs. There is
 * no vendor SDK here and no logging of prompt/response bodies.
 *
 * Provider pin (implementation-spec §1.1):
 *   - OpenAI public API, `/v1/chat/completions` with `response_format:
 *     json_schema` (schema-constrained output).
 *   - Model: the exact snapshot id below in one named constant. Never a
 *     `-latest` alias. `store` semantics: chat/completions keeps no
 *     application state; do not migrate to `/v1/responses` without
 *     `store: false`. No fine-tuning, no files, no stateful endpoints.
 *   - Time budget: 20s first call, 15s repair call, enforced here.
 *
 * Provider posture (§1.2, launch gate): API inputs/outputs are not used for
 * training; abuse-monitoring logs may retain content up to 30 days unless the
 * org has ZDR/Modified Abuse Monitoring approved. That posture is disclosed
 * and evidenced OUTSIDE this code; nothing here may claim "no storage
 * anywhere".
 */

import type { ModelRequest } from "./routineDraft.ts";

/** The pinned model snapshot id (single server constant). */
export const AI_ROUTINE_MODEL_NAME = "gpt-4.1-mini";

const PROVIDER_URL = "https://api.openai.com/v1/chat/completions";
const FIRST_CALL_TIMEOUT_MS = 20_000;
const REPAIR_TIMEOUT_MS = 15_000;

/** Environment lookup (Deno.env.get in production; fakes in tests). */
export type EnvReader = (name: string) => string | undefined;

export interface GenerateDraftOptions {
	env: EnvReader;
	/** Injectable transport; defaults to global fetch. No network in unit tests. */
	fetchImpl?: typeof fetch;
	/** When set, this is the one allowed repair call (15s budget). */
	repairPrompt?: string;
}

export type GenerateDraftResult =
	| { ok: true; draft: unknown }
	| { ok: false; code: "model_unavailable"; retryAfterSeconds: number };

interface ChatCompletionResponse {
	choices?: Array<{ message?: { content?: string | null } }>;
}

function draftJsonSchema(): Record<string, unknown> {
	const nullableString = { type: ["string", "null"] as const };
	return {
		name: "generated_routine_draft",
		strict: true,
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["name", "targetMinutes", "avoidedMuscles", "unmetConstraints", "exercises"],
			properties: {
				name: { type: "string" },
				targetMinutes: { type: ["integer", "null"] as const },
				avoidedMuscles: { type: "array", items: { type: "string" } },
				unmetConstraints: { type: "array", items: { type: "string" } },
				exercises: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: [
							"exerciseId",
							"sets",
							"reps",
							"mode",
							"percentOfOneRm",
							"restSeconds",
							"supersetGroup",
							"echoLevel",
							"eccentricLoad",
						],
						properties: {
							exerciseId: { type: "string" },
							sets: { type: "integer" },
							reps: { type: "integer" },
							mode: { type: "string" },
							percentOfOneRm: { type: "integer" },
							restSeconds: { type: "integer" },
							supersetGroup: nullableString,
							echoLevel: nullableString,
							eccentricLoad: nullableString,
						},
					},
				},
			},
		},
	};
}

function systemText(modelRequest: ModelRequest): string {
	return [
		"You design ONE strength workout draft for a fitness app.",
		"Return JSON only, matching the provided schema exactly.",
		`Use ONLY exerciseId values from the catalog list in the user message. Never invent ids and never substitute a different movement for a missing one.`,
		`Between ${modelRequest.limits.minExercises} and ${modelRequest.limits.maxExercises} exercises.`,
		`Each exercise: sets ${modelRequest.limits.minSets}-${modelRequest.limits.maxSets}, reps ${modelRequest.limits.minReps}-${modelRequest.limits.maxReps} (no timed-only exercises), restSeconds ${modelRequest.limits.minRestSeconds}-${modelRequest.limits.maxRestSeconds}, percentOfOneRm ${modelRequest.limits.minPercentOfOneRm}-${modelRequest.limits.maxPercentOfOneRm}.`,
		"mode must be one of OLD_SCHOOL, PUMP, TUT, TUT_BEAST, ECCENTRIC_ONLY, ECHO.",
		"echoLevel/eccentricLoad are set only when mode is ECHO (HARD/HARDER/HARDEST/EPIC and LOAD_0..LOAD_150), otherwise null.",
		`supersetGroup: null for standalone exercises; a short group label shared by 2-${modelRequest.limits.maxSupersetGroupSize} exercises that are performed back to back.`,
		"Honor every excluded muscle group: do not choose exercises classified in those groups.",
		"When estimated 1RM values are provided, use them only to choose exercises and rep ranges — never output weights.",
		"unmetConstraints lists any request constraint you could not satisfy; avoidedMuscles repeats the excluded groups you honored.",
		"Write no medical, rehab or pain advice and no coaching notes.",
	].join("\n");
}

function unavailable(retryAfterSeconds = 30): GenerateDraftResult {
	return { ok: false, code: "model_unavailable", retryAfterSeconds };
}

/**
 * Provider configuration check for the handler's pre-admission step. The key
 * name stays inside this file (BE-B acceptance: the key constant appears in
 * exactly one file) — handlers ask THIS function instead of reading the env
 * var themselves.
 */
export function isModelConfigured(env: EnvReader): boolean {
	return Boolean(env("AI_ROUTINE_MODEL_API_KEY"));
}

/**
 * Ask the pinned provider for one schema-constrained workout draft. Maps every
 * provider failure (timeout, non-2xx, malformed body) to `model_unavailable`
 * without leaking provider error text. Never logs prompt, catalog, load
 * context, draft bodies, or raw provider errors (SAFE_LOG_FIELDS governs
 * handler-side logging).
 */
export async function generateRoutineDraft(
	modelRequest: ModelRequest,
	opts: GenerateDraftOptions,
): Promise<GenerateDraftResult> {
	const { env, repairPrompt } = opts;
	const fetchImpl = opts.fetchImpl ?? fetch;

	const apiKey = env("AI_ROUTINE_MODEL_API_KEY");
	if (!apiKey) {
		// Configuration failure: the handler treats this as model_unavailable
		// and fails closed BEFORE quota admission.
		return unavailable();
	}
	const modelName = env("AI_ROUTINE_MODEL_NAME") ?? AI_ROUTINE_MODEL_NAME;

	const messages: Array<{ role: "system" | "user"; content: string }> = [
		{ role: "system", content: systemText(modelRequest) },
		{ role: "user", content: JSON.stringify(modelRequest) },
	];
	if (repairPrompt) {
		messages.push({ role: "user", content: repairPrompt });
	}

	const timeoutMs = repairPrompt ? REPAIR_TIMEOUT_MS : FIRST_CALL_TIMEOUT_MS;

	try {
		const response = await fetchImpl(PROVIDER_URL, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: modelName,
				messages,
				response_format: {
					type: "json_schema",
					json_schema: draftJsonSchema(),
				},
				temperature: 0.7,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!response.ok) {
			return unavailable();
		}

		const payload: ChatCompletionResponse = await response.json();
		const content = payload?.choices?.[0]?.message?.content;
		if (typeof content !== "string" || content.length === 0) {
			return unavailable();
		}

		let draft: unknown;
		try {
			draft = JSON.parse(content);
		} catch {
			return unavailable();
		}
		if (typeof draft !== "object" || draft === null || Array.isArray(draft)) {
			return unavailable();
		}
		return { ok: true, draft };
	} catch {
		// Timeout (AbortSignal), network failure, or malformed JSON body —
		// all mapped to the same non-leaking failure.
		return unavailable();
	}
}
