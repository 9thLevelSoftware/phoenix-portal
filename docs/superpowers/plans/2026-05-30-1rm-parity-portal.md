# 1RM Parity (Portal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the portal from computing its own 1RM. Accept and store the mobile-provided canonical estimate; fall back to the *same* hybrid formula only for legacy payloads; and fix the record-type label/CSV case-mismatch bugs.

**Architecture:** Add an optional `estimatedOneRepMaxKg` to the push zod schema, extract the edge function's `exercise_progress` computation into a testable `_shared/exerciseProgressRows.ts` that prefers the mobile value (hybrid fallback), wire `index.ts` to it, align the client-side `biomechanics.ts` fallback to the hybrid, and fix the uppercase `record_type` mapping in CSV export and RecordsTab.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase Edge Functions (Deno), Zod, Biome.

**Counterpart:** `Project-Phoenix-MP` plan `docs/superpowers/plans/2026-05-30-1rm-parity-mobile.md`. The wire field is optional, so deploy order is flexible; the legacy fallback keeps pre-field mobile builds working.

**No DB change:** `exercise_progress.estimated_1rm_kg` already exists — no migration, no `npm run gen:types`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `supabase/functions/_shared/pushPayloadSchema.ts` | Modify `exerciseSchema` (lines 124-132) | Accept optional `estimatedOneRepMaxKg` |
| `supabase/functions/_shared/exerciseProgressRows.ts` | Create | Hybrid estimator + progress-row builder (mobile value first) |
| `src/lib/__tests__/sync-exercise-progress.test.ts` | Create | Unit tests for the builder |
| `supabase/functions/mobile-sync-push/index.ts` | Modify (lines 1322-1361) | Use the extracted builder |
| `src/lib/biomechanics.ts` | Modify `estimateOneRepMax` (lines 19-26) | Align client fallback to hybrid |
| `src/lib/__tests__/biomechanics.test.ts` | Modify | Update/extend 1RM assertions |
| `src/lib/export/csv.ts` | Modify `formatRecordType` (lines 62-72) | Fix uppercase `record_type` mapping |
| `src/lib/export/__tests__/csv.test.ts` | Create | Lock in record-type labels |
| `src/app/components/analytics/RecordsTab.tsx` | Modify `formatRecordTypeLabel` (~line 45) | Same uppercase fix as CSV |
| `phoenix-portal/CLAUDE.md` | Modify | Document the parity constant |

---

## Task 1: Accept `estimatedOneRepMaxKg` in the push schema

