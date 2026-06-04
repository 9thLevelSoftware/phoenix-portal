# Phase Weight Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable concentric/eccentric weight-phase analytics and visualization support across Phoenix Portal without inventing phase data the portal does not store.

**Architecture:** Treat mobile-provided phase data as authoritative. Use `personal_records.workout_phase` for phase-aware PR/strength analytics and `session_phase_statistics` for concentric/eccentric session metric visualizations. Keep `exercise_progress` aggregate-only unless a later migration preserves per-exercise phase statistics.

**Tech Stack:** React, TypeScript, TanStack Query, Supabase/PostgREST, Zod, ECharts/Recharts, Vitest.

---

## Source Evidence

### Official App Reference

The deobfuscated official app confirms phase separation is a first-class data model, not a display-only label.

- `C:\Users\dasbl\AndroidStudioProjects\VitruvianDeobfuscated\java-decompiled\sources\Zk\j.java`: `WorkoutMetricPhases` serializes each metric as a required `(concentric, eccentric, total)` triple and averages concentric/eccentric with separate counts.
- `C:\Users\dasbl\AndroidStudioProjects\VitruvianDeobfuscated\java-decompiled\sources\Zk\k.java`: `WorkoutMetrics` stores `max`, `average`, and `deviation`, each as `WorkoutMetricPhases`.
- `C:\Users\dasbl\AndroidStudioProjects\VitruvianDeobfuscated\java-decompiled\sources\Zk\t.java`: `WorkoutStatistics` stores separate `force` and `speed` `WorkoutMetrics`.
- `C:\Users\dasbl\AndroidStudioProjects\VitruvianDeobfuscated\java-decompiled\sources\Zk\n.java`: `WorkoutSamples` stores left/right samples plus `phase`.
- `C:\Users\dasbl\AndroidStudioProjects\VitruvianDeobfuscated\java-decompiled\sources\Zk\h.java`: phase statistics are computed from samples by splitting positive velocity as concentric and non-positive velocity as eccentric.
- `C:\Users\dasbl\AndroidStudioProjects\VitruvianDeobfuscated\java-decompiled\sources\com\vitruvian\app\ui\shared\r.java` and `C:\Users\dasbl\AndroidStudioProjects\VitruvianDeobfuscated\java-decompiled\sources\Lj\U.java`: workout summary UI displays peak and average force as paired concentric/eccentric values.

### Portal Source of Truth

- `supabase/migrations/20260319120000_mobile_portal_parity.sql`: `personal_records.workout_phase` exists and `session_phase_statistics` stores concentric/eccentric kg, velocity, and watt averages/maxes.
- `supabase/functions/_shared/pushPayloadSchema.ts`: `phaseStatistics` accepts concentric/eccentric kg, velocity, and watt fields; `personalRecords[*].workoutPhase` defaults to `COMBINED`.
- `supabase/functions/mobile-sync-push/index.ts`: sync persists `phaseStatistics` into `session_phase_statistics` and persists dedicated personal records with `workout_phase`.
- `src/app/components/analytics/RecordsTab.tsx`, `src/app/components/Dashboard.tsx`, and `src/lib/export/csv.ts`: records already display/export workout phase.

### Current Gaps

- `src/queries/analytics.ts` selects `personal_records` for strength progress without `record_type` or `workout_phase`.
- `src/app/components/Analytics.tsx` groups strength data by exercise only, so concentric/eccentric PRs collapse into one trend.
- `src/queries/analytics.ts` has `phaseStatisticsOptions(sessionId)` only; there is no user/period query for trend cards or charts.
- `src/queries/progress.ts`, `src/app/components/ExerciseProgress.tsx`, and `src/app/components/analytics/ExerciseDeepDive.tsx` depend on `exercise_progress`, which has no phase column.
- `src/app/components/SummaryReport.tsx`, `src/app/components/Goals.tsx`, `src/queries/challenges.ts`, `supabase/functions/compute-rankings/index.ts`, and `supabase/functions/generate-insights/index.ts` count or describe PRs without phase semantics.

## Visualization Route

Analytical jobs:

- Time change: phase-aware 1RM/PR progression.
- Comparison: concentric vs eccentric peak/average load, velocity, and power.
- Ranking: top lifts and PR counts with phase semantics.

Artifact family:

- Primary: small-multiple or grouped line chart for PR progression by phase.
- Primary: paired metric bars/cards for concentric vs eccentric load, velocity, and watts.
- Fallback: phase badges and segmented filtering when data volume is too sparse for separate series.

UX rules:

- Keep essential phase values visible without hover.
- Use phase as an explicit control: `All`, `Combined`, `Concentric`, `Eccentric`.
- On mobile, prefer grouped bars and compact paired cards over dense multi-series lines.
- Never show a phase-specific exercise trend from `exercise_progress`; use records or session phase stats until phase-specific exercise progress is persisted.

## File Structure

Create:

