/**
 * AI routine generation — pure request parsing, hint mapping, catalog slicing,
 * and draft validation. Issue #1223 implementation-spec packets BE-A.
 *
 * Purity contract: this module performs NO Deno.env reads, no network calls,
 * and no writes. Everything here is deterministic given its arguments, so the
 * handler (generate-routine/index.ts) can unit-test the risky semantics —
 * exclusion-preserving fallback, quota ordering, id revalidation — with no
 * live secrets and no model call.
 *
 * Binding amendments this module implements (implementation-spec §11):
 *   1. Exclusions survive fallback. Recognized negative constraints are never
 *      relaxed — across stock rows, name/alias additions and caller-owned
 *      custom rows. Custom rows with insufficient muscle metadata are dropped
 *      under a recognized exclusion. Output ids are revalidated against the
 *      final allowed slice. An empty compliant slice fails before quota
 *      admission and before any provider call.
 *   2. Quota constants live here as named values (5/600s burst,
 *      20/86400s daily — "daily" is a rolling 86400-second window).
 */

import {
	DEFAULT_WIRE_MODE,
	ECCENTRIC_LOADS,
	ECHO_LEVELS,
	type EccentricLoad,
	type EchoLevel,
	toWireMode,
	type WireMode,
} from "./workoutModes.ts";

// ── Quota constants (binding amendment 2) ────────────────────────────────────

/** Burst admission: generations per rolling window. */
export const AI_ROUTINE_BURST_LIMIT = 5;
export const AI_ROUTINE_BURST_WINDOW_SECONDS = 600;
/** Daily admission: generations per rolling 86400s window (not midnight). */
export const AI_ROUTINE_DAILY_LIMIT = 20;
export const AI_ROUTINE_DAILY_WINDOW_SECONDS = 86400;

/** Quota keys used with the existing `checkRateLimit` / `rate_limit_tracking`. */
export const AI_ROUTINE_BURST_KEY = "generate-routine";
export const AI_ROUTINE_DAILY_KEY = "generate-routine-daily";

/** Fixed server disclaimer. The model does not write this text. */
export const AI_ROUTINE_DISCLAIMER =
	"This is a training draft, not medical advice. Review and edit before saving.";

/**
 * Log fields a generate-routine invocation may emit (status code, latency,
 * charged-or-not, exercise count, validation-failure code). Never prompt text,
 * load context, draft bodies, or raw provider errors.
 */
export const SAFE_LOG_FIELDS = [
	"status",
	"latencyMs",
	"admissionCharged",
	"exerciseCount",
	"validationFailureCode",
] as const;

// ── Request parsing ──────────────────────────────────────────────────────────

export interface LoadContextItem {
	exerciseId: string;
	estimated1RmKg: number;
}

export interface GenerateRoutineRequest {
	prompt: string;
	kind: "routine";
	targetMinutes: number | null;
	includeLoadContext: boolean;
	loadContext: LoadContextItem[];
}

export type ParseRequestResult =
	| { ok: true; request: GenerateRoutineRequest }
	| { ok: false; code: "invalid_request" | "program_generation_not_enabled"; message: string };

const MAX_PROMPT_CHARS = 1000;
const MAX_LOAD_CONTEXT_ITEMS = 40;
const MIN_TARGET_MINUTES = 10;
const MAX_TARGET_MINUTES = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate the request body. `prompt` is trimmed to 1–1000 chars;
 * `kind` must be `"routine"` (`"program"` errors with
 * `program_generation_not_enabled` so phase 2 can enable it without a new
 * URL); `targetMinutes` is an optional integer 10–120; `includeLoadContext`
 * defaults to false — when false the `loadContext` array is ignored entirely;
 * `loadContext` accepts at most 40 `{ exerciseId, estimated1RmKg }` items and
 * is never stored.
 */