**Files:**
- Modify: `supabase/functions/_shared/pushPayloadSchema.ts:124-132`
- Test: `src/lib/__tests__/sync-push-schema.test.ts` is the existing schema test; add one case there. (If unsure of its helpers, the assertion below is self-contained.)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/__tests__/sync-push-schema.test.ts` (imports `pushPayloadSchema` from `../../supabase/functions/_shared/pushPayloadSchema.ts`):

```ts
it("parses estimatedOneRepMaxKg on an exercise", () => {
	const parsed = pushPayloadSchema.parse({
		deviceId: "dev-1",
		platform: "android",
		sessions: [
			{
				id: "11111111-1111-1111-1111-111111111111",
				userId: "u1",
				startedAt: "2026-04-20T12:00:00.000Z",
				exercises: [
					{
						id: "22222222-2222-2222-2222-222222222222",
						sessionId: "11111111-1111-1111-1111-111111111111",
						name: "Squat",
						estimatedOneRepMaxKg: 133.33,
						sets: [],
					},
				],
			},
		],
	});
	expect(parsed.sessions[0].exercises[0].estimatedOneRepMaxKg).toBeCloseTo(133.33);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sync-push-schema`
Expected: FAIL — parsed value is `undefined` (field stripped by the schema).

- [ ] **Step 3: Add the field**

In `pushPayloadSchema.ts`, add to `exerciseSchema` (after `orderIndex`, before `sets`, lines 124-132):

```ts
const exerciseSchema = z.object({
	id: uuid,
	sessionId: uuid,
	exerciseId: nullableField(z.string()),
	name: z.string(),
	muscleGroup: z.string().nullish().transform((v) => v ?? "General"),
	orderIndex: z.number().int().nullish().transform((v) => v ?? 0),
	// Mobile-provided canonical estimated 1RM (per-cable kg). Optional for
	// backward compat; absent → server recomputes (see exerciseProgressRows).
	estimatedOneRepMaxKg: nullableField(z.number()),
	sets: arrayOf(setSchema).default([]),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- sync-push-schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/pushPayloadSchema.ts src/lib/__tests__/sync-push-schema.test.ts
git commit -m "feat: accept estimatedOneRepMaxKg on push exercise schema"
```

---

## Task 2: Extract the progress-row builder with mobile-value preference

**Files:**
- Create: `supabase/functions/_shared/exerciseProgressRows.ts`
- Test: `src/lib/__tests__/sync-exercise-progress.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/sync-exercise-progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildExerciseProgressRows,
	estimateOneRepMaxKg,
} from "../../../supabase/functions/_shared/exerciseProgressRows.ts";

const USER_ID = "00000000-0000-0000-0000-000000000001";

describe("estimateOneRepMaxKg (hybrid)", () => {
	it("uses Brzycki at or below 10 reps", () => {
		expect(estimateOneRepMaxKg(100, 5)).toBeCloseTo(112.5); // 100*36/32
	});
	it("is continuous at 10 reps", () => {
		expect(estimateOneRepMaxKg(100, 10)).toBeCloseTo(133.333, 2);
	});
	it("uses Epley above 10 reps", () => {
		expect(estimateOneRepMaxKg(100, 11)).toBeCloseTo(136.667, 2);
	});
	it("returns 0 for invalid input and weight for a single rep", () => {
		expect(estimateOneRepMaxKg(0, 5)).toBe(0);
		expect(estimateOneRepMaxKg(100, 0)).toBe(0);
		expect(estimateOneRepMaxKg(100, 1)).toBe(100);
	});
});

describe("buildExerciseProgressRows", () => {
	const session = (estimatedOneRepMaxKg?: number) => ({
		id: "s1",
		startedAt: "2026-04-20T12:00:00.000Z",
		exercises: [
			{
				name: "Squat",
				exerciseId: null,
				estimatedOneRepMaxKg,
				sets: [{ weightKg: 60, actualReps: 5 }],
			},
		],
	});

	it("stores the mobile-provided estimate verbatim (rounded to 2dp)", () => {
		const rows = buildExerciseProgressRows([session(133.33)], USER_ID, "default");
		expect(rows).toHaveLength(1);
		expect(rows[0].estimated_1rm_kg).toBe(133.33);
	});

	it("falls back to the hybrid when the field is absent", () => {
		const rows = buildExerciseProgressRows([session(undefined)], USER_ID, "default");
		// Brzycki(60, 5) = 60*36/32 = 67.5
		expect(rows[0].estimated_1rm_kg).toBe(67.5);
	});

	it("skips exercises with no sets", () => {
		const rows = buildExerciseProgressRows(
			[{ id: "s2", startedAt: "x", exercises: [{ name: "E", exerciseId: null, sets: [] }] }],
			USER_ID,
			null,
		);
		expect(rows).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sync-exercise-progress`
Expected: FAIL — module `exerciseProgressRows.ts` does not exist.

- [ ] **Step 3: Create the helper**

Create `supabase/functions/_shared/exerciseProgressRows.ts`:

```ts
/**
 * exercise_progress row builder.
 *
 * Source of truth for estimated 1RM is the MOBILE app, which ships
 * `estimatedOneRepMaxKg` per exercise. This builder stores that value
 * verbatim. It only recomputes (via the canonical hybrid) when the field is
 * absent — i.e. legacy payloads from pre-parity mobile builds.
 *
 * PARITY-CRITICAL: estimateOneRepMaxKg must match mobile
 * OneRepMaxCalculator.estimate (Brzycki for reps <= 10, Epley for reps > 10).
 */

export interface ProgressSetInput {
	weightKg: number;
	actualReps: number;
}

export interface ProgressExerciseInput {
	name: string;
	exerciseId?: string | null;
	estimatedOneRepMaxKg?: number | null;
	sets: ProgressSetInput[];
}

export interface ProgressSessionInput {
	id: string;
	startedAt: string;
	exercises: ProgressExerciseInput[];
}

export interface ExerciseProgressRow {
	user_id: string;
	local_profile_id: string | null;
	exercise_name: string;
	exercise_id: string | null;
	session_id: string;
	recorded_at: string;
	max_weight_kg: number;
	total_volume_kg: number;
	estimated_1rm_kg: number;
	max_reps: number;
	set_count: number;
}

/** Canonical hybrid 1RM estimate (per-cable kg). Continuous at reps == 10. */
export function estimateOneRepMaxKg(weightKg: number, reps: number): number {
	if (weightKg <= 0 || reps <= 0) return 0;
	if (reps === 1) return weightKg;
	if (reps <= 10) return weightKg * (36 / (37 - reps));
	return weightKg * (1 + reps / 30);
}

function bestEstimateFromSets(sets: ProgressSetInput[]): number {
	let best = 0;
	for (const s of sets) {
		const e1rm = estimateOneRepMaxKg(s.weightKg, s.actualReps);
		if (e1rm > best) best = e1rm;
	}
	return best;
}

export function buildExerciseProgressRows(
	sessions: ProgressSessionInput[],
	userId: string,
	localProfileId: string | null,
): ExerciseProgressRow[] {
	const rows: ExerciseProgressRow[] = [];
	for (const session of sessions) {
		for (const exercise of session.exercises) {
			if (exercise.sets.length === 0) continue;

			const maxWeight = Math.max(...exercise.sets.map((s) => s.weightKg));
			const totalVolume = exercise.sets.reduce(
				(sum, s) => sum + s.weightKg * s.actualReps,
				0,
			);
			const maxReps = Math.max(...exercise.sets.map((s) => s.actualReps));
			const setCount = exercise.sets.length;

			const estimated1rm =
				exercise.estimatedOneRepMaxKg != null && exercise.estimatedOneRepMaxKg > 0
					? exercise.estimatedOneRepMaxKg
					: bestEstimateFromSets(exercise.sets);

			rows.push({
				user_id: userId,
				local_profile_id: localProfileId,
				exercise_name: exercise.name,
				exercise_id: exercise.exerciseId ?? null,
				session_id: session.id,
				recorded_at: session.startedAt,
				max_weight_kg: maxWeight,
				total_volume_kg: totalVolume,
				estimated_1rm_kg: Math.round(estimated1rm * 100) / 100,
				max_reps: maxReps,
				set_count: setCount,
			});
		}
	}
	return rows;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- sync-exercise-progress`
Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/exerciseProgressRows.ts src/lib/__tests__/sync-exercise-progress.test.ts
git commit -m "feat: extract exercise_progress builder preferring mobile 1RM"
```

---

## Task 3: Wire the edge function to the extracted builder

**Files:**
- Modify: `supabase/functions/mobile-sync-push/index.ts:1322-1361`

- [ ] **Step 1: Add the import**

Near the top of `index.ts`, alongside the other `../_shared/...` imports, add:

```ts
import { buildExerciseProgressRows } from "../_shared/exerciseProgressRows.ts";
```

- [ ] **Step 2: Replace the inline computation**

Replace the entire block from line 1322 (`// 5. Compute exercise_progress...`) through the close of the `progressRows.push({...})` loop at line 1361 with:

```ts
      // =====================================================================
      // 5. Compute exercise_progress (mobile-provided 1RM, hybrid fallback)
      // =====================================================================
      const progressRows = buildExerciseProgressRows(
        payload.sessions,
        userId,
        localProfileId,
      );
```

Leave the dedupe + insert block (current lines 1363-1401) unchanged — `progressRows` keeps the same row shape (`session_id`, `exercise_id`, `exercise_name`, `estimated_1rm_kg`, …).

- [ ] **Step 3: Verify typecheck and full suite**

Run: `npm run typecheck && npm test -- sync`
Expected: typecheck clean; sync tests pass (the existing round-trip/validation tests still see `estimated_1rm_kg` populated).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mobile-sync-push/index.ts
git commit -m "refactor: use shared builder for exercise_progress in sync-push"
```

---

## Task 4: Align the client-side fallback formula

**Files:**
- Modify: `src/lib/biomechanics.ts:19-26`
- Test: `src/lib/__tests__/biomechanics.test.ts` (modify)

- [ ] **Step 1: Update the test**

In `biomechanics.test.ts`, replace/extend the `estimateOneRepMax` assertions with the hybrid expectations (the function still returns a rounded integer):

```ts
it("estimateOneRepMax uses Brzycki at or below 10 reps", () => {
	expect(estimateOneRepMax(100, 5)).toBe(113); // 112.5 -> 113
});
it("estimateOneRepMax is continuous at 10 reps", () => {
	expect(estimateOneRepMax(100, 10)).toBe(133); // 133.33 -> 133
});
it("estimateOneRepMax uses Epley above 10 reps", () => {
	expect(estimateOneRepMax(100, 11)).toBe(137); // 136.67 -> 137
});
it("estimateOneRepMax returns weight for 1 rep and 0 for invalid", () => {
	expect(estimateOneRepMax(100, 1)).toBe(100);
	expect(estimateOneRepMax(0, 5)).toBe(0);
});
```

Delete any pre-existing `estimateOneRepMax` assertion that encoded the old pure-Epley value (e.g. `estimateOneRepMax(100, 5) === 117`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- biomechanics`
Expected: FAIL on the reps=5 / reps=10 cases (old Epley values).

- [ ] **Step 3: Update the implementation**

Replace `estimateOneRepMax` (lines 19-26):

```ts
/**
 * Estimate one-rep max using the canonical hybrid (parity with mobile
 * OneRepMaxCalculator.estimate): Brzycki for reps <= 10, Epley for reps > 10.
 * Returns a rounded integer; 0 for invalid input; weight itself for 1 rep.
 *
 * NOTE: After 1RM parity, the portal reads estimated_1rm_kg from
 * exercise_progress (mobile-provided). This client computation is a fallback
 * only and MUST use the same formula.
 */
export function estimateOneRepMax(weight: number, reps: number): number {
	if (weight <= 0 || reps <= 0) return 0;
	if (reps === 1) return weight;
	const raw =
		reps <= 10 ? weight * (36 / (37 - reps)) : weight * (1 + reps / 30);
	return Math.round(raw);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- biomechanics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/biomechanics.ts src/lib/__tests__/biomechanics.test.ts
git commit -m "fix: align client 1RM fallback to canonical hybrid"
```

---

## Task 5: Fix CSV record-type mapping

**Files:**
- Modify: `src/lib/export/csv.ts:62-72`
- Test: `src/lib/export/__tests__/csv.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/export/__tests__/csv.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateRecordsCSV } from "../csv";

// Use the function's own parameter type so we don't depend on the import path
// of the PersonalRecord type.
type Records = Parameters<typeof generateRecordsCSV>[0];

function record(recordType: string): Records[number] {
	return {
		exercise_name: "Squat",
		muscle_group: "Legs",
		record_type: recordType,
		value: 100,
		previous_value: null,
		unit: "kg",
		achieved_at: new Date("2026-04-20T00:00:00.000Z"),
	} as unknown as Records[number];
}

describe("generateRecordsCSV record type labels", () => {
	it("maps uppercase MAX_WEIGHT to 'Max Weight'", () => {
		const csv = generateRecordsCSV([record("MAX_WEIGHT")] as Records);
		expect(csv).toContain("Max Weight");
		expect(csv).not.toContain("MAX_WEIGHT");
	});

	it("maps MAX_VOLUME to 'Max Volume'", () => {
		const csv = generateRecordsCSV([record("MAX_VOLUME")] as Records);
		expect(csv).toContain("Max Volume");
	});

	it("maps 1RM to 'Estimated 1RM'", () => {
		const csv = generateRecordsCSV([record("1RM")] as Records);
		expect(csv).toContain("Estimated 1RM");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- export/__tests__/csv`
Expected: FAIL — current map is lowercase-keyed, so the CSV contains raw `MAX_WEIGHT`.

- [ ] **Step 3: Fix `formatRecordType`**

Replace `formatRecordType` (lines 62-72):

```ts
function formatRecordType(type: string): string {
	const types: Record<string, string> = {
		MAX_WEIGHT: "Max Weight",
		MAX_REPS: "Max Reps",
		MAX_VOLUME: "Max Volume",
		"1RM": "Estimated 1RM",
		FASTEST_TIME: "Fastest Time",
		LONGEST_DISTANCE: "Longest Distance",
	};
	// Normalize so legacy lowercase values map too.
	return types[(type ?? "").toUpperCase()] ?? type;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- export/__tests__/csv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/csv.ts src/lib/export/__tests__/csv.test.ts
git commit -m "fix: map uppercase record_type values in CSV export"
```

---

## Task 6: Fix RecordsTab record-type labels (same root cause)

**Files:**
- Modify: `src/app/components/analytics/RecordsTab.tsx` — `formatRecordTypeLabel` (around line 45)

- [ ] **Step 1: Apply the same normalization**

Update `formatRecordTypeLabel` so it maps the actual uppercase DB values (`MAX_WEIGHT` → "Max Weight", `MAX_VOLUME` → "Max Volume", `MAX_REPS` → "Max Reps", `1RM` → "1RM") and normalizes case with `(type ?? "").toUpperCase()`, falling through to the raw string. Mirror the `formatRecordType` map from `csv.ts` so the two stay consistent. Ensure max-weight PRs read "Max Weight", not "1RM".

- [ ] **Step 2: Verify**

Run: `npm test -- RecordsTab` (if a RecordsTab test exists) and `npm run typecheck`
Expected: typecheck clean; any RecordsTab tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/components/analytics/RecordsTab.tsx
git commit -m "fix: normalize record_type labels in RecordsTab"
```

---

## Task 7: Document the parity constant + final verification

**Files:**
- Modify: `phoenix-portal/CLAUDE.md`

- [ ] **Step 1: Add a parity note**

Add to the portal CLAUDE.md (near the sync/transforms guidance):

```markdown
### 1RM Estimate Parity (PARITY-CRITICAL)
- Estimated 1RM is computed on MOBILE (hybrid: Brzycki reps<=10, Epley reps>10) and shipped as `estimatedOneRepMaxKg` per exercise. The edge function stores it verbatim in `exercise_progress.estimated_1rm_kg`.
- `_shared/exerciseProgressRows.ts#estimateOneRepMaxKg` and `src/lib/biomechanics.ts#estimateOneRepMax` are FALLBACKS only and MUST match the mobile formula.
- `personal_records` holds max-weight/max-volume PRs (a different metric) — never relabel them as "1RM".
```

- [ ] **Step 2: Format + full verification**

Run:
```bash
npx biome check --write src/lib/export/csv.ts src/lib/biomechanics.ts \
  src/app/components/analytics/RecordsTab.tsx \
  src/lib/__tests__/sync-exercise-progress.test.ts \
  src/lib/export/__tests__/csv.test.ts
npm run typecheck
npm test
```
Expected: biome clean; typecheck clean; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add phoenix-portal/CLAUDE.md
git commit -m "docs: document 1RM estimate parity constant (portal)"
```

---

## Self-Review

- **Spec coverage:** schema accepts field (Task 1) ✓; edge stores mobile value + hybrid fallback (Tasks 2-3) ✓; client fallback aligned (Task 4) ✓; CSV mapping fixed (Task 5) ✓; RecordsTab label fixed (Task 6) ✓; parity doc (Task 7) ✓. "Portal never computes a *different* number" satisfied: the only TS computations are fallbacks using the identical hybrid.
- **Placeholder scan:** All code blocks concrete except Task 6, which is described precisely (mirror the `csv.ts` map) because the exact current `formatRecordTypeLabel` body must be read in-file; the mapping to apply is fully specified.
- **Type consistency:** `estimateOneRepMaxKg(weightKg, reps)` defined in Task 2 and asserted in Task 2's test; `buildExerciseProgressRows(sessions, userId, localProfileId)` defined in Task 2 and called in Task 3; `ExerciseProgressRow.estimated_1rm_kg` produced in Task 2 and consumed by the unchanged dedupe/insert in Task 3.
- **Coordination:** field is optional → mobile/portal deploy order independent; legacy fallback covers pre-field payloads.