- `src/lib/workout-phases.ts`: shared phase labels, normalization, ordering, filters, and type guards.
- `src/lib/__tests__/workout-phases.test.ts`: phase helper tests.
- `src/app/components/analytics/strengthPhaseTransforms.ts`: pure chart transforms for phase-aware strength data.
- `src/app/components/analytics/strengthPhaseTransforms.test.ts`: chart transform tests.
- `src/app/components/analytics/phaseStatisticsTransforms.ts`: pure transforms for session phase stats summary/trends.
- `src/app/components/analytics/phaseStatisticsTransforms.test.ts`: phase metric transform tests.

Modify:

- `src/queries/analytics.ts`: include `workout_phase` and `record_type`; add user-period phase stats query.
- `src/queries/__tests__/analytics.test.ts`: assert new select fields, query keys, filters, and phase stats query behavior.
- `src/app/components/Analytics.tsx`: hold URL-backed phase filter and derive phase-aware chart data.
- `src/app/components/analytics/ProgressTab.tsx`: render phase controls, phase-aware PR summary, and paired phase metric chart/card.
- `src/app/components/analytics/MobileProgressTab.tsx`: render mobile top lifts by phase and paired phase cards.
- `src/app/components/analytics/ExerciseDeepDive.tsx`: display phase-aware PR count and avoid phase-specific 1RM claims from aggregate progress.
- `src/app/components/ExerciseProgress.tsx`: add copy/controls that identify aggregate progress as combined/overall unless a phase-specific record chart is used.
- `src/app/components/SummaryReport.tsx`: break PR summary into combined/concentric/eccentric counts.
- `src/app/components/Goals.tsx`: keep current goals combined by default; prepare phase-aware PR goals only if a goal has a phase field.
- `src/queries/challenges.ts`: document and test whether `pr_count` counts phase rows separately.
- `supabase/functions/compute-rankings/index.ts`: test the selected PR ranking semantics after phase rows are included.
- `supabase/functions/generate-insights/index.ts`: include phase labels in recent PR insight text.
- `src/lib/export/csv.ts`: verify record phase export remains correct.

Intentionally defer:

- Do not add phase filtering to `exercise_progress` in this pass. Current schema lacks phase granularity there.
- Do not add a migration unless product scope requires exercise-level phase progress beyond records and session-level phase stats.

## Task 1: Audit Analytical Consumers

**Files:**
- Review: `src/queries/analytics.ts`
- Review: `src/queries/progress.ts`
- Review: `src/queries/records.ts`
- Review: `src/app/components/Analytics.tsx`
- Review: `src/app/components/analytics/ProgressTab.tsx`
- Review: `src/app/components/analytics/MobileProgressTab.tsx`
- Review: `src/app/components/analytics/RecordsTab.tsx`
- Review: `src/app/components/analytics/ExerciseDeepDive.tsx`
- Review: `src/app/components/ExerciseProgress.tsx`
- Review: `src/app/components/SummaryReport.tsx`
- Review: `src/app/components/Goals.tsx`
- Review: `src/queries/challenges.ts`
- Review: `supabase/functions/compute-rankings/index.ts`
- Review: `supabase/functions/generate-insights/index.ts`
- Review: `src/lib/export/csv.ts`

- [x] **Step 1: Confirm all PR consumers**

Run:

```powershell
rg -n "personal_records|workout_phase|pr_count|strengthProgressOptions|RecordsTab|daysSinceLastPR" src supabase tests
```

Expected: every phase-sensitive PR consumer is listed before implementation starts.

- [x] **Step 2: Confirm all phase-stat consumers**

Run:

```powershell
rg -n "session_phase_statistics|phaseStatistics|concentric_kg|eccentric_kg|concentric_vel|eccentric_vel|concentric_watt|eccentric_watt" src supabase tests
```

Expected: query support exists only for single-session phase stats, and no analytics page renders the table yet.

- [x] **Step 3: Confirm aggregate-only exercise progress**

Run:

```powershell
rg -n "CREATE TABLE IF NOT EXISTS exercise_progress|exercise_progress|estimated_1rm_kg|max_weight_kg|total_volume_kg" supabase src tests
```

Expected: `exercise_progress` has no `workout_phase` or phase stats columns. Keep this as a documented constraint.

- [x] **Step 4: Verify this audit note stays accurate after the live commands**

Update the dated section below `## Audit Results` only if the live audit commands reveal additional consumers. Use one of these exact classifications:

```text
ready-current-schema: can support phase analytics now
needs-query-update: schema supports it, query/component does not
aggregate-only: must remain combined/overall until schema is expanded
semantic-decision: needs product decision on count/ranking semantics
```

## Audit Results

Review date: 2026-06-03.

```text
ready-current-schema:
- src/app/components/analytics/RecordsTab.tsx
- src/app/components/Dashboard.tsx
- src/lib/export/csv.ts

needs-query-update:
- src/queries/analytics.ts
- src/app/components/Analytics.tsx
- src/app/components/analytics/ProgressTab.tsx
- src/app/components/analytics/MobileProgressTab.tsx
- src/app/components/analytics/ExerciseDeepDive.tsx
- src/app/components/SummaryReport.tsx
- supabase/functions/generate-insights/index.ts

aggregate-only:
- src/queries/progress.ts
- src/app/components/ExerciseProgress.tsx
- exercise_progress-backed 1RM, max weight, and volume charts

semantic-decision:
- src/app/components/Goals.tsx
- src/queries/challenges.ts
- supabase/functions/compute-rankings/index.ts
- supabase/migrations/20260412_leaderboard_functions.sql
```