export function parseGenerateRoutineRequest(body: unknown): ParseRequestResult {
	if (!isRecord(body)) {
		return { ok: false, code: "invalid_request", message: "Request body must be a JSON object." };
	}

	const rawPrompt = body.prompt;
	if (typeof rawPrompt !== "string") {
		return { ok: false, code: "invalid_request", message: "prompt is required." };
	}
	const prompt = rawPrompt.trim();
	if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
		return {
			ok: false,
			code: "invalid_request",
			message: `prompt must be 1–${MAX_PROMPT_CHARS} characters after trimming.`,
		};
	}

	if (body.kind !== undefined && body.kind !== null) {
		if (body.kind === "program") {
			return {
				ok: false,
				code: "program_generation_not_enabled",
				message: "Multi-day program generation is not enabled yet. Generate a single workout instead.",
			};
		}
		if (body.kind !== "routine") {
			return { ok: false, code: "invalid_request", message: 'kind must be "routine".' };
		}
	}

	let targetMinutes: number | null = null;
	if (body.targetMinutes !== undefined && body.targetMinutes !== null) {
		const value = body.targetMinutes;
		if (
			typeof value !== "number" ||
			!Number.isInteger(value) ||
			value < MIN_TARGET_MINUTES ||
			value > MAX_TARGET_MINUTES
		) {
			return {
				ok: false,
				code: "invalid_request",
				message: `targetMinutes must be an integer between ${MIN_TARGET_MINUTES} and ${MAX_TARGET_MINUTES}.`,
			};
		}
		targetMinutes = value;
	}

	const includeLoadContext = body.includeLoadContext === true;

	let loadContext: LoadContextItem[] = [];
	if (includeLoadContext && body.loadContext !== undefined && body.loadContext !== null) {
		if (!Array.isArray(body.loadContext)) {
			return { ok: false, code: "invalid_request", message: "loadContext must be an array." };
		}
		if (body.loadContext.length > MAX_LOAD_CONTEXT_ITEMS) {
			return {
				ok: false,
				code: "invalid_request",
				message: `loadContext accepts at most ${MAX_LOAD_CONTEXT_ITEMS} items.`,
			};
		}
		const seen = new Set<string>();
		for (const item of body.loadContext) {
			if (!isRecord(item)) {
				return { ok: false, code: "invalid_request", message: "loadContext items must be objects." };
			}
			const exerciseId = item.exerciseId;
			const estimated1RmKg = item.estimated1RmKg;
			if (typeof exerciseId !== "string" || exerciseId.length === 0) {
				return { ok: false, code: "invalid_request", message: "loadContext items need an exerciseId." };
			}
			if (typeof estimated1RmKg !== "number" || !Number.isFinite(estimated1RmKg) || estimated1RmKg <= 0) {
				return {
					ok: false,
					code: "invalid_request",
					message: "loadContext items need a positive estimated1RmKg.",
				};
			}
			if (seen.has(exerciseId)) continue;
			seen.add(exerciseId);
			loadContext.push({ exerciseId, estimated1RmKg });
		}
	}

	return {
		ok: true,
		request: { prompt, kind: "routine", targetMinutes, includeLoadContext, loadContext },
	};
}

// ── Prompt hint mapping (English only — documented MVP limitation) ──────────

export type MuscleFamily = "CHEST" | "SHOULDERS" | "ARMS" | "BACK" | "LEGS" | "CORE";

export interface PromptHints {
	positiveMuscles: MuscleFamily[];
	excludedMuscles: MuscleFamily[];
	detectedModes: WireMode[];
}

/**
 * Pinned keyword dictionary (implementation-spec §BE-A.2). English only:
 * "Constraint hints currently understand English muscle and mode words" is an
 * explicit MVP limitation shown on the prompt screen — not arbitrary-language
 * injury protection.
 */
const MUSCLE_KEYWORDS: Array<[RegExp, MuscleFamily[]]> = [
	[/\bupper[\s-]?body\b/gi, ["CHEST", "SHOULDERS", "ARMS", "BACK"]],
	[/\blower[\s-]?body\b/gi, ["LEGS"]],
	[/\bchest\b/gi, ["CHEST"]],
	[/\b(?:shoulders?|delts?|deltoids?)\b/gi, ["SHOULDERS"]],
	[/\b(?:arms?|biceps?|triceps?|forearms?)\b/gi, ["ARMS"]],
	[/\b(?:back|lats?)\b/gi, ["BACK"]],
	[/\b(?:legs?|quads?|quadriceps|hamstrings?|glutes?|calves|calf)\b/gi, ["LEGS"]],
	[/\b(?:core|abs?|abdominals?)\b/gi, ["CORE"]],
];

