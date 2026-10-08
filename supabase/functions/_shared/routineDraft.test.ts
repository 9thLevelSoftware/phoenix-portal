import { assert, assertEquals } from "jsr:@std/assert@1";
import {
	AI_ROUTINE_BURST_LIMIT,
	AI_ROUTINE_BURST_WINDOW_SECONDS,
	AI_ROUTINE_DAILY_LIMIT,
	AI_ROUTINE_DAILY_WINDOW_SECONDS,
	AI_ROUTINE_DISCLAIMER,
	buildModelRequest,
	buildRepairPrompt,
	type CatalogCandidateRow,
	defaultPercentOfOneRmForReps,
	mapPromptToHints,
	parseGenerateRoutineRequest,
	SAFE_LOG_FIELDS,
	selectGenerationCatalogSlice,
	validateGeneratedDraft,
} from "./routineDraft.ts";

// ── Purity contract ─────────────────────────────────────────────────────────

Deno.test("routineDraft: module performs zero Deno.env reads", async () => {
	const source = await Deno.readTextFile(new URL("./routineDraft.ts", import.meta.url));
	assertEquals(source.includes("Deno.env.get"), false);
	assertEquals(source.includes("Deno.env("), false);
});

Deno.test("routineDraft: quota constants match the spec (5/600s burst, 20/86400s daily)", () => {
	assertEquals(AI_ROUTINE_BURST_LIMIT, 5);
	assertEquals(AI_ROUTINE_BURST_WINDOW_SECONDS, 600);
	assertEquals(AI_ROUTINE_DAILY_LIMIT, 20);
	assertEquals(AI_ROUTINE_DAILY_WINDOW_SECONDS, 86400);
	assertEquals(AI_ROUTINE_DISCLAIMER, "This is a training draft, not medical advice. Review and edit before saving.");
});

Deno.test("routineDraft: SAFE_LOG_FIELDS never include prompt/load/draft fields", () => {
	for (const field of SAFE_LOG_FIELDS) {
		assert(!/prompt|load|draft|provider|error/i.test(field), field);
	}
});

// ── parseGenerateRoutineRequest ─────────────────────────────────────────────

Deno.test("parse: trims prompt and defaults", () => {
	const result = parseGenerateRoutineRequest({ prompt: "  build me a chest day  " });
	assert(result.ok);
	assertEquals(result.request.prompt, "build me a chest day");
	assertEquals(result.request.kind, "routine");
	assertEquals(result.request.targetMinutes, null);
	assertEquals(result.request.includeLoadContext, false);
	assertEquals(result.request.loadContext, []);
});

Deno.test("parse: prompt 1-1000 chars after trimming", () => {
	assertEquals(parseGenerateRoutineRequest({ prompt: "   " }).ok, false);
	assertEquals(parseGenerateRoutineRequest({ prompt: "x".repeat(1001) }).ok, false);
	assert(parseGenerateRoutineRequest({ prompt: "x".repeat(1000) }).ok);
});

Deno.test("parse: kind=program returns program_generation_not_enabled", () => {
	const result = parseGenerateRoutineRequest({ prompt: "4 day program", kind: "program" });
	assert(!result.ok);
	assertEquals(result.code, "program_generation_not_enabled");
});

Deno.test("parse: kind must be routine", () => {
	const result = parseGenerateRoutineRequest({ prompt: "hi", kind: "split" });
	assert(!result.ok);
	assertEquals(result.code, "invalid_request");
});

Deno.test("parse: targetMinutes integer 10-120", () => {
	assert(parseGenerateRoutineRequest({ prompt: "hi", targetMinutes: 35 }).ok);
	assert(parseGenerateRoutineRequest({ prompt: "hi", targetMinutes: 10 }).ok);
	assert(parseGenerateRoutineRequest({ prompt: "hi", targetMinutes: 120 }).ok);
	assertEquals(parseGenerateRoutineRequest({ prompt: "hi", targetMinutes: 9 }).ok, false);
	assertEquals(parseGenerateRoutineRequest({ prompt: "hi", targetMinutes: 121 }).ok, false);
	assertEquals(parseGenerateRoutineRequest({ prompt: "hi", targetMinutes: 35.5 }).ok, false);
	assertEquals(parseGenerateRoutineRequest({ prompt: "hi", targetMinutes: "35" }).ok, false);
});

Deno.test("parse: includeLoadContext false ignores loadContext entirely", () => {
	const result = parseGenerateRoutineRequest({
		prompt: "hi",
		loadContext: [{ exerciseId: "e1", estimated1RmKg: 100 }],
	});
	assert(result.ok);
	assertEquals(result.request.includeLoadContext, false);
	assertEquals(result.request.loadContext, []);
});