Default decision: phase-specific PR rows count separately because `personal_records.workout_phase` is part of the sync identity and the official app treats concentric/eccentric metrics as independent first-class values. The UI copy should make this explicit where users may expect one PR per exercise.

## Task 2: Add Shared Phase Helpers

**Files:**
- Create: `src/lib/workout-phases.ts`
- Create: `src/lib/__tests__/workout-phases.test.ts`

- [x] **Step 1: Write failing tests for normalization and display**

Add `src/lib/__tests__/workout-phases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	formatWorkoutPhase,
	isWorkoutPhase,
	isNonCombinedWorkoutPhase,
	normalizeWorkoutPhase,
	WORKOUT_PHASE_FILTERS,
} from "@/lib/workout-phases";

describe("workout phase helpers", () => {
	it("normalizes API, database, and display phase values", () => {
		expect(normalizeWorkoutPhase("COMBINED")).toBe("Combined");
		expect(normalizeWorkoutPhase("Concentric")).toBe("Concentric");
		expect(normalizeWorkoutPhase("eccentric")).toBe("Eccentric");
		expect(normalizeWorkoutPhase(null)).toBe("Combined");
	});

	it("keeps phase filter order stable", () => {
		expect(WORKOUT_PHASE_FILTERS).toEqual([
			"all",
			"Combined",
			"Concentric",
			"Eccentric",
		]);
	});

	it("detects valid and non-combined phases", () => {
		expect(isWorkoutPhase("Concentric")).toBe(true);
		expect(isWorkoutPhase("Other")).toBe(false);
		expect(isNonCombinedWorkoutPhase("CONCENTRIC")).toBe(true);
		expect(isNonCombinedWorkoutPhase("COMBINED")).toBe(false);
	});

	it("formats unknown values defensively as Combined", () => {
		expect(formatWorkoutPhase("unexpected")).toBe("Combined");
	});
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
npm test -- src/lib/__tests__/workout-phases.test.ts
```

Expected: FAIL because `src/lib/workout-phases.ts` does not exist.

- [x] **Step 3: Implement the helper**

Create `src/lib/workout-phases.ts`:

```ts
export const WORKOUT_PHASES = ["Combined", "Concentric", "Eccentric"] as const;
export const WORKOUT_PHASE_FILTERS = ["all", ...WORKOUT_PHASES] as const;

export type WorkoutPhase = (typeof WORKOUT_PHASES)[number];
export type WorkoutPhaseFilter = (typeof WORKOUT_PHASE_FILTERS)[number];

const phaseMap: Record<string, WorkoutPhase> = {
	COMBINED: "Combined",
	Combined: "Combined",
	combined: "Combined",
	CONCENTRIC: "Concentric",
	Concentric: "Concentric",
	concentric: "Concentric",
	ECCENTRIC: "Eccentric",
	Eccentric: "Eccentric",
	eccentric: "Eccentric",
};

export function normalizeWorkoutPhase(
	phase: string | null | undefined,
): WorkoutPhase {
	if (!phase) return "Combined";
	return phaseMap[phase] ?? "Combined";
}

export function formatWorkoutPhase(
	phase: string | null | undefined,
): WorkoutPhase {
	return normalizeWorkoutPhase(phase);
}

export function isWorkoutPhase(value: string): value is WorkoutPhase {
	return WORKOUT_PHASES.includes(value as WorkoutPhase);
}

export function isNonCombinedWorkoutPhase(
	phase: string | null | undefined,
): boolean {
	return normalizeWorkoutPhase(phase) !== "Combined";
}
```

- [x] **Step 4: Run the focused test and confirm it passes**

Run:

```powershell
npm test -- src/lib/__tests__/workout-phases.test.ts
```

Expected: PASS.

- [x] **Step 5: Replace duplicate local helpers**

Modify `src/app/components/analytics/RecordsTab.tsx` and `src/app/components/Dashboard.tsx` to import helpers from `@/lib/workout-phases` instead of duplicating phase formatting logic.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/lib/workout-phases.ts src/lib/__tests__/workout-phases.test.ts src/app/components/analytics/RecordsTab.tsx src/app/components/Dashboard.tsx
git commit -m "refactor: centralize workout phase helpers"
```

## Task 3: Make Analytics Queries Phase-Aware

**Files:**
- Modify: `src/queries/analytics.ts`
- Modify: `src/queries/__tests__/analytics.test.ts`
- Modify: `src/queries/keys.ts`

- [x] **Step 1: Write failing query tests for strength phase fields**

Add assertions to `src/queries/__tests__/analytics.test.ts` under `describe("strengthProgressOptions")`:

```ts
it("selects record type and workout phase for phase-aware strength charts", async () => {
	chain = buildChain({ data: [], error: null });
	const { strengthProgressOptions } = await import("../analytics");
	const opts = strengthProgressOptions("user-1");
	await opts.queryFn?.({} as never);
	expect(chain.select).toHaveBeenCalledWith(
		"exercise_name, exercise_id, record_type, workout_phase, value, achieved_at",
	);
});
```

- [x] **Step 2: Update the strength query**

In `src/queries/analytics.ts`, change the strength select to:

```ts
.select("exercise_name, exercise_id, record_type, workout_phase, value, achieved_at")
```

Keep the existing profile filter and `achieved_at` ordering.

- [x] **Step 3: Add query key support for phase stats trends**

In `src/queries/keys.ts`, add:

```ts
phaseStats: (userId: string, period: string, profileId?: string | null) =>
	[
		...queryKeys.analytics.all,
		"phase-stats",
		userId,
		period,
		profileId ?? "all",
	] as const,