/** Mode words resolved through the shared wire vocabulary (`toWireMode`). */
const MODE_KEYWORDS = [
	"echo",
	"pump",
	"tut",
	"tut beast",
	"tut_beast",
	"eccentric",
	"eccentric only",
	"eccentric_only",
	"old school",
	"old_school",
];

/** Negative cues: a muscle keyword within 3 words after one of these is excluded. */
const EXCLUSION_CUE =
	/\b(?:avoid|avoiding|excluding|except|no|not|skip|skipping|without|leave out|don'?t want|don'?t train|not train|sore)\b/gi;

/** A muscle keyword followed closely by soreness language is excluded. */
const SORENESS_SUFFIX =
	/^[\s,]*(?:is|are|were|been|feel|feels|feeling)\b(?:\W+\w+){0,2}\W+\b(?:sore|tired|hurt|hurts|hurting|injured|buggy|niggling|bothering)\b/i;

function normalizeMuscleFamily(raw: string): MuscleFamily | null {
	const key = raw.trim().toUpperCase();
	return key === "CHEST" || key === "SHOULDERS" || key === "ARMS" || key === "BACK" ||
			key === "LEGS" || key === "CORE"
		? key
		: null;
}

/**
 * Map a prompt to positive muscle hints, recognized exclusions and detected
 * workout modes. Exclusion cues ("avoid", "no", "without", …) attach to muscle
 * keywords within a 3-word window; a muscle keyword followed by soreness
 * language ("shoulders are sore") is also recognized as excluded. `upper body`
 * maps to CHEST+SHOULDERS+ARMS+BACK, `lower body` to LEGS. Mode words go
 * through `toWireMode` (Echo detected, narrows nothing in the catalog).
 */
export function mapPromptToHints(prompt: string): PromptHints {
	const positives = new Set<MuscleFamily>();
	const excluded = new Set<MuscleFamily>();

	// Collect every muscle keyword match with its offset first, so exclusion
	// cues can look at what follows them.
	interface Hit { family: MuscleFamily[]; index: number; length: number }
	const hits: Hit[] = [];
	for (const [pattern, families] of MUSCLE_KEYWORDS) {
		const re = new RegExp(pattern.source, pattern.flags);
		let m: RegExpExecArray | null;
		while ((m = re.exec(prompt)) !== null) {
			hits.push({ family: families, index: m.index, length: m[0].length });
			if (m.index === re.lastIndex) re.lastIndex++;
		}
	}

	// Exclusion cues: muscle keyword within a 3-word window after the cue.
	EXCLUSION_CUE.lastIndex = 0;
	let cue: RegExpExecArray | null;
	while ((cue = EXCLUSION_CUE.exec(prompt)) !== null) {
		const windowStart = cue.index + cue[0].length;
		// Roughly three words ahead of the cue.
		let windowEnd = windowStart;
		let wordsSeen = 0;
		while (windowEnd < prompt.length && wordsSeen < 8) {
			const ch = prompt[windowEnd];
			if (/\s/.test(ch)) wordsSeen++;
			windowEnd++;
		}
		for (const hit of hits) {
			const hitEnd = hit.index + hit.length;
			if (hit.index >= windowStart && hitEnd <= windowEnd) {
				for (const f of hit.family) excluded.add(f);
			}
		}
	}

	// Soreness suffixes: "shoulders are sore", "my knee feels hurt". Only the
	// immediately-preceding keyword counts — a later keyword's soreness must
	// not drag every earlier hit into the excluded set.
	for (const hit of hits) {
		const tail = prompt.slice(hit.index + hit.length, hit.index + hit.length + 48);
		if (SORENESS_SUFFIX.test(tail)) {
			for (const f of hit.family) excluded.add(f);
		}
	}

	for (const hit of hits) {
		for (const f of hit.family) positives.add(f);
	}

	// Mode words (multiword first so "tut beast" is not consumed by "tut").
	const lowered = prompt.toLowerCase();
	const detected = new Set<WireMode>();
	for (const phrase of MODE_KEYWORDS) {
		if (lowered.includes(phrase)) {
			const wire = toWireMode(phrase.replace(/[\s]+/g, " "));
			if (wire) detected.add(wire);
		}
	}

	// Exclusions win over positives (amendment 1: negatives are never relaxed).
	for (const f of excluded) positives.delete(f);

	return {
		positiveMuscles: [...positives],
		excludedMuscles: [...excluded],
		detectedModes: [...detected],
	};
}