Deno.test("parse: loadContext max 40 items and strict item shape", () => {
	const items = Array.from({ length: 41 }, (_, i) => ({ exerciseId: `e${i}`, estimated1RmKg: 50 }));
	assertEquals(
		parseGenerateRoutineRequest({ prompt: "hi", includeLoadContext: true, loadContext: items }).ok,
		false,
	);
	assertEquals(
		parseGenerateRoutineRequest({
			prompt: "hi",
			includeLoadContext: true,
			loadContext: [{ exerciseId: "e1", estimated1RmKg: -5 }],
		}).ok,
		false,
	);
	assertEquals(
		parseGenerateRoutineRequest({
			prompt: "hi",
			includeLoadContext: true,
			loadContext: [{ estimated1RmKg: 50 }],
		}).ok,
		false,
	);
	const ok = parseGenerateRoutineRequest({
		prompt: "hi",
		includeLoadContext: true,
		loadContext: [{ exerciseId: "e1", estimated1RmKg: 50 }],
	});
	assert(ok.ok);
	assertEquals(ok.request.loadContext, [{ exerciseId: "e1", estimated1RmKg: 50 }]);
});

// ── mapPromptToHints ────────────────────────────────────────────────────────

Deno.test("hints: 'avoid shoulders' excludes SHOULDERS and keeps positives out of it", () => {
	const hints = mapPromptToHints("I trained chest yesterday. Upper body today, avoid shoulders.");
	assert(hints.excludedMuscles.includes("SHOULDERS"));
	assert(!hints.positiveMuscles.includes("SHOULDERS"));
	assert(hints.positiveMuscles.includes("CHEST"));
	assert(hints.positiveMuscles.includes("ARMS"));
	assert(hints.positiveMuscles.includes("BACK"));
});

Deno.test("hints: 'upper body' maps to CHEST+SHOULDERS+ARMS+BACK, 'lower body' to LEGS", () => {
	assertEquals(
		new Set(mapPromptToHints("upper body").positiveMuscles),
		new Set(["CHEST", "SHOULDERS", "ARMS", "BACK"]),
	);
	assertEquals(mapPromptToHints("lower body").positiveMuscles, ["LEGS"]);
});

Deno.test("hints: soreness language marks the muscle excluded", () => {
	const hints = mapPromptToHints("train upper body but shoulders are sore");
	assert(hints.excludedMuscles.includes("SHOULDERS"));
});