```

- [x] **Step 4: Write failing query tests for user-period phase stats**

Add `describe("phaseStatisticsTrendOptions")` with tests that assert:

```ts
expect(opts.queryKey).toEqual(
	queryKeys.analytics.phaseStats("user-1", "4w", "profile-1"),
);
expect(fromFn).toHaveBeenCalledWith("session_phase_statistics");
expect(chain.select).toHaveBeenCalledWith(
	[
		"session_id",
		"concentric_kg_avg",
		"concentric_kg_max",
		"concentric_vel_avg",
		"concentric_vel_max",
		"concentric_watt_avg",
		"concentric_watt_max",
		"eccentric_kg_avg",
		"eccentric_kg_max",
		"eccentric_vel_avg",
		"eccentric_vel_max",
		"eccentric_watt_avg",
		"eccentric_watt_max",
		"workout_sessions!inner(started_at, local_profile_id, name)",
	].join(", "),
);
```

- [x] **Step 5: Implement the phase stats query**

Add to `src/queries/analytics.ts`:

```ts
export function phaseStatisticsTrendOptions(
	userId: string,
	period: string = "4w",
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.analytics.phaseStats(userId, period, profileId),
		queryFn: async () => {
			const daysBack = periodToDays(period);
			const since = new Date();
			since.setDate(since.getDate() - daysBack);

			let query = supabase
				.from("session_phase_statistics")
				.select(
					[
						"session_id",
						"concentric_kg_avg",
						"concentric_kg_max",
						"concentric_vel_avg",
						"concentric_vel_max",
						"concentric_watt_avg",
						"concentric_watt_max",
						"eccentric_kg_avg",
						"eccentric_kg_max",
						"eccentric_vel_avg",
						"eccentric_vel_max",
						"eccentric_watt_avg",
						"eccentric_watt_max",
						"workout_sessions!inner(started_at, local_profile_id, name)",
					].join(", "),
				)
				.eq("user_id", userId)
				.gte("workout_sessions.started_at", since.toISOString())
				.order("created_at", { ascending: true });

			if (profileId) {
				query = query.eq("workout_sessions.local_profile_id", profileId);
			}

			const { data, error } = await query;
			if (error) throw error;
			return data ?? [];
		},
	});
}
```

- [x] **Step 6: Run query tests**

Run:

```powershell
npm test -- src/queries/__tests__/analytics.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/queries/analytics.ts src/queries/__tests__/analytics.test.ts src/queries/keys.ts
git commit -m "feat: query phase-aware analytics data"
```

## Task 4: Add Pure Phase Chart Transforms

**Files:**
- Create: `src/app/components/analytics/strengthPhaseTransforms.ts`
- Create: `src/app/components/analytics/strengthPhaseTransforms.test.ts`
- Create: `src/app/components/analytics/phaseStatisticsTransforms.ts`
- Create: `src/app/components/analytics/phaseStatisticsTransforms.test.ts`

- [x] **Step 1: Write failing tests for strength grouping**

Create `src/app/components/analytics/strengthPhaseTransforms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStrengthPhaseSeries } from "./strengthPhaseTransforms";

describe("buildStrengthPhaseSeries", () => {
	it("keeps concentric and eccentric records as separate series", () => {
		const result = buildStrengthPhaseSeries(
			[
				{
					exercise_name: "Bench Press",
					exercise_id: "bench",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 100,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Bench Press",
					exercise_id: "bench",
					record_type: "MAX_WEIGHT",
					workout_phase: "ECCENTRIC",
					value: 130,
					achieved_at: "2026-05-01T00:00:00Z",
				},
			],
			"all",
		);

		expect(result.series.map((s) => s.name)).toEqual([
			"Bench Press Concentric",
			"Bench Press Eccentric",
		]);
		expect(result.points[0]).toMatchObject({
			"bench::Concentric": 100,
			"bench::Eccentric": 130,
		});
	});

	it("filters by selected phase", () => {
		const result = buildStrengthPhaseSeries(
			[
				{
					exercise_name: "Squat",
					exercise_id: "squat",
					record_type: "MAX_WEIGHT",
					workout_phase: "CONCENTRIC",
					value: 140,
					achieved_at: "2026-05-01T00:00:00Z",
				},
				{
					exercise_name: "Squat",
					exercise_id: "squat",
					record_type: "MAX_WEIGHT",
					workout_phase: "ECCENTRIC",
					value: 180,
					achieved_at: "2026-05-01T00:00:00Z",
				},
			],
			"Concentric",
		);

		expect(result.series.map((s) => s.name)).toEqual(["Squat Concentric"]);
	});
});
```

- [x] **Step 2: Implement strength grouping**

Create `src/app/components/analytics/strengthPhaseTransforms.ts` with:

```ts
import {
	type WorkoutPhaseFilter,
	normalizeWorkoutPhase,
} from "@/lib/workout-phases";