// ── Catalog slicing (binding amendment 1) ───────────────────────────────────

export interface CatalogCandidateRow {
	id: string;
	name?: string | null;
	aliases?: string[] | null;
	muscle_group?: string | null;
	muscle_groups?: string[] | null;
	muscles?: string[] | null;
	equipment?: string[] | null;
	default_cable_config?: string | null;
	source?: string | null;
	popularity?: number | null;
	archived?: boolean | null;
	is_custom?: boolean | null;
	user_id?: string | null;
}

export interface SliceRow {
	id: string;
	name: string;
	muscle_group: string;
	equipment: string[];
	default_cable_config: string;
	isCustom: boolean;
}

export type SliceResult =
	| { ok: true; rows: SliceRow[]; droppedCustomRows: number; relaxed: boolean }
	| { ok: false; code: "slice_empty"; message: string };

/** The only stock sources whose ids the phone library contains. */
export const ALLOWED_STOCK_SOURCES = ["free-exercise-db", "phoenix-supplemental"];

const MAX_STOCK_ROWS = 80;
const MAX_CUSTOM_ROWS = 20;
/** Positive hints relax when the compliant stock set is smaller than this. */
export const SLICE_RELAXATION_THRESHOLD = 12;

/** `wger_` ids are portal-catalog-only (integration-model: never in slice). */
export function isWgerRow(row: CatalogCandidateRow): boolean {
	return row.source === "wger" || String(row.id ?? "").startsWith("wger_");
}

function rowMuscleFamilies(row: CatalogCandidateRow): Set<MuscleFamily> {
	const out = new Set<MuscleFamily>();
	const sources: string[] = [];
	if (typeof row.muscle_group === "string") sources.push(row.muscle_group);
	for (const g of row.muscle_groups ?? []) if (typeof g === "string") sources.push(g);
	for (const m of row.muscles ?? []) if (typeof m === "string") sources.push(m);
	for (const raw of sources) {
		const family = normalizeMuscleFamily(raw);
		if (family) out.add(family);
	}
	return out;
}