Deno.test("hints: Echo is detected as a mode and narrows nothing", () => {
	const hints = mapPromptToHints("Create me an arm blast routine, using Echo");
	assert(hints.detectedModes.includes("ECHO"));
	assert(hints.positiveMuscles.includes("ARMS"));
	assertEquals(hints.excludedMuscles, []);
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const CALLER = "user-caller";
const OTHER_USER = "user-other";

function stockRow(
	id: string,
	muscle: string | null,
	extra: Partial<CatalogCandidateRow> = {},
): CatalogCandidateRow {
	return {
		id,
		name: id.replace(/_/g, " "),
		aliases: [],
		muscle_group: muscle,
		muscle_groups: muscle ? [muscle] : [],
		muscles: muscle ? [muscle.toLowerCase()] : [],
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

// ── selectGenerationCatalogSlice ────────────────────────────────────────────

Deno.test("slice: wger_ row excluded while free-exercise-db row survives", () => {
	const rows = [
		stockRow("wger_12345", "CHEST", { source: "wger" }),
		stockRow("Bench_Press", "CHEST"),
	];
	const slice = selectGenerationCatalogSlice(rows, mapPromptToHints("chest"), CALLER, "chest");
	assert(slice.ok);
	assertEquals(slice.rows.map((r) => r.id), ["Bench_Press"]);
});

Deno.test("slice: another user's custom row absent, caller's present", () => {
	const rows = [
		stockRow("Bench_Press", "CHEST"),
		stockRow("custom_other", "CHEST", { source: "user", is_custom: true, user_id: OTHER_USER }),
		stockRow("custom_mine", "CHEST", { source: "user", is_custom: true, user_id: CALLER }),
	];
	const slice = selectGenerationCatalogSlice(rows, mapPromptToHints("chest"), CALLER, "chest");
	assert(slice.ok);
	assertEquals(new Set(slice.rows.map((r) => r.id)), new Set(["Bench_Press", "custom_mine"]));
});

Deno.test("slice: custom row with insufficient muscle metadata is dropped under a recognized exclusion", () => {
	const rows = [
		stockRow("Bench_Press", "CHEST"),
		stockRow("custom_mystery", null, {
			source: "user",
			is_custom: true,
			user_id: CALLER,
			muscle_group: null,
			muscle_groups: [],
			muscles: [],
		}),
	];
	const slice = selectGenerationCatalogSlice(rows, mapPromptToHints("chest, avoid shoulders"), CALLER, "chest");
	assert(slice.ok);
	assertEquals(slice.rows.map((r) => r.id), ["Bench_Press"]);
});

Deno.test("slice: exclusion is NEVER relaxed in the <12 fallback", () => {
	// Strict positive filter ('legs') leaves 1 stock row (<12) so the slice
	// relaxes to a popularity head — shoulder rows must still be excluded.
	const rows = [
		stockRow("Squat", "LEGS", { popularity: 5 }),
		stockRow("Lateral_Raise", "SHOULDERS", { popularity: 99 }),
		stockRow("Face_Pull", "SHOULDERS", { popularity: 98 }),
		stockRow("Cable_Fly", "CHEST", { popularity: 50 }),
	];
	const hints = mapPromptToHints("leg day, avoid shoulders");
	const slice = selectGenerationCatalogSlice(rows, hints, CALLER, "leg day, avoid shoulders");
	assert(slice.ok);
	assert(slice.relaxed);
	const ids = slice.rows.map((r) => r.id);
	assert(ids.includes("Squat"));
	assert(!ids.includes("Lateral_Raise"));
	assert(!ids.includes("Face_Pull"));
});

Deno.test("slice: name/alias additions still honor exclusions", () => {
	const rows = [
		stockRow("Shoulder_Press", "SHOULDERS", { popularity: 1, aliases: ["military press"] }),
		stockRow("Bench_Press", "CHEST", { popularity: 2 }),
	];
	const hints = mapPromptToHints("military press, avoid shoulders");
	const slice = selectGenerationCatalogSlice(rows, hints, CALLER, "military press, avoid shoulders");
	assert(slice.ok);
	assertEquals(slice.rows.map((r) => r.id), ["Bench_Press"]);
});

Deno.test("slice: empty compliant slice is flagged", () => {
	const rows = [stockRow("Lateral_Raise", "SHOULDERS"), stockRow("Face_Pull", "SHOULDERS")];
	const slice = selectGenerationCatalogSlice(rows, mapPromptToHints("avoid shoulders"), CALLER, "avoid shoulders");
	assert(!slice.ok);
	assertEquals(slice.code, "slice_empty");
});

Deno.test("slice: archived rows and non-allowed sources are excluded", () => {
	const rows = [
		stockRow("Bench_Press", "CHEST"),
		stockRow("Old_Row", "BACK", { archived: true }),
		stockRow("user_thing", "CHEST", { source: "user", is_custom: false }),
	];
	const slice = selectGenerationCatalogSlice(rows, mapPromptToHints("chest"), CALLER, "chest");
	assert(slice.ok);
	assertEquals(slice.rows.map((r) => r.id), ["Bench_Press"]);
});

Deno.test("slice: custom rows capped at 20", () => {
	const rows = Array.from({ length: 25 }, (_, i) =>
		stockRow(`custom_${i}`, "CHEST", { source: "user", is_custom: true, user_id: CALLER }));
	const slice = selectGenerationCatalogSlice(rows, mapPromptToHints("chest"), CALLER, "chest");
	assert(slice.ok);
	assertEquals(slice.rows.length, 20);
	assertEquals(slice.droppedCustomRows, 5);
});

// ── buildModelRequest ───────────────────────────────────────────────────────

Deno.test("model request: per-row payload is id/name/muscle_group/equipment/default_cable_config only", () => {
	const rows = [stockRow("Bench_Press", "CHEST")];
	const hints = mapPromptToHints("chest");
	const slice = selectGenerationCatalogSlice(rows, hints, CALLER, "chest");
	assert(slice.ok);
	const modelRequest = buildModelRequest({
		request: { prompt: "chest", kind: "routine", targetMinutes: 35, includeLoadContext: true, loadContext: [{ exerciseId: "Bench_Press", estimated1RmKg: 80 }, { exerciseId: "not_in_slice", estimated1RmKg: 70 }] },
		hints,
		sliceRows: slice.rows,
	});
	assertEquals(Object.keys(modelRequest.catalog[0]).sort(), [
		"default_cable_config",
		"equipment",
		"id",
		"muscle_group",
		"name",
	]);
	// Load context attaches only for ids in the slice sent to the model.
	assertEquals(modelRequest.loadContext, [{ exerciseId: "Bench_Press", estimated1RmKg: 80 }]);
	assertEquals(modelRequest.disclaimer, AI_ROUTINE_DISCLAIMER);
});

Deno.test("model request: caps at 80 stock + 20 custom", () => {
	const rows = [
		...Array.from({ length: 100 }, (_, i) => stockRow(`stock_${i}`, "CHEST", { popularity: i })),
		...Array.from({ length: 30 }, (_, i) =>
			stockRow(`custom_${i}`, "CHEST", { source: "user", is_custom: true, user_id: CALLER, popularity: i })),
	];
	const hints = mapPromptToHints("chest");
	const slice = selectGenerationCatalogSlice(rows, hints, CALLER, "chest");
	assert(slice.ok);
	const modelRequest = buildModelRequest({
		request: { prompt: "chest", kind: "routine", targetMinutes: null, includeLoadContext: false, loadContext: [] },
		hints,
		sliceRows: slice.rows,
	});
	assertEquals(modelRequest.catalog.filter((e) => e.id.startsWith("stock_")).length, 80);
	assertEquals(modelRequest.catalog.filter((e) => e.id.startsWith("custom_")).length, 20);
});

// ── validateGeneratedDraft ──────────────────────────────────────────────────

const ALLOWED = new Set(["Bench_Press", "Cable_Fly", "Echo_Row", "Push_Up"]);

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

Deno.test("validator: unknown exercise ids are dropped, never substituted", () => {
	const result = validateGeneratedDraft(
		{ name: "Day", exercises: [exercise(), exercise({ exerciseId: "Invented_Curl" })] },
		ALLOWED,
	);
	assert(result.ok);
	assertEquals(result.draft.exercises.map((e) => e.exerciseId), ["Bench_Press"]);
	assertEquals(result.dropped, [{ exerciseId: "Invented_Curl", reason: "unknown_exercise_id" }]);
});

Deno.test("validator: restSeconds outside 10-300 defaults to 60; percentOfOneRm outside 40-90 falls back to the reps table", () => {
	const result = validateGeneratedDraft(
		{
			name: "Day",
			exercises: [
				exercise({ restSeconds: 5, percentOfOneRm: 120 }),
				exercise({ exerciseId: "Cable_Fly", restSeconds: 600, percentOfOneRm: 10 }),
			],
		},
		ALLOWED,
	);
	assert(result.ok);
	assertEquals(result.draft.exercises[0].restSeconds, 60);
	assertEquals(result.draft.exercises[0].percentOfOneRm, defaultPercentOfOneRmForReps(8)); // 70
	assertEquals(result.draft.exercises[1].restSeconds, 60);
	assertEquals(result.draft.exercises[1].percentOfOneRm, 70);
});

Deno.test("validator: percent mirror matches TemplateModels.kt defaultPercentOfOneRmForReps", () => {
	// Golden mirror of shared/src/commonMain/.../TemplateModels.kt:62.
	assertEquals(defaultPercentOfOneRmForReps(null), 70);
	assertEquals(defaultPercentOfOneRmForReps(5), 75);
	assertEquals(defaultPercentOfOneRmForReps(6), 75);
	assertEquals(defaultPercentOfOneRmForReps(7), 70);
	assertEquals(defaultPercentOfOneRmForReps(8), 70);
	assertEquals(defaultPercentOfOneRmForReps(10), 65);
	assertEquals(defaultPercentOfOneRmForReps(12), 60);
	assertEquals(defaultPercentOfOneRmForReps(15), 55);
});

Deno.test("validator: Echo fields stripped on non-Echo modes; kept on ECHO", () => {
	const result = validateGeneratedDraft(
		{
			name: "Day",
			exercises: [
				exercise({ mode: "PUMP", echoLevel: "HARDER", eccentricLoad: "LOAD_100" }),
				exercise({ exerciseId: "Echo_Row", mode: "ECHO", echoLevel: "EPIC", eccentricLoad: "LOAD_120" }),
				exercise({ exerciseId: "Cable_Fly", mode: "ECHO", echoLevel: "BOGUS", eccentricLoad: "LOAD_999" }),
			],
		},
		ALLOWED,
	);
	assert(result.ok);
	assertEquals(result.draft.exercises[0].echoLevel, null);
	assertEquals(result.draft.exercises[0].eccentricLoad, null);
	assertEquals(result.draft.exercises[0].mode, "PUMP");
	assertEquals(result.draft.exercises[1].echoLevel, "EPIC");
	assertEquals(result.draft.exercises[1].eccentricLoad, "LOAD_120");
	assertEquals(result.draft.exercises[2].echoLevel, null);
	assertEquals(result.draft.exercises[2].eccentricLoad, null);
});

Deno.test("validator: unknown mode falls back to OLD_SCHOOL", () => {
	const result = validateGeneratedDraft(
		{ name: "Day", exercises: [exercise({ mode: "TURBO_BEAST" })] },
		ALLOWED,
	);
	assert(result.ok);
	assertEquals(result.draft.exercises[0].mode, "OLD_SCHOOL");
});

Deno.test("validator: superset groups of one flatten; groups of five reject the draft", () => {
	const flat = validateGeneratedDraft(
		{
			name: "Day",
			exercises: [exercise({ supersetGroup: "a" }), exercise({ exerciseId: "Cable_Fly", supersetGroup: "b" })],
		},
		ALLOWED,
	);
	assert(flat.ok);
	assertEquals(flat.draft.exercises.map((e) => e.supersetGroup), [null, null]);

	const grouped = validateGeneratedDraft(
		{
			name: "Day",
			exercises: [
				exercise({ supersetGroup: "g1" }),
				exercise({ exerciseId: "Cable_Fly", supersetGroup: "g1" }),
				exercise({ exerciseId: "Echo_Row", supersetGroup: "g1" }),
			],
		},
		ALLOWED,
	);
	assert(grouped.ok);
	assertEquals(grouped.draft.exercises.map((e) => e.supersetGroup), ["g1", "g1", "g1"]);

	const tooBig = validateGeneratedDraft(
		{
			name: "Day",
			exercises: [
				exercise({ supersetGroup: "g1" }),
				exercise({ exerciseId: "Cable_Fly", supersetGroup: "g1" }),
				exercise({ exerciseId: "Echo_Row", supersetGroup: "g1" }),
				exercise({ exerciseId: "Push_Up", supersetGroup: "g1" }),
				exercise({ exerciseId: "Bench_Press", supersetGroup: "g1" }),
			],
		},
		ALLOWED,
	);
	assert(!tooBig.ok);
	assertEquals(tooBig.code, "generation_invalid");
	assertEquals(tooBig.issues[0], "superset_group_too_large: g1");
});

Deno.test("validator: numeric limits enforced — malformed sets/reps dropped", () => {
	const result = validateGeneratedDraft(
		{
			name: "Day",
			exercises: [
				exercise({ sets: 7 }),
				exercise({ exerciseId: "Cable_Fly", reps: 31 }),
				exercise({ exerciseId: "Echo_Row", reps: null }),
				exercise({ exerciseId: "Push_Up" }),
			],
		},
		ALLOWED,
	);
	assert(result.ok);
	assertEquals(result.draft.exercises.map((e) => e.exerciseId), ["Push_Up"]);
	assertEquals(result.dropped.map((d) => d.reason), [
		"sets_out_of_range",
		"reps_out_of_range",
		"reps_out_of_range",
	]);
});

Deno.test("validator: 1-12 exercises after drops or generation_invalid", () => {
	const thirteen = Array.from({ length: 13 }, (_, i) =>
		exercise({ exerciseId: ["Bench_Press", "Cable_Fly", "Echo_Row", "Push_Up"][i % 4], supersetGroup: `g${i}` }));
	assertEquals(
		validateGeneratedDraft({ name: "Day", exercises: thirteen }, ALLOWED).ok,
		false,
	);
	const empty = validateGeneratedDraft({ name: "Day", exercises: [exercise({ exerciseId: "Gone" })] }, ALLOWED);
	assert(!empty.ok);
	assertEquals(empty.code, "generation_invalid");
});

Deno.test("validator: name trimmed to 80 chars, empty falls back to 'AI workout'; no coach note survives", () => {
	const longName = "x".repeat(120);
	const result = validateGeneratedDraft(
		{
			name: `  ${longName}  `,
			coachNote: "take it easy on the shoulder",
			exercises: [exercise()],
		},
		ALLOWED,
	);
	assert(result.ok);
	assertEquals(result.draft.name.length, 80);
	assertEquals("coachNote" in result.draft, false);
	const unnamed = validateGeneratedDraft({ exercises: [exercise()] }, ALLOWED);
	assert(unnamed.ok);
	assertEquals(unnamed.draft.name, "AI workout");
});

// ── buildRepairPrompt ───────────────────────────────────────────────────────

Deno.test("repair prompt: includes the rejection list", () => {
	const text = buildRepairPrompt(["dropped Invented_Curl: unknown_exercise_id", "sets_out_of_range"]);
	assert(text.includes("Invented_Curl"));
	assert(text.includes("sets_out_of_range"));
	assert(text.includes("1. "));
	assert(text.includes("2. "));
});