export interface StrengthPhaseRecord {
	exercise_name: string;
	exercise_id?: string | null;
	record_type?: string | null;
	workout_phase?: string | null;
	value: number;
	achieved_at: string;
}

export interface StrengthPhaseSeries {
	key: string;
	name: string;
	exerciseName: string;
	phase: string;
	latestValue: number;
}

export function buildStrengthPhaseSeries(
	data: StrengthPhaseRecord[],
	phaseFilter: WorkoutPhaseFilter,
) {
	const filtered = data.filter((item) => {
		const phase = normalizeWorkoutPhase(item.workout_phase);
		return phaseFilter === "all" || phase === phaseFilter;
	});

	const dateSet = new Set<string>();
	const valueBySeries = new Map<string, Map<string, number>>();
	const latestBySeries = new Map<string, StrengthPhaseSeries & { at: number }>();

	for (const item of filtered) {
		const phase = normalizeWorkoutPhase(item.workout_phase);
		const baseKey = item.exercise_id ?? item.exercise_name;
		const key = `${baseKey}::${phase}`;
		const name = `${item.exercise_name} ${phase}`;
		const date = new Date(item.achieved_at).toLocaleDateString("en-US", {
			month: "short",
		});
		dateSet.add(date);
		if (!valueBySeries.has(key)) valueBySeries.set(key, new Map());
		const existing = valueBySeries.get(key)?.get(date) ?? 0;
		if (item.value > existing) valueBySeries.get(key)?.set(date, item.value);
		const at = new Date(item.achieved_at).getTime();
		const latest = latestBySeries.get(key);
		if (!latest || at > latest.at) {
			latestBySeries.set(key, {
				key,
				name,
				exerciseName: item.exercise_name,
				phase,
				latestValue: item.value,
				at,
			});
		}
	}

	const series = Array.from(latestBySeries.values())
		.sort((a, b) => b.latestValue - a.latestValue)
		.slice(0, 6)
		.map(({ at: _at, ...s }) => s);

	const points = Array.from(dateSet).map((date) => {
		const point: Record<string, string | number> = { date };
		for (const s of series) {
			point[s.key] = valueBySeries.get(s.key)?.get(date) ?? 0;
		}
		return point;
	});

	return { points, series };
}
```

- [x] **Step 3: Write failing tests for phase metric transforms**

Create `src/app/components/analytics/phaseStatisticsTransforms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPhaseMetricSummary } from "./phaseStatisticsTransforms";

describe("buildPhaseMetricSummary", () => {
	it("summarizes peak and average kg for both phases", () => {
		const result = buildPhaseMetricSummary([
			{
				concentric_kg_avg: 80,
				concentric_kg_max: 100,
				concentric_vel_avg: 0.5,
				concentric_vel_max: 0.8,
				concentric_watt_avg: 200,
				concentric_watt_max: 300,
				eccentric_kg_avg: 95,
				eccentric_kg_max: 125,
				eccentric_vel_avg: 0.4,
				eccentric_vel_max: 0.7,
				eccentric_watt_avg: 220,
				eccentric_watt_max: 340,
			},
		]);

		expect(result.load).toEqual({
			concentricAvg: 80,
			concentricMax: 100,
			eccentricAvg: 95,
			eccentricMax: 125,
		});
	});
});
```

- [x] **Step 4: Implement phase metric transforms**

Create `src/app/components/analytics/phaseStatisticsTransforms.ts`:

```ts
export interface PhaseStatisticsRow {
	concentric_kg_avg: number | null;
	concentric_kg_max: number | null;
	concentric_vel_avg: number | null;
	concentric_vel_max: number | null;
	concentric_watt_avg: number | null;
	concentric_watt_max: number | null;
	eccentric_kg_avg: number | null;
	eccentric_kg_max: number | null;
	eccentric_vel_avg: number | null;
	eccentric_vel_max: number | null;
	eccentric_watt_avg: number | null;
	eccentric_watt_max: number | null;
}

function avg(values: Array<number | null>): number {
	const clean = values.filter((v): v is number => typeof v === "number");
	return clean.length === 0
		? 0
		: Math.round((clean.reduce((sum, v) => sum + v, 0) / clean.length) * 10) /
				10;
}

function max(values: Array<number | null>): number {
	const clean = values.filter((v): v is number => typeof v === "number");
	return clean.length === 0 ? 0 : Math.max(...clean);
}