function normalizeNameKey(name: string): string {
	return name
		.toLowerCase()
		.replace(/[-_/()]+/g, " ")
		.replace(/[^a-z0-9\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Prompt tokens usable as name/alias hit candidates (3+ chars). */
function promptNameTokens(prompt: string): Set<string> {
	const out = new Set<string>();
	for (const token of normalizeNameKey(prompt).split(" ")) {
		if (token.length >= 3) out.add(token);
	}
	return out;
}

function rowNameKeys(row: CatalogCandidateRow): string[] {
	const labels = [row.name, ...(row.aliases ?? [])];
	const out: string[] = [];
	for (const label of labels) {
		if (typeof label === "string") {
			const key = normalizeNameKey(label);
			if (key) out.push(key);
		}
	}
	return out;
}

function toSliceRow(row: CatalogCandidateRow): SliceRow {
	return {
		id: String(row.id),
		name: typeof row.name === "string" && row.name.trim().length > 0 ? row.name : String(row.id),
		muscle_group: typeof row.muscle_group === "string" ? row.muscle_group : "",
		equipment: Array.isArray(row.equipment) ? row.equipment.map(String) : [],
		default_cable_config:
			typeof row.default_cable_config === "string" && row.default_cable_config.length > 0
				? row.default_cable_config
				: "DOUBLE",
		isCustom: row.is_custom === true,
	};
}

function popularityOf(row: CatalogCandidateRow): number {
	return typeof row.popularity === "number" && Number.isFinite(row.popularity) ? row.popularity : 0;
}

/**
 * Exclusion gate, applied to EVERY candidate at EVERY step (amendment 1):
 * stock rows, name/alias additions and custom rows alike. A row whose
 * classification intersects a recognized exclusion is dropped. A custom row
 * whose muscle metadata is insufficient to prove compliance with a recognized
 * exclusion is dropped too. Exclusions are never relaxed — only positive hints
 * are.
 */
function passesExclusions(
	row: CatalogCandidateRow,
	excluded: Set<MuscleFamily>,
): boolean {
	if (excluded.size === 0) return true;
	if (isWgerRow(row)) return false;
	const families = rowMuscleFamilies(row);
	if (row.is_custom === true && families.size === 0) {
		// Insufficient metadata to prove compliance — drop.
		return false;
	}
	for (const family of families) {
		if (excluded.has(family)) return false;
	}
	return true;
}

function matchesPositives(row: CatalogCandidateRow, positives: Set<MuscleFamily>): boolean {
	if (positives.size === 0) return true;
	const families = rowMuscleFamilies(row);
	for (const family of families) {
		if (positives.has(family)) return true;
	}
	return false;
}

function matchesNameTokens(row: CatalogCandidateRow, tokens: Set<string>): boolean {
	if (tokens.size === 0) return false;
	for (const key of rowNameKeys(row)) {
		for (const token of tokens) {
			if (key.includes(token)) return true;
		}
	}
	return false;
}

/**
 * Select the bounded generation slice from handler-fetched candidate rows.
 *
 * Stock rows: `is_custom = false`, `source ∈ {free-exercise-db,
 * phoenix-supplemental}`, `archived = false`, never `wger` sources/ids.
 * Custom rows: `is_custom = true` and `user_id = callerId`, capped at 20.
 *
 * Positive hints filter the stock set; when the compliant stock set falls
 * below 12 rows the positive hints RELAX to a popularity head of the allowed
 * sources plus prompt name/alias hits — but recognized exclusions still apply
 * to every row added by any path. An empty compliant slice returns
 * `slice_empty` so the handler can fail with `generation_invalid` before quota
 * admission and before any provider call.
 */
export function selectGenerationCatalogSlice(
	rows: CatalogCandidateRow[],
	hints: PromptHints,
	callerId: string,
	prompt = "",
): SliceResult {
	const excluded = new Set<MuscleFamily>(hints.excludedMuscles);
	const positives = new Set<MuscleFamily>(hints.positiveMuscles);
	const tokens = promptNameTokens(prompt);

	const stock: CatalogCandidateRow[] = [];
	const custom: CatalogCandidateRow[] = [];
	for (const row of rows) {
		if (!row || typeof row.id !== "string" || row.id.length === 0) continue;
		if (row.archived === true) continue;
		if (isWgerRow(row)) continue;
		if (row.is_custom === true) {
			if (row.user_id !== callerId) continue; // another user's custom row
			custom.push(row);
		} else {
			if (typeof row.source !== "string" || !ALLOWED_STOCK_SOURCES.includes(row.source)) continue;
			stock.push(row);
		}
	}

	// Deterministic order: popularity desc, then id asc.
	const byPopularityDesc = (a: CatalogCandidateRow, b: CatalogCandidateRow) =>
		popularityOf(b) - popularityOf(a) || String(a.id).localeCompare(String(b.id));
	stock.sort(byPopularityDesc);
	custom.sort(byPopularityDesc);
	const customCapped = custom.slice(0, MAX_CUSTOM_ROWS);
	const droppedCustomRows = Math.max(custom.length - customCapped.length, 0);

	const stockExcludedCompliant = stock.filter((row) => passesExclusions(row, excluded));
	const strictStock = stockExcludedCompliant.filter(
		(row) => matchesPositives(row, positives) || matchesNameTokens(row, tokens),
	);

	let relaxed = false;
	let chosenStock: CatalogCandidateRow[];
	if (positives.size === 0 || strictStock.length >= SLICE_RELAXATION_THRESHOLD) {
		chosenStock = positives.size === 0 ? stockExcludedCompliant : strictStock;
	} else {
		// Binding amendment 1: positives relax, exclusions NEVER do. The
		// relaxed set is the popularity head of the allowed sources plus
		// prompt name/alias hits — every row re-passes the exclusion gate.
		relaxed = true;
		const relaxedPool = new Map<string, CatalogCandidateRow>();
		for (const row of stockExcludedCompliant.slice(0, MAX_STOCK_ROWS)) {
			relaxedPool.set(row.id, row);
		}
		for (const row of stockExcludedCompliant) {
			if (matchesNameTokens(row, tokens)) relaxedPool.set(row.id, row);
		}
		chosenStock = [...relaxedPool.values()].sort(byPopularityDesc);
	}

	// Custom rows follow the same positive filter in the strict path (with a
	// name-hit bypass); under relaxation all compliant caller customs join.
	const chosenCustom = customCapped.filter((row) => {
		if (!passesExclusions(row, excluded)) return false;
		if (relaxed || positives.size === 0) return true;
		return matchesPositives(row, positives) || matchesNameTokens(row, tokens) ||
			rowMuscleFamilies(row).size === 0;
	});

	const finalStock = chosenStock.slice(0, MAX_STOCK_ROWS);
	const finalCustom = chosenCustom.slice(0, MAX_CUSTOM_ROWS);

	// Final compliance re-check on the exact rows that will leave this function.
	const rowsOut: SliceRow[] = [];
	for (const row of [...finalStock, ...finalCustom]) {
		if (!passesExclusions(row, excluded)) continue;
		rowsOut.push(toSliceRow(row));
	}

	if (rowsOut.length === 0) {
		return {
			ok: false,
			code: "slice_empty",
			message: "No catalog exercises match this request safely. Try relaxing your constraints.",
		};
	}

	return { ok: true, rows: rowsOut, droppedCustomRows, relaxed };
}

// ── Model request ───────────────────────────────────────────────────────────

export interface ModelCatalogEntry {
	id: string;
	name: string;
	muscle_group: string;
	equipment: string[];
	default_cable_config: string;
}

export interface ModelRequest {
	prompt: string;
	targetMinutes: number | null;
	detectedModes: WireMode[];
	excludedMuscles: MuscleFamily[];
	catalog: ModelCatalogEntry[];
	loadContext: LoadContextItem[];
	limits: {
		minExercises: number;
		maxExercises: number;
		minSets: number;
		maxSets: number;
		minReps: number;
		maxReps: number;
		minRestSeconds: number;
		maxRestSeconds: number;
		minPercentOfOneRm: number;
		maxPercentOfOneRm: number;
		maxSupersetGroupSize: number;
	};
	disclaimer: string;
}

export interface BuildModelRequestParams {
	request: GenerateRoutineRequest;
	hints: PromptHints;
	sliceRows: SliceRow[];
}

/**
 * Build the structured model request. Per-row payload is exactly
 * `id, name, muscle_group, equipment, default_cable_config` — never
 * descriptions, thumbnails or user data. Caps: 80 stock + 20 custom rows.
 * Load-context values attach ONLY for ids present in the slice actually sent
 * to the model; nothing is stored.
 */
export function buildModelRequest(params: BuildModelRequestParams): ModelRequest {
	const { request, hints, sliceRows } = params;

	const stock = sliceRows.filter((r) => !r.isCustom).slice(0, MAX_STOCK_ROWS);
	const custom = sliceRows.filter((r) => r.isCustom).slice(0, MAX_CUSTOM_ROWS);
	const sliceIds = new Set([...stock, ...custom].map((r) => r.id));

	const loadContext = request.includeLoadContext
		? request.loadContext.filter((item) => sliceIds.has(item.exerciseId))
		: [];

	const toEntry = (row: SliceRow): ModelCatalogEntry => ({
		id: row.id,
		name: row.name,
		muscle_group: row.muscle_group,
		equipment: row.equipment,
		default_cable_config: row.default_cable_config,
	});

	return {
		prompt: request.prompt,
		targetMinutes: request.targetMinutes,
		detectedModes: hints.detectedModes,
		excludedMuscles: hints.excludedMuscles,
		catalog: [...stock.map(toEntry), ...custom.map(toEntry)],
		loadContext,
		limits: {
			minExercises: 1,
			maxExercises: 12,
			minSets: 1,
			maxSets: 6,
			minReps: 1,
			maxReps: 30,
			minRestSeconds: 10,
			maxRestSeconds: 300,
			minPercentOfOneRm: 40,
			maxPercentOfOneRm: 90,
			maxSupersetGroupSize: 4,
		},
		disclaimer: AI_ROUTINE_DISCLAIMER,
	};
}

// ── Draft validation (amendment 1: ids revalidated against the slice) ───────

/**
 * Mirror of `TemplateModels.kt:62` `defaultPercentOfOneRmForReps` (mobile
 * project-phoenix-mp). Keep the two tables in sync — `routineDraft.test.ts`
 * asserts this mirror. Reps 5–6 → 75%, 8 → 70%, 10 → 65%, 12 → 60%, 15+ →
 * 55%; timed/unspecified → 70%.
 */
export function defaultPercentOfOneRmForReps(reps: number | null): number {
	if (reps === null) return 70;
	if (reps <= 6) return 75;
	if (reps <= 8) return 70;
	if (reps <= 10) return 65;
	if (reps <= 12) return 60;
	return 55;
}

export interface NormalizedDraftExercise {
	exerciseId: string;
	sets: number;
	reps: number;
	mode: WireMode;
	percentOfOneRm: number;
	restSeconds: number;
	supersetGroup: string | null;
	echoLevel: EchoLevel | null;
	eccentricLoad: EccentricLoad | null;
}

export interface NormalizedDraft {
	name: string;
	targetMinutes: number | null;
	avoidedMuscles: string[];
	unmetConstraints: string[];
	exercises: NormalizedDraftExercise[];
}

export interface DroppedExercise {
	exerciseId: string | null;
	reason: string;
}

export type ValidationResult =
	| { ok: true; draft: NormalizedDraft; dropped: DroppedExercise[] }
	| { ok: false; code: "generation_invalid"; issues: string[]; dropped: DroppedExercise[] };

const MAX_DRAFT_NAME_CHARS = 80;

/**
 * Validate and normalize a model-produced draft against the allowed slice.
 *
 * - Unknown `exerciseId`s are dropped, never substituted (acceptance 9).
 * - `sets` 1–6 and integer `reps` 1–30 required; out-of-range/malformed
 *   exercises are dropped ("no timed-only exercises in v1").
 * - `restSeconds` outside 10–300 defaults to 60; `percentOfOneRm` outside
 *   40–90 falls back to `defaultPercentOfOneRmForReps(reps)`.
 * - `mode` outside the wire vocabulary becomes OLD_SCHOOL; Echo level and
 *   eccentric load survive only on ECHO mode (imported vocabulary).
 * - `supersetGroup`: null = standalone; groups of one are flattened; groups
 *   larger than 4 fail the whole draft.
 * - 1–12 exercises after drops, else `generation_invalid`.
 * - `name` trimmed to 80 chars else "AI workout". No coach-note field survives.
 */
export function validateGeneratedDraft(
	draft: unknown,
	allowedIds: ReadonlySet<string>,
): ValidationResult {
	const dropped: DroppedExercise[] = [];
	const issues: string[] = [];

	if (!isRecord(draft) || !Array.isArray(draft.exercises)) {
		return {
			ok: false,
			code: "generation_invalid",
			issues: ["draft.exercises must be an array"],
			dropped,
		};
	}

	const rawName = typeof draft.name === "string" ? draft.name.trim() : "";
	const name = rawName.length > 0 ? rawName.slice(0, MAX_DRAFT_NAME_CHARS) : "AI workout";

	const rawAvoided = Array.isArray(draft.avoidedMuscles)
		? draft.avoidedMuscles.filter((m): m is string => typeof m === "string").map((m) => m.trim()).filter((m) => m.length > 0)
		: [];
	const rawUnmet = Array.isArray(draft.unmetConstraints)
		? draft.unmetConstraints.filter((m): m is string => typeof m === "string").map((m) => m.trim()).filter((m) => m.length > 0)
		: [];

	const candidates: NormalizedDraftExercise[] = [];
	for (const entry of draft.exercises) {
		if (!isRecord(entry)) {
			dropped.push({ exerciseId: null, reason: "malformed_entry" });
			continue;
		}
		const exerciseId = typeof entry.exerciseId === "string" ? entry.exerciseId : null;
		if (!exerciseId) {
			dropped.push({ exerciseId: null, reason: "missing_exercise_id" });
			continue;
		}
		// Revalidation against the final allowed slice (amendment 1). Unknown
		// ids are dropped, never substituted with a different movement.
		if (!allowedIds.has(exerciseId)) {
			dropped.push({ exerciseId, reason: "unknown_exercise_id" });
			continue;
		}

		const sets = entry.sets;
		if (typeof sets !== "number" || !Number.isInteger(sets) || sets < 1 || sets > 6) {
			dropped.push({ exerciseId, reason: "sets_out_of_range" });
			continue;
		}
		const reps = entry.reps;
		if (typeof reps !== "number" || !Number.isInteger(reps) || reps < 1 || reps > 30) {
			dropped.push({ exerciseId, reason: "reps_out_of_range" });
			continue;
		}

		let restSeconds = 60;
		if (
			typeof entry.restSeconds === "number" && Number.isInteger(entry.restSeconds) &&
			entry.restSeconds >= 10 && entry.restSeconds <= 300
		) {
			restSeconds = entry.restSeconds;
		}

		let percentOfOneRm = defaultPercentOfOneRmForReps(reps);
		if (
			typeof entry.percentOfOneRm === "number" && Number.isFinite(entry.percentOfOneRm) &&
			entry.percentOfOneRm >= 40 && entry.percentOfOneRm <= 90
		) {
			percentOfOneRm = Math.round(entry.percentOfOneRm);
		}

		const wireMode = toWireMode(entry.mode) ?? DEFAULT_WIRE_MODE;

		let echoLevel: EchoLevel | null = null;
		let eccentricLoad: EccentricLoad | null = null;
		if (wireMode === "ECHO") {
			if (typeof entry.echoLevel === "string" && (ECHO_LEVELS as readonly string[]).includes(entry.echoLevel)) {
				echoLevel = entry.echoLevel as EchoLevel;
			}
			if (
				typeof entry.eccentricLoad === "string" &&
				(ECCENTRIC_LOADS as readonly string[]).includes(entry.eccentricLoad)
			) {
				eccentricLoad = entry.eccentricLoad as EccentricLoad;
			}
		}

		let supersetGroup: string | null = null;
		if (typeof entry.supersetGroup === "string" && entry.supersetGroup.trim().length > 0) {
			supersetGroup = entry.supersetGroup.trim();
		} else if (typeof entry.supersetGroup === "number" && Number.isFinite(entry.supersetGroup)) {
			supersetGroup = String(entry.supersetGroup);
		}

		candidates.push({
			exerciseId,
			sets,
			reps,
			mode: wireMode,
			percentOfOneRm,
			restSeconds,
			supersetGroup,
			echoLevel,
			eccentricLoad,
		});
	}

	if (candidates.length === 0) {
		return {
			ok: false,
			code: "generation_invalid",
			issues: ["no usable exercises after validation"],
			dropped,
		};
	}
	if (candidates.length > 12) {
		// "1–12 exercises after drops, or 422."
		return {
			ok: false,
			code: "generation_invalid",
			issues: [`too_many_exercises: ${candidates.length}`],
			dropped,
		};
	}

	// Superset grouping: groups of one flatten to standalone; groups larger
	// than 4 are a validation failure (not a new container type).
	const groupSizes = new Map<string, number>();
	for (const ex of candidates) {
		if (ex.supersetGroup !== null) {
			groupSizes.set(ex.supersetGroup, (groupSizes.get(ex.supersetGroup) ?? 0) + 1);
		}
	}
	for (const [group, size] of groupSizes) {
		if (size > 4) {
			return {
				ok: false,
				code: "generation_invalid",
				issues: [`superset_group_too_large: ${group}`],
				dropped,
			};
		}
	}

	const exercises: NormalizedDraftExercise[] = candidates.map((ex) => {
		if (ex.supersetGroup !== null && (groupSizes.get(ex.supersetGroup) ?? 0) < 2) {
			return { ...ex, supersetGroup: null };
		}
		return ex;
	});

	return {
		ok: true,
		draft: {
			name,
			targetMinutes: null,
			avoidedMuscles: rawAvoided,
			unmetConstraints: rawUnmet,
			exercises,
		},
		dropped,
	};
}

// ── Repair prompt ───────────────────────────────────────────────────────────

/**
 * Build the single repair-attempt prompt text including the rejection list.
 * One repair call is allowed per admitted generation and shares the same quota
 * admission (amendment 2).
 */
export function buildRepairPrompt(rejectionList: string[]): string {
	const lines = rejectionList.length > 0 ? rejectionList : ["draft failed validation"];
	return [
		"Your previous workout draft was rejected. Fix ONLY these problems and return the corrected JSON draft:",
		...lines.map((line, index) => `${index + 1}. ${line}`),
		"Keep every exerciseId from the provided catalog list only. Do not add prose.",
	].join("\n");
}