export function buildPhaseMetricSummary(rows: PhaseStatisticsRow[]) {
	return {
		load: {
			concentricAvg: avg(rows.map((r) => r.concentric_kg_avg)),
			concentricMax: max(rows.map((r) => r.concentric_kg_max)),
			eccentricAvg: avg(rows.map((r) => r.eccentric_kg_avg)),
			eccentricMax: max(rows.map((r) => r.eccentric_kg_max)),
		},
		velocity: {
			concentricAvg: avg(rows.map((r) => r.concentric_vel_avg)),
			concentricMax: max(rows.map((r) => r.concentric_vel_max)),
			eccentricAvg: avg(rows.map((r) => r.eccentric_vel_avg)),
			eccentricMax: max(rows.map((r) => r.eccentric_vel_max)),
		},
		power: {
			concentricAvg: avg(rows.map((r) => r.concentric_watt_avg)),
			concentricMax: max(rows.map((r) => r.concentric_watt_max)),
			eccentricAvg: avg(rows.map((r) => r.eccentric_watt_avg)),
			eccentricMax: max(rows.map((r) => r.eccentric_watt_max)),
		},
	};
}
```

- [x] **Step 5: Run transform tests**

Run:

```powershell
npm test -- src/app/components/analytics/strengthPhaseTransforms.test.ts src/app/components/analytics/phaseStatisticsTransforms.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/app/components/analytics/strengthPhaseTransforms.ts src/app/components/analytics/strengthPhaseTransforms.test.ts src/app/components/analytics/phaseStatisticsTransforms.ts src/app/components/analytics/phaseStatisticsTransforms.test.ts
git commit -m "feat: add phase analytics transforms"
```

## Task 5: Wire Analytics Page and Visualizations

**Files:**
- Modify: `src/app/components/Analytics.tsx`
- Modify: `src/app/components/analytics/ProgressTab.tsx`
- Modify: `src/app/components/analytics/MobileProgressTab.tsx`

- [x] **Step 1: Add URL-backed phase state**

In `src/app/components/Analytics.tsx`, preserve the `tab` parameter while adding a `phase` parameter:

```ts
const rawPhase = searchParams.get("phase") ?? "all";
const phaseFilter: WorkoutPhaseFilter = WORKOUT_PHASE_FILTERS.includes(
	rawPhase as WorkoutPhaseFilter,
)
	? (rawPhase as WorkoutPhaseFilter)
	: "all";

const setPhaseFilter = (phase: WorkoutPhaseFilter) => {
	const next = new URLSearchParams(searchParams);
	next.set("phase", phase);
	setSearchParams(next);
};
```

- [x] **Step 2: Query phase statistics for the analytics period**

Import and call:

```ts
const { data: phaseStatsRaw } = useQuery(
	phaseStatisticsTrendOptions(userId, queryPeriod, activeProfileId),
);
```

Keep `enabled: !!userId` if the current query call pattern requires it.

- [x] **Step 3: Replace exercise-only strength grouping**

Use `buildStrengthPhaseSeries(strengthRaw ?? [], phaseFilter)` instead of the existing exercise-only `groupStrengthByExercise` for the strength ECharts series.

Keep top-series limiting at six series maximum. This avoids unreadable charts when every exercise has both concentric and eccentric lines.

- [x] **Step 4: Build ECharts series with phase labels**

Map each `StrengthPhaseSeries` to an ECharts line:

```ts
series: strengthPhase.series.map((seriesItem, index) => ({
	name: seriesItem.name,
	type: "line",
	smooth: true,
	symbol: "circle",
	symbolSize: 6,
	lineStyle: { width: 2 },
	itemStyle: { color: PHASE_SERIES_COLORS[index % PHASE_SERIES_COLORS.length] },
	data: strengthPhase.points.map((point) => point[seriesItem.key] ?? 0),
})),
```

- [x] **Step 5: Add phase controls to desktop progress**

In `src/app/components/analytics/ProgressTab.tsx`, add props:

```ts
phaseFilter: WorkoutPhaseFilter;
onPhaseFilterChange: (phase: WorkoutPhaseFilter) => void;
phaseMetricSummary: ReturnType<typeof buildPhaseMetricSummary> | null;
```

Render a compact control above `1RM Progression`:

```tsx
<div className="flex flex-wrap gap-2">
	{WORKOUT_PHASE_FILTERS.map((phase) => (
		<Button
			key={phase}
			type="button"
			variant={phaseFilter === phase ? "default" : "outline"}
			size="sm"
			onClick={() => onPhaseFilterChange(phase)}
		>
			{phase === "all" ? "All Phases" : phase}
		</Button>
	))}
</div>
```

- [x] **Step 6: Add paired phase metric cards**

In `ProgressTab.tsx`, render three paired metric cards when `phaseMetricSummary` exists:

```tsx
<PhaseMetricPair
	label={`Load (${unit})`}
	concentric={phaseMetricSummary.load.concentricAvg}
	eccentric={phaseMetricSummary.load.eccentricAvg}
	peakConcentric={phaseMetricSummary.load.concentricMax}
	peakEccentric={phaseMetricSummary.load.eccentricMax}
/>
<PhaseMetricPair
	label="Velocity"
	concentric={phaseMetricSummary.velocity.concentricAvg}
	eccentric={phaseMetricSummary.velocity.eccentricAvg}
	peakConcentric={phaseMetricSummary.velocity.concentricMax}
	peakEccentric={phaseMetricSummary.velocity.eccentricMax}
/>
<PhaseMetricPair
	label="Power"
	concentric={phaseMetricSummary.power.concentricAvg}
	eccentric={phaseMetricSummary.power.eccentricAvg}
	peakConcentric={phaseMetricSummary.power.concentricMax}
	peakEccentric={phaseMetricSummary.power.eccentricMax}
/>
```

Define `PhaseMetricPair` in the same file using existing `Card` styles and no nested cards.

- [x] **Step 7: Update mobile progress**

In `MobileProgressTab.tsx`, add props:

```ts
phaseFilter: WorkoutPhaseFilter;
onPhaseFilterChange: (phase: WorkoutPhaseFilter) => void;
phaseMetricSummary: ReturnType<typeof buildPhaseMetricSummary> | null;
```

Render:

- Horizontal scroll phase buttons.
- Top lift labels as `Exercise - Phase`.
- One compact paired load card using average and peak load values.

- [x] **Step 8: Run focused component and type checks**

Run:

```powershell
npm test -- src/app/components/analytics/strengthPhaseTransforms.test.ts src/app/components/analytics/phaseStatisticsTransforms.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```powershell
git add src/app/components/Analytics.tsx src/app/components/analytics/ProgressTab.tsx src/app/components/analytics/MobileProgressTab.tsx
git commit -m "feat: display phase-aware analytics"
```

## Task 6: Update Exercise Detail and Aggregate Progress Semantics

**Files:**
- Modify: `src/app/components/analytics/ExerciseDeepDive.tsx`
- Modify: `src/app/components/ExerciseProgress.tsx`
- Test: existing component tests if present; otherwise add pure transform tests only.

- [x] **Step 1: Keep `exercise_progress` aggregate**

Do not add a phase filter to `exerciseProgressOptions`. In `ExerciseProgress.tsx`, label current max weight, volume, and 1RM charts as aggregate/overall data.

- [x] **Step 2: Make ExerciseDeepDive PR counts phase-aware**

In `ExerciseDeepDive.tsx`, count PRs per phase:

```ts
const prCountsByPhase = records
	.filter((r) => r.exercise_name.toLowerCase() === selectedExercise.toLowerCase())
	.reduce(
		(acc, record) => {
			const phase = normalizeWorkoutPhase(record.workout_phase);
			acc[phase] += 1;
			return acc;
		},
		{ Combined: 0, Concentric: 0, Eccentric: 0 },
	);
```

Apply the existing time-range cutoff before the reducer.

- [x] **Step 3: Add phase badges in ExerciseDeepDive PR summary**

Render only non-zero phase counts:

```tsx
{WORKOUT_PHASES.map((phase) =>
	prCountsByPhase[phase] > 0 ? (
		<Badge key={phase} variant="outline">
			{phase}: {prCountsByPhase[phase]}
		</Badge>
	) : null,
)}
```

- [x] **Step 4: Verify no false phase-specific 1RM claim**

Search the changed files:

```powershell
rg -n "phase|concentric|eccentric|1RM|overall|aggregate" src/app/components/ExerciseProgress.tsx src/app/components/analytics/ExerciseDeepDive.tsx
```

Expected: phase-specific labels appear only for personal records, not `exercise_progress` 1RM lines.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/app/components/analytics/ExerciseDeepDive.tsx src/app/components/ExerciseProgress.tsx
git commit -m "feat: clarify phase semantics in exercise progress"
```

## Task 7: Update Secondary Analytics Consumers

**Files:**
- Modify: `src/app/components/SummaryReport.tsx`
- Modify: `src/app/components/Goals.tsx`
- Modify: `src/queries/challenges.ts`
- Modify: `supabase/functions/compute-rankings/index.ts`
- Modify: `supabase/functions/generate-insights/index.ts`
- Modify: `src/lib/export/csv.ts`

- [x] **Step 1: SummaryReport aggregate PR semantics**

`SummaryReport.tsx` derives records from aggregate `exercise_progress`, not
`personal_records`, so this implementation labels those values as overall
progress records and keeps volume and exercise progress aggregate.

- [x] **Step 2: Goals semantic decision**

Keep existing goal progress combined unless the goal schema includes phase. Add a comment at the PR goal branch:

```ts
// Goal rows do not currently carry workout_phase, so PR goals intentionally
// count all phases. Add a goal phase column before offering phase-specific goals.
```

- [x] **Step 3: Challenges semantic decision**

For `pr_count` challenges, keep `COUNT(*)`. Add a focused test that creates combined/concentric/eccentric records for the same exercise and expects `3`.

Rejected alternative: counting one PR per exercise/record type regardless of phase. That would use this distinct key count, but it conflicts with the current sync identity and official-app metric model:

```ts
new Set(records.map((r) => `${r.exercise_id ?? r.exercise_name}:${r.record_type}`)).size
```

Use the selected interpretation consistently in `src/queries/challenges.ts`, `supabase/functions/compute-rankings/index.ts`, and any follow-up migration touching `get_pr_count_rankings`.

- [x] **Step 4: Rankings semantic decision**

Keep leaderboard `COUNT(*)` and update labels/help text to make clear that phase-specific PRs are included.

Do not edit already-pushed migrations.

- [x] **Step 5: Insights include phase labels**

In `generate-insights`, select `workout_phase` with recent PRs and emit text such as:

```ts
`${exerciseName} ${formatWorkoutPhase(workoutPhase)} PR: ${value}`
```

Use the edge-function local helper equivalent because browser imports are not available in Supabase functions.

- [x] **Step 6: Export verification**

`src/lib/export/csv.ts` already includes `Workout Phase`. Add or keep a test row with `workout_phase: "Concentric"` and assert the exported column is `Concentric`.

- [x] **Step 7: Run targeted tests**

Run:

```powershell
npm test -- src/lib/export/csv.test.ts src/queries/__tests__/analytics.test.ts
npm run test:sync
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/app/components/SummaryReport.tsx src/app/components/Goals.tsx src/queries/challenges.ts supabase/functions/compute-rankings/index.ts supabase/functions/generate-insights/index.ts src/lib/export/csv.ts
git commit -m "feat: apply phase semantics to analytics consumers"
```

## Task 8: Document Exercise-Level Phase Progress Scope

**Files:**
- Review: `supabase/functions/_shared/pushPayloadSchema.ts`
- Review: `supabase/functions/mobile-sync-push/index.ts`
- Review: `supabase/migrations/20260319120000_mobile_portal_parity.sql`
- Possible create: `supabase/migrations/<timestamp>_exercise_phase_progress.sql`

- [x] **Step 1: Confirm product need**

Use this exact decision rule:

```text
If the requested feature is "show phase-specific PRs and session phase metrics", current schema is enough.
If the requested feature is "show phase-specific exercise 1RM/volume trends for every exercise", current schema is not enough.
```

- [x] **Step 2: Document no migration for this implementation**

Add a note to this plan and final handoff:

```text
No migration added in this implementation. Exercise progress remains aggregate because phase-specific exercise progress is not persisted today.
```

- [ ] **Step 3: Prepare the follow-up migration only if exercise-level phase progress becomes in-scope**

Create a new migration with this shape:

```sql
CREATE TABLE IF NOT EXISTS public.exercise_phase_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_profile_id TEXT,
  session_id UUID NOT NULL REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
  exercise_id TEXT,
  exercise_name TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  workout_phase TEXT NOT NULL CHECK (workout_phase IN ('CONCENTRIC', 'ECCENTRIC')),
  avg_weight_kg NUMERIC NOT NULL DEFAULT 0,
  max_weight_kg NUMERIC NOT NULL DEFAULT 0,
  avg_velocity_mps NUMERIC NOT NULL DEFAULT 0,
  max_velocity_mps NUMERIC NOT NULL DEFAULT 0,
  avg_power_w NUMERIC NOT NULL DEFAULT 0,
  max_power_w NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, exercise_id, workout_phase)
);

ALTER TABLE public.exercise_phase_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own exercise phase progress"
  ON public.exercise_phase_progress
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_exercise_phase_progress_user_exercise
  ON public.exercise_phase_progress(user_id, exercise_name, recorded_at DESC);
```

- [x] **Step 4: Only expand sync payload if mobile can send exercise-level phase rows**

Do not infer exercise-level rows in the portal from session-level stats. The official app stores workout-level stats, but the portal payload currently accepts only `sessionId` in `phaseStatistics`.

## Task 9: Final Verification

**Files:**
- Validate all changed files.

- [x] **Step 1: Run focused tests**

Run:

```powershell
npm test -- src/lib/__tests__/workout-phases.test.ts src/app/components/analytics/strengthPhaseTransforms.test.ts src/app/components/analytics/phaseStatisticsTransforms.test.ts src/queries/__tests__/analytics.test.ts
```

Expected: PASS.

- [x] **Step 2: Run sync tests**

Run:

```powershell
npm run test:sync
```

Expected: PASS.

- [x] **Step 3: Run typecheck and lint**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: PASS.

- [x] **Step 4: Run full verification**

Run:

```powershell
npm run verify:full
```

Expected: PASS.

- [x] **Step 5: Rendered smoke check**

Start the dev server:

```powershell
npm run dev
```

Open the analytics page and verify:

- Desktop Progress tab shows phase controls.
- Strength chart separates concentric and eccentric series.
- Phase metric cards show concentric/eccentric average and peak values.
- Mobile Progress tab shows readable phase controls and paired phase metric card.
- Records tab behavior is unchanged except shared helper usage.
- No component claims `exercise_progress` is phase-specific.

- [ ] **Step 6: Final commit**

Run:

```powershell
git status --short
git add .
git commit -m "feat: support phase-aware analytics"
```

Use `git add .` only after `git status --short` confirms all changed files belong to this plan.
