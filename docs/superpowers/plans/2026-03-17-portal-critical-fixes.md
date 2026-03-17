# Portal Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 critical portal issues across unit conversion, routines, analytics, community, settings, and challenges.

**Architecture:** Five implementation waves ordered by dependency: quick wins first, then unit conversion (foundational), routines (largest scope), analytics consolidation, and cycles verification. Each wave produces independently testable improvements.

**Tech Stack:** React 19, TypeScript, TanStack Query 5, Zustand 5, Supabase (PostgreSQL + Edge Functions), Tailwind CSS v4, shadcn/ui, Recharts 3, @visx, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-03-17-portal-critical-fixes-design.md`

---

## Wave 1: Quick Wins (Issues 6, 7, 8)

### Task 1: Fix Community 400 Error — PostgREST Query

**Files:**
- Modify: `src/queries/community.ts:47`
- Test: `src/queries/__tests__/community.test.ts` (create)

The `.select("*, profiles(display_name, avatar_url)")` fails because `shared_routines.user_id` FKs to `auth.users(id)`, not `profiles(id)`. PostgREST can't resolve the indirect relationship. Fix by using a PostgREST relationship hint or splitting into a two-step query.

- [ ] **Step 1: Read the current community query to understand the full context**

Read `src/queries/community.ts` in full.

- [ ] **Step 2: Write a test for the community feed query**

Create `src/queries/__tests__/community.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("communityFeedOptions", () => {
  it("should construct a valid query with profiles join", () => {
    // Verify the query options are constructed without errors
    // and include the correct select syntax
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/queries/__tests__/community.test.ts`

- [ ] **Step 4: Fix the select query in community.ts**

At line 47, change the `.select()` call. Two approaches in priority order:

**Approach A — FK hint syntax (use the full constraint name):**
```typescript
.select("*, profiles!shared_routines_user_id_fkey(display_name, avatar_url)")
```

**Approach B — If hint doesn't resolve, use a separate profiles lookup:**
```typescript
.select("*")
// Then fetch profiles separately by user_ids from the result
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/queries/__tests__/community.test.ts`

- [ ] **Step 6: Add empty state to Community component**

Read `src/app/components/Community.tsx`. The existing empty states at lines 218-224 (mobile) and 357-368 (desktop) show "No {routines/cycles} found" with a Search icon. These may already be sufficient — verify whether the 400 error was masking them. If the empty states are adequate after the query fix, skip this step.

If they need improvement, update to show a more helpful message when tables are genuinely empty (no search active): "No shared routines yet. Be the first to share a routine with the community!"

- [ ] **Step 7: Commit**

```bash
git add src/queries/community.ts src/queries/__tests__/community.test.ts src/app/components/Community.tsx
git commit -m "fix: resolve community 400 error from PostgREST profiles join"
```

---

### Task 2: Rename Settings → Integrations in Navigation

**Files:**
- Modify: `src/app/components/AppSidebar.tsx:83,297`
- Modify: `src/app/components/MobileBottomNav.tsx:55`

- [ ] **Step 1: Read AppSidebar.tsx to confirm all "Settings" locations**

Read `src/app/components/AppSidebar.tsx`. Confirm occurrences at lines 83 and 297.

- [ ] **Step 2: Rename in AppSidebar.tsx navGroups array (line ~83)**

Change `label: "Settings"` to `label: "Integrations"` in the navGroups entry for path `/integrations`.

- [ ] **Step 3: Rename in AppSidebar.tsx dropdown menu (line ~297)**

Change the "Settings" label in the `DropdownMenuItem` that links to `/integrations`.

- [ ] **Step 4: Rename in MobileBottomNav.tsx (line ~55)**

Read `src/app/components/MobileBottomNav.tsx`. Change `label: "Settings"` to `label: "Integrations"` in the moreGroups entry.

- [ ] **Step 5: Verify no other "Settings" labels reference /integrations**

Search for other occurrences: `grep -r "Settings" src/app/components/ --include="*.tsx" | grep -i integrat`

- [ ] **Step 6: Run existing tests**

Run: `npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add src/app/components/AppSidebar.tsx src/app/components/MobileBottomNav.tsx
git commit -m "fix: rename Settings tab to Integrations in sidebar and mobile nav"
```

---

### Task 3: Wire Dashboard Active Challenges

**Files:**
- Modify: `src/app/components/Dashboard.tsx:1111-1133`
- Reference: `src/queries/challenges.ts` (userChallengesOptions)

- [ ] **Step 1: Read the current challenges placeholder in Dashboard.tsx**

Read `src/app/components/Dashboard.tsx` lines 1100-1140.

- [ ] **Step 2: Read the challenges query to understand the data shape**

Read `src/queries/challenges.ts`. The `userChallengesOptions(userId)` returns `UserChallenge[]` where each has a nested `challenges` property with the full Challenge object.

- [ ] **Step 3: Add imports for challenge query**

Add to Dashboard.tsx imports:
```typescript
import { useQuery } from "@tanstack/react-query";
import { userChallengesOptions } from "@/queries/challenges";
```

Check if `useQuery` is already imported — if so, just add the challenges import.

- [ ] **Step 4: Replace the hardcoded placeholder with a live query**

At lines 1111-1133, replace the hardcoded "No active challenges yet" block with:

```tsx
{/* Active Challenges */}
<motion.div variants={fadeUp}>
  <Card className="p-6 card-secondary">
    <h3 className="text-xl text-white mb-4">Active Challenges</h3>
    <ActiveChallengesSection userId={user.id} />
  </Card>
</motion.div>
```

Create an `ActiveChallengesSection` component (inline or extracted) that:
1. Calls `useQuery(userChallengesOptions(userId))`
2. If loading: show skeleton
3. If empty: show CTA "Browse Challenges" linking to `/challenges`
4. If has data: show each challenge with name, progress, time remaining
5. For progress, check if `challengeProgressOptions` exists in queries/challenges.ts — if so, use it

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run src/app/components/__tests__/Dashboard.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/app/components/Dashboard.tsx
git commit -m "feat: display joined challenges on dashboard instead of placeholder"
```

---

### Task 4: Update CLAUDE.md Project Description

**Files:**
- Modify: `CLAUDE.md:7`

- [ ] **Step 1: Update the project overview**

At line 7, change:
```
This is a **view-only companion app** -- all workout control happens in the mobile app.
```
To:
```
It supports both viewing synced data and creating routines/cycles that sync back to the mobile app.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect portal is not view-only"
```

---

## Wave 2: Unit Conversion (Issue 1)

### Task 5: Create Unit Conversion Utility

**Files:**
- Create: `src/lib/units.ts`
- Create: `src/lib/__tests__/units.test.ts`

- [ ] **Step 1: Write failing tests for conversion functions**

Create `src/lib/__tests__/units.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { convertWeight, formatWeight, toKg, formatVolume } from "../units";

describe("units", () => {
  describe("convertWeight", () => {
    it("returns kg value unchanged when unit is kg", () => {
      expect(convertWeight(100, "kg")).toBe(100);
    });
    it("converts kg to lbs", () => {
      expect(convertWeight(100, "lbs")).toBeCloseTo(220.462, 1);
    });
    it("handles zero", () => {
      expect(convertWeight(0, "lbs")).toBe(0);
    });
    it("handles null/undefined gracefully", () => {
      expect(convertWeight(null as unknown as number, "lbs")).toBe(0);
    });
  });

  describe("formatWeight", () => {
    it("formats kg as whole number with unit", () => {
      expect(formatWeight(100, "kg")).toBe("100 kg");
    });
    it("formats lbs with 1 decimal", () => {
      expect(formatWeight(100, "lbs")).toBe("220.5 lbs");
    });
    it("handles zero", () => {
      expect(formatWeight(0, "kg")).toBe("0 kg");
    });
  });

  describe("toKg", () => {
    it("converts lbs to kg", () => {
      expect(toKg(220.462)).toBeCloseTo(100, 0);
    });
  });

  describe("formatVolume", () => {
    it("formats large volumes with K suffix", () => {
      expect(formatVolume(2300, "kg")).toBe("2.3K kg");
    });
    it("formats small volumes without suffix", () => {
      expect(formatVolume(500, "kg")).toBe("500 kg");
    });
    it("formats lbs volumes", () => {
      expect(formatVolume(1000, "lbs")).toMatch(/lbs$/);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/units.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement units.ts**

Create `src/lib/units.ts`:

```typescript
export const KG_TO_LBS = 2.20462;

export type WeightUnit = "kg" | "lbs";

export function convertWeight(valueKg: number, unit: WeightUnit): number {
  if (valueKg == null) return 0;
  return unit === "lbs" ? valueKg * KG_TO_LBS : valueKg;
}

export function formatWeight(valueKg: number, unit: WeightUnit): string {
  const converted = convertWeight(valueKg, unit);
  if (unit === "lbs") {
    return `${converted.toFixed(1)} lbs`;
  }
  return `${Math.round(converted)} kg`;
}

export function toKg(valueLbs: number): number {
  return valueLbs / KG_TO_LBS;
}

export function formatVolume(valueKg: number, unit: WeightUnit): string {
  const converted = convertWeight(valueKg, unit);
  if (converted >= 1000) {
    return `${(converted / 1000).toFixed(1)}K ${unit}`;
  }
  return `${Math.round(converted)} ${unit}`;
}

export function getUnitLabel(unit: WeightUnit): string {
  return unit;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/units.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/units.ts src/lib/__tests__/units.test.ts
git commit -m "feat: add unit conversion utility (kg/lbs)"
```

---

### Task 6: Apply Unit Conversion to SessionDetail

**Files:**
- Modify: `src/app/components/SessionDetail.tsx:184,289,418`
- Reference: `src/queries/profile.ts` (profileOptions)

- [ ] **Step 1: Read SessionDetail.tsx to understand the component structure**

Read `src/app/components/SessionDetail.tsx` lines 1-50 (imports, hooks) and lines 175-200, 280-300, 410-425 (the hardcoded kg locations).

- [ ] **Step 2: Add imports and unit resolution**

Add to imports:
```typescript
import { formatWeight, formatVolume } from "@/lib/units";
import type { WeightUnit } from "@/lib/units";
```

Add near the top of the component (where other queries are called):
```typescript
const { data: profile } = useQuery(profileOptions(user.id));
const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";
```

Check if `profileOptions` is already imported/used — if so, reuse that query result.

- [ ] **Step 3: Replace hardcoded kg at line 184**

Change: `{session.total_volume.toLocaleString()} kg`
To: `{formatVolume(session.total_volume, unit)}`

- [ ] **Step 4: Replace hardcoded kg at line 289**

Change: `{session.total_volume.toLocaleString()} kg`
To: `{formatVolume(session.total_volume, unit)}`

- [ ] **Step 5: Replace hardcoded kg at line 418**

Change: `{set.weight_kg} kg`
To: `{formatWeight(set.weight_kg, unit)}`

- [ ] **Step 6: Run tests**

Run: `npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add src/app/components/SessionDetail.tsx
git commit -m "feat: apply unit conversion to SessionDetail"
```

---

### Task 7: Apply Unit Conversion to WorkoutHistory

**Files:**
- Modify: `src/app/components/WorkoutHistory.tsx:787,984`

- [ ] **Step 1: Read WorkoutHistory.tsx for context**

Read lines 780-800 and 975-995.

- [ ] **Step 2: Add imports and unit resolution**

Same pattern as Task 6: import `formatVolume` from `@/lib/units`, get unit from profile query.

- [ ] **Step 3: Replace hardcoded kg at lines 787 and 984**

Change both: `{workout.total_volume.toLocaleString()} kg`
To: `{formatVolume(workout.total_volume, unit)}`

- [ ] **Step 4: Run tests and commit**

```bash
git add src/app/components/WorkoutHistory.tsx
git commit -m "feat: apply unit conversion to WorkoutHistory"
```

---

### Task 8: Apply Unit Conversion to ExerciseProgress

**Files:**
- Modify: `src/app/components/ExerciseProgress.tsx:292,298,304,361,430,496`

- [ ] **Step 1: Read ExerciseProgress.tsx for context**

Read lines 285-310 (StatCards) and 355-370, 425-440, 490-500 (chart labels).

- [ ] **Step 2: Add imports and unit resolution**

Import `formatWeight`, `convertWeight`, `getUnitLabel` from `@/lib/units`. Get unit from profile query.

- [ ] **Step 3: Update StatCard units at lines 292, 298, 304**

Change `unit="kg"` to `unit={unit}` in all three StatCard instances. Also convert the values: wrap with `convertWeight(value, unit)`.

- [ ] **Step 4: Update chart axis labels at lines 361, 430, 496**

Change:
- `name="Max Weight (kg)"` → `name={\`Max Weight (${unit})\`}`
- `name="Volume (kg)"` → `name={\`Volume (${unit})\`}`
- `name="Est. 1RM (kg)"` → `name={\`Est. 1RM (${unit})\`}`

Also update chart data points to use converted values.

- [ ] **Step 5: Run tests and commit**

```bash
git add src/app/components/ExerciseProgress.tsx
git commit -m "feat: apply unit conversion to ExerciseProgress charts"
```

---

### Task 9: Apply Unit Conversion to Dashboard + Analytics + Profile + CSV Export

**Files:**
- Modify: `src/app/components/Dashboard.tsx:598,891,1038`
- Modify: `src/app/components/Analytics.tsx:500`
- Modify: `src/app/components/Profile.tsx:184,847-854`
- Modify: `src/lib/export/csv.ts:18`

- [ ] **Step 1: Update Dashboard.tsx**

Read lines 590-600, 885-895, 1030-1045. Replace:
- Line 598: `{Math.round(weeklyTotal).toLocaleString()} kg` → use `formatVolume`
- Line 891: `{weeklyTotal.toLocaleString()} kg` → use `formatVolume`
- Line 1038: `{(weeklyTotal / 1000).toFixed(1)}k kg` → use `formatVolume`

- [ ] **Step 2: Update Analytics.tsx**

Read line 500. Change `"Week,Volume (kg)"` to use the user's unit preference.

- [ ] **Step 3: Update Profile.tsx**

Read lines 180-190 and 845-860.
- Remove the TODO comment and "coming soon" text at lines 847-854
- Update volume display to use `formatVolume`
- Keep the weight unit toggle buttons as-is (they already work for saving the preference)

- [ ] **Step 4: Update csv.ts**

Read `src/lib/export/csv.ts`. At line 18, change `"Total Volume (kg)"` to accept a unit parameter. The export function will need to accept the user's unit preference and convert values accordingly.

- [ ] **Step 5: Update Analytics CSV row values (not just header)**

At line 500, the CSV header `"Week,Volume (kg)"` needs the unit label. But also update the row data generation to convert volume values using `convertWeight()` — the header alone is not sufficient.

- [ ] **Step 6: Verify PersonalRecords.tsx**

Read `src/app/components/PersonalRecords.tsx`. It uses `{pr.value} {pr.unit}` which comes from the database schema. **Verify** that the `unit` field in `personal_records` already stores the correct unit string (e.g., "kg" or "lbs"). If the DB stores all values in kg with `unit: "kg"` hardcoded, then PersonalRecords needs conversion. If the DB dynamically stores the unit per record, it may already be correct. Document what you find.

- [ ] **Step 7: Normalize RoutineBuilder.tsx weight unit logic**

Read `src/app/components/RoutineBuilder.tsx` line 67: `const weightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg"`. Replace this local logic with imports from `units.ts`:
```typescript
import { formatWeight, type WeightUnit } from "@/lib/units";
const unit: WeightUnit = profile?.weight_unit === "lbs" ? "lbs" : "kg";
```
Then use `formatWeight()` where weight values are displayed instead of manual string interpolation.

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run`

- [ ] **Step 9: Commit**

```bash
git add src/app/components/Dashboard.tsx src/app/components/Analytics.tsx src/app/components/Profile.tsx src/lib/export/csv.ts src/app/components/PersonalRecords.tsx src/app/components/RoutineBuilder.tsx
git commit -m "feat: apply unit conversion to Dashboard, Analytics, Profile, CSV, PersonalRecords"
```

---

## Wave 3: Routines (Issues 2, 3)

### Task 10: Add Routine View Mode

**Files:**
- Create: `src/app/components/RoutineDetail.tsx`
- Modify: `src/app/components/RoutinesEnhanced.tsx:326-332`
- Modify: `src/app/routes/index.tsx` (add route)

- [ ] **Step 1: Read RoutinesEnhanced.tsx for the View button context**

Read lines 315-340.

- [ ] **Step 2: Create RoutineDetail.tsx**

Create `src/app/components/RoutineDetail.tsx` — a read-only view of a routine:

```typescript
// Structure:
// - Fetch routine via routineDetailOptions(routineId)
// - Get user's weight unit from profile query
// - Display: name, description, exercise count, estimated duration, last used
// - Exercise list: name, muscle group badge, sets × reps × weight (formatted), rest, training mode
// - Superset groupings with colored left border
// - Advanced settings as badges (AMRAP, Bodyweight, Eccentric, etc.)
// - "Edit Routine" button → navigate to /routines/:id
// - Responsive: stack on mobile, side-by-side on desktop
```

Use existing shadcn/ui components: `Card`, `Badge`, `Button`, `Separator`.
Reference `src/queries/routines.ts` for `routineDetailOptions`.

- [ ] **Step 3: Add route for RoutineDetail**

Read `src/app/routes/index.tsx` lines 59-70 and 160-170.

Add lazy import:
```typescript
const RoutineDetail = lazy(() =>
  import("@/app/components/RoutineDetail").then((m) => ({
    default: m.RoutineDetail,
  })),
);
```

Add route **inside the FLAME tier `<SubscribedRoute>` group** (between lines 161-181 in routes/index.tsx, alongside other routine routes):
```tsx
<Route path="/routines/:routineId/view" element={<RoutineDetail />} />
```

**Important:** Do NOT place this as a top-level route — it must be inside the FLAME-gated group.

- [ ] **Step 4: Fix View button onClick in RoutinesEnhanced.tsx**

At lines 326-332, add the onClick handler:
```tsx
<Button
  size="sm"
  className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
  onClick={() => navigate(`/routines/${routine.id}/view`)}
>
  <Eye className="w-4 h-4 mr-1" />
  View
</Button>
```

Ensure `useNavigate` is imported from `react-router`.

- [ ] **Step 5: Write a basic render test for RoutineDetail**

Create `src/app/components/__tests__/RoutineDetail.test.tsx`:
- Test that component renders with mocked routine data (mock `routineDetailOptions` query)
- Test that exercises display with correct unit conversion
- Test that "Edit" button links to `/routines/:id`
- Test loading and error states

- [ ] **Step 6: Run tests and commit**

```bash
git add src/app/components/RoutineDetail.tsx src/app/components/__tests__/RoutineDetail.test.tsx src/app/components/RoutinesEnhanced.tsx src/app/routes/index.tsx
git commit -m "feat: add routine view mode with read-only detail page"
```

---

### Task 11: Database Migration for Bodyweight + Duration Columns

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_add_bodyweight_duration_columns.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Add bodyweight and duration exercise type support
ALTER TABLE routine_exercises
  ADD COLUMN IF NOT EXISTS is_bodyweight BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

COMMENT ON COLUMN routine_exercises.is_bodyweight IS 'When true, exercise uses bodyweight only (no external load)';
COMMENT ON COLUMN routine_exercises.duration_seconds IS 'For duration-based exercises; NULL means rep-based';
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db push` or apply via Supabase dashboard.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `npm run gen:types`

- [ ] **Step 4: Check for Zod schemas that need updating**

Search `src/schemas/` for any routine-related Zod schemas (grep for "routine" or "exercise"). The `RoutineExerciseInput` in `src/mutations/routines.ts` is a plain TypeScript interface (not Zod-validated), so only update Zod schemas if they exist. If no routine Zod schemas are found, skip this step.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/lib/database.types.ts
git commit -m "feat: add is_bodyweight and duration_seconds columns to routine_exercises"
```

---

### Task 12: Fix Routine Builder Labels + Update Types

**Files:**
- Modify: `src/app/components/RoutineBuilder.tsx` (ExerciseDetailPanel inputs)
- Modify: `src/mutations/routines.ts:7-28` (RoutineExerciseInput type)

- [ ] **Step 1: Read RoutineBuilder.tsx ExerciseDetailPanel section**

Read `src/app/components/RoutineBuilder.tsx` lines 520-660 (the ExerciseDetailPanel).

- [ ] **Step 2: Add labels to the input fields**

Find the placeholder-only inputs (Reps, Weight, Rest). Add `<Label>` elements:

```tsx
<div className="space-y-1">
  <Label htmlFor="reps-input" className="text-xs text-muted-foreground">Reps</Label>
  <Input id="reps-input" placeholder="10" ... />
</div>
```

Repeat for Weight (showing unit label from profile) and Rest (showing "seconds").

- [ ] **Step 3: Update RoutineExerciseInput type**

In `src/mutations/routines.ts`, add to `RoutineExerciseInput`:
```typescript
is_bodyweight?: boolean;
duration_seconds?: number | null;
```

- [ ] **Step 4: Update the Exercise interface in RoutineBuilder.tsx**

In `src/app/components/RoutineBuilder.tsx` (lines 39-60), add:
```typescript
isBodyweight: boolean;
durationSeconds: number | null;
```

- [ ] **Step 5: Update the exercise payload builder**

In the payload mapping (lines 132-154), include the new fields:
```typescript
is_bodyweight: ex.isBodyweight,
duration_seconds: ex.durationSeconds,
```

- [ ] **Step 6: Run tests and commit**

```bash
git add src/app/components/RoutineBuilder.tsx src/mutations/routines.ts
git commit -m "fix: add labels to routine builder inputs, add bodyweight/duration types"
```

---

### Task 13: Add Exercise Type Toggles (Bodyweight, Duration, AMRAP)

**Files:**
- Modify: `src/app/components/RoutineBuilder.tsx` (ExerciseDetailPanel)

- [ ] **Step 1: Add Bodyweight toggle**

In ExerciseDetailPanel, add a Switch component:
```tsx
<div className="flex items-center justify-between">
  <Label className="text-sm text-white">Bodyweight</Label>
  <Switch
    checked={exercise.isBodyweight}
    onCheckedChange={(checked) => updateExercise({ isBodyweight: checked, weight: checked ? 0 : exercise.weight })}
  />
</div>
```

When bodyweight is on, hide the weight input field.

- [ ] **Step 2: Add Duration toggle**

Add a segmented control or toggle:
```tsx
<div className="flex items-center justify-between">
  <Label className="text-sm text-white">Type</Label>
  <div className="flex gap-1">
    <Button size="sm" variant={!exercise.durationSeconds ? "default" : "outline"} onClick={() => updateExercise({ durationSeconds: null })}>Reps</Button>
    <Button size="sm" variant={exercise.durationSeconds ? "default" : "outline"} onClick={() => updateExercise({ durationSeconds: exercise.durationSeconds || 30 })}>Duration</Button>
  </div>
</div>
```

When duration mode is active, replace the Reps input with a Duration input (seconds).

- [ ] **Step 3: Add AMRAP toggle**

```tsx
<div className="flex items-center justify-between">
  <Label className="text-sm text-white">AMRAP</Label>
  <Switch
    checked={exercise.isAmrap}
    onCheckedChange={(checked) => updateExercise({ isAmrap: checked })}
  />
</div>
```

When AMRAP is on, hide the rep count and show an "AMRAP" badge on the exercise card.

- [ ] **Step 4: Run tests and commit**

```bash
git add src/app/components/RoutineBuilder.tsx
git commit -m "feat: add bodyweight, duration, and AMRAP toggles to routine builder"
```

---

### Task 14: Add Advanced Settings Panel

**Files:**
- Modify: `src/app/components/RoutineBuilder.tsx` (ExerciseDetailPanel)

- [ ] **Step 1: Add collapsible Advanced Settings section**

Below the main exercise settings, add:

```tsx
<Collapsible>
  <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm text-muted-foreground hover:text-white">
    Advanced Settings
    <ChevronDown className="w-4 h-4" />
  </CollapsibleTrigger>
  <CollapsibleContent className="space-y-4 pt-2">
    {/* Per-set weight/rest */}
    {/* Stall detection toggle */}
    {/* Eccentric load dropdown */}
    {/* Echo level dropdown */}
    {/* Rep count timing */}
    {/* Stop at position */}
  </CollapsibleContent>
</Collapsible>
```

- [ ] **Step 2: Read the JSONB data shape for per-set overrides**

Read the `perSetWeights` and `perSetRest` fields in the Exercise interface. Check how they're stored in the DB (`per_set_weights`, `per_set_rest` JSONB columns). Determine the expected shape (e.g., `Record<number, number>` mapping set index to value).

- [ ] **Step 3: Build per-row editable weight fields in the sets grid**

Make each row in the sets grid independently editable for weight. When user edits a per-set weight, update the `perSetWeights` JSONB object.

- [ ] **Step 4: Build per-row editable rest fields in the sets grid**

Same pattern for rest values — each set row gets an editable rest field, stored in `perSetRest`.

- [ ] **Step 5: Add "all same value" collapse logic**

If all per-set values are identical, show the shared value in the main weight/rest input. When the main input changes, propagate to all sets.

- [ ] **Step 6: Add stall detection toggle**

```tsx
<div className="flex items-center justify-between">
  <Label className="text-sm text-white">Stall Detection</Label>
  <Switch checked={exercise.stallDetection} onCheckedChange={(v) => updateExercise({ stallDetection: v })} />
</div>
```

- [ ] **Step 7: Add eccentric load dropdown**

```tsx
<div className="space-y-1">
  <Label className="text-xs text-muted-foreground">Eccentric Load</Label>
  <Select value={exercise.eccentricLoad ?? ""} onValueChange={(v) => updateExercise({ eccentricLoad: v || null })}>
    {/* Options based on available load profiles */}
  </Select>
</div>
```

- [ ] **Step 8: Add echo level, rep count timing, and stop at position inputs**

- **Echo level:** `<Select>` dropdown with intensity level options
- **Rep count timing:** `<Input>` for timing configuration value
- **Stop at position:** `<Input>` for position value

Each maps directly to an existing field in the Exercise interface.

- [ ] **Step 4: Run tests and commit**

```bash
git add src/app/components/RoutineBuilder.tsx
git commit -m "feat: add advanced settings panel with per-set editing and machine controls"
```

---

### Task 15: Integrate Superset Support

**Files:**
- Modify: `src/app/components/RoutineBuilder.tsx`
- Reference: `src/app/components/routine-builder/SupersetContainer.tsx`
- Reference: `src/app/components/routine-builder/SelectionModeBar.tsx`
- Reference: `src/app/components/routine-builder/ExerciseCard.tsx`

The superset subcomponents are **fully implemented** (SupersetContainer: 247 lines, SelectionModeBar: 67 lines, ExerciseCard: 120 lines). They need to be wired into the main RoutineBuilder.

- [ ] **Step 1: Read the superset components**

Read all files in `src/app/components/routine-builder/` to understand their props and expected integration points.

- [ ] **Step 2: Add selection mode state to RoutineBuilder**

Add state for multi-select:
```typescript
const [isSelectionMode, setIsSelectionMode] = useState(false);
const [selectedExerciseIds, setSelectedExerciseIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Add selection mode state to RoutineBuilder**

Add state variables and toggle handlers:
```typescript
const [isSelectionMode, setIsSelectionMode] = useState(false);
const [selectedExerciseIds, setSelectedExerciseIds] = useState<Set<string>>(new Set());
const toggleSelect = (id: string) => { /* toggle id in set */ };
```

- [ ] **Step 4: Replace inline exercise rendering with ExerciseCard**

In the exercise list, replace the current inline rendering with the `ExerciseCard` component. Pass: `exercise`, `onEdit`, `onRemove`, `isDragging`, `isSelectionMode`, `isSelected`, `onToggleSelect`.

- [ ] **Step 5: Add exercise grouping logic**

Before rendering, partition exercises into groups: ungrouped exercises (no `supersetId`) and superset groups (grouped by `supersetId`). Render in order.

- [ ] **Step 6: Wrap grouped exercises in SupersetContainer**

For each superset group, render inside `SupersetContainer`. Pass: `superset` metadata, `exercises`, `onUpdateTransitionTime`, `onUpdateRestAfter`, `onUngroup`, `onRemoveExercise`, `onEditExercise`.

- [ ] **Step 7: Add SelectionModeBar**

Render `SelectionModeBar` at the bottom of the exercise list. It shows when 2+ exercises are selected and provides the "Create Superset" action.

- [ ] **Step 8: Implement superset creation logic**

When "Create Superset" is clicked:
1. Generate a unique `supersetId` (use `crypto.randomUUID()`)
2. Assign a color from a predefined palette (cycle through superset colors)
3. Update all selected exercises with the `supersetId`, `supersetColor`, and `supersetOrder`
4. Exit selection mode

- [ ] **Step 9: Implement ungroup logic**

When "Ungroup" is clicked on a SupersetContainer:
1. Clear `supersetId`, `supersetColor`, `supersetOrder` from all exercises in the group
2. Exercises become ungrouped individual cards

- [ ] **Step 7: Run tests and commit**

```bash
git add src/app/components/RoutineBuilder.tsx
git commit -m "feat: integrate superset support into routine builder"
```

---

## Wave 4: Analytics Hub Consolidation (Issue 4)

### Task 16: Add Aggregate Analytics Queries

**Files:**
- Modify: `src/queries/analytics.ts`
- Create: `src/queries/__tests__/analytics-aggregate.test.ts`

**Prerequisite:** Wave 2 must be complete (units.ts needed for chart formatting).

- [ ] **Step 1: Read existing analytics queries**

Read `src/queries/analytics.ts` in full (lines 1-88).

- [ ] **Step 2: Read rep_summaries table schema**

Check `src/lib/database.types.ts` for the `rep_summaries` type definition to understand available columns.

- [ ] **Step 3: Add aggregate query functions**

Add to `src/queries/analytics.ts`:

```typescript
export function romTrendOptions(userId: string, period: string) {
  return queryOptions({
    queryKey: [...queryKeys.analytics.all, "rom-trend", userId, period],
    queryFn: async () => {
      // Join rep_summaries → exercises → workout_sessions
      // GROUP BY session date, AVG(rom_mm)
      // Filter by date range based on period
    },
  });
}

// Similar for: velocityTrendOptions, powerTrendOptions, asymmetryTrendOptions, tutTrendOptions
```

Each query aggregates per-session averages from `rep_summaries` over the selected date range.

- [ ] **Step 4: Add forceCurveOptions for drill-down**

```typescript
export function forceCurveOptions(sessionId: string, setId: string) {
  return queryOptions({
    queryKey: [...queryKeys.analytics.all, "force-curve", sessionId, setId],
    queryFn: async () => {
      // Fetch rep_telemetry for the specific set
    },
  });
}
```

- [ ] **Step 5: Run tests and commit**

```bash
git add src/queries/analytics.ts src/queries/__tests__/analytics-aggregate.test.ts
git commit -m "feat: add aggregate analytics queries for biomechanics trends"
```

---

### Task 17: Create Aggregated Chart Wrapper Components

**Files:**
- Create: `src/app/components/charts/RomTrendAggregated.tsx`
- Create: `src/app/components/charts/VelocityTrendAggregated.tsx`
- Create: `src/app/components/charts/PowerTrendAggregated.tsx`
- Create: `src/app/components/charts/AsymmetryTrendAggregated.tsx`
- Create: `src/app/components/charts/TutTrend.tsx`

These are new chart components that visualize session-level aggregate data over time. They differ from the existing per-rep charts in:
- **X axis:** Dates (not rep numbers)
- **Y axis:** Session averages (not individual rep values)
- **Tooltip:** Session date + average value

- [ ] **Step 1: Read existing chart components for patterns**

Read `src/app/components/charts/RomTrend.tsx` and `src/app/components/charts/VelocityProfile.tsx` to understand the charting patterns (Recharts usage, styling, theming).

- [ ] **Step 2: Create RomTrendAggregated.tsx**

```typescript
interface RomTrendAggregatedProps {
  data: Array<{ date: string; avgRomMm: number }>;
  height?: number;
}
```

Use Recharts `AreaChart` with date X axis and ROM (mm) Y axis. Style consistently with existing charts (dark theme, Phoenix palette).

- [ ] **Step 3: Create VelocityTrendAggregated.tsx**

Line chart showing mean velocity over time. Add VBT zone color reference bands using the zones from `src/lib/vbt.ts`. Props: `data: Array<{ date: string; avgVelocity: number }>`.

- [ ] **Step 4: Create PowerTrendAggregated.tsx**

Bar/area chart for average and peak power over time. Props: `data: Array<{ date: string; avgPower: number; peakPower: number }>`.

- [ ] **Step 5: Create AsymmetryTrendAggregated.tsx**

Line chart with a balance threshold line at 10%. Props: `data: Array<{ date: string; avgAsymmetry: number }>`.

- [ ] **Step 6: Create TutTrend.tsx**

Line chart for average time under tension per session. Props: `data: Array<{ date: string; avgTutMs: number }>`.

- [ ] **Step 7: Write smoke tests for each new chart component**

Create `src/app/components/charts/__tests__/aggregated-charts.test.tsx`:
- Test each component renders without crashing with sample data
- Test empty data state

- [ ] **Step 8: Commit**

```bash
git add src/app/components/charts/
git commit -m "feat: add aggregated trend chart components for Analytics Hub"
```

---

### Task 18: Add Biomechanics + Performance Tabs to Analytics Hub

**Files:**
- Modify: `src/app/components/Analytics.tsx:970-1002`
- Modify: `src/app/routes/index.tsx:92-95,189-191` (remove Biomechanics route)

- [ ] **Step 1: Read Analytics.tsx tab structure**

Read lines 960-1010 (desktop tabs) and 550-575 (mobile tabs).

- [ ] **Step 2: Make tab state URL-driven**

The redirect from `/biomechanics` to `/analytics?tab=biomechanics` requires the tab to be controlled by URL params. Add:
```typescript
import { useSearchParams } from "react-router";
const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get("tab") || "overview";
```

Change `<Tabs defaultValue="overview">` to `<Tabs value={activeTab} onValueChange={(v) => setSearchParams({ tab: v })}>`.

- [ ] **Step 3: Add new tab triggers**

Add two new `TabsTrigger` entries after "External":
```tsx
<TabsTrigger value="biomechanics">Biomechanics</TabsTrigger>
<TabsTrigger value="performance">Performance</TabsTrigger>
```

Same for mobile tabs array.

- [ ] **Step 3: Add Biomechanics tab content**

Add `TabsContent` for "biomechanics":
```tsx
<TabsContent value="biomechanics">
  <SubscriptionGate requiredTier="INFERNO" featureName="Biomechanics Analytics">
    {/* Session selector (reuse pattern from Biomechanics.tsx) */}
    {/* RomTrendAggregated chart */}
    {/* VelocityTrendAggregated chart */}
    {/* AsymmetryTrendAggregated chart */}
    {/* Drill-down: click session → per-rep charts using existing components */}
  </SubscriptionGate>
</TabsContent>
```

- [ ] **Step 4: Add Performance tab content**

```tsx
<TabsContent value="performance">
  <SubscriptionGate requiredTier="INFERNO" featureName="Performance Analytics">
    {/* PowerTrendAggregated chart */}
    {/* VBT zone distribution (pie/bar chart using VBT_ZONES from lib/vbt.ts) */}
    {/* TutTrend chart */}
  </SubscriptionGate>
</TabsContent>
```

- [ ] **Step 5: Remove Biomechanics route and add redirect**

In `src/app/routes/index.tsx`:
- Remove the Biomechanics lazy import (lines 92-95)
- Remove the Biomechanics route (lines 189-191)
- Add redirect: `<Route path="/biomechanics" element={<Navigate to="/analytics?tab=biomechanics" replace />} />`

- [ ] **Step 6: Update existing tab volume/weight displays with unit conversion**

Ensure all volume/weight displays in the Overview, Strength Progress, etc. tabs use `formatWeight`/`formatVolume` from `units.ts`.

- [ ] **Step 7: Run tests**

Run: `npx vitest run`

- [ ] **Step 8: Commit**

```bash
git add src/app/components/Analytics.tsx src/app/routes/index.tsx
git commit -m "feat: merge Biomechanics into Analytics Hub with INFERNO-gated tabs"
```

---

### Task 19: Delete Orphaned Biomechanics Page

**Files:**
- Delete: `src/app/components/Biomechanics.tsx`

- [ ] **Step 1: Verify no remaining imports reference Biomechanics**

Search: `grep -r "Biomechanics" src/ --include="*.tsx" --include="*.ts"`

Should only find the redirect in routes. If anything else references it, update those references.

- [ ] **Step 2: Delete the file**

```bash
rm src/app/components/Biomechanics.tsx
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove orphaned Biomechanics page (merged into Analytics Hub)"
```

---

## Wave 5: Cycles (Issue 5)

### Task 20: Verify Cycles Empty State + CycleBuilder

**Files:**
- Reference: `src/app/components/TrainingCycles.tsx:80-116`
- Reference: `src/app/components/cycle-builder/`
- Reference: `src/mutations/cycles.ts`

- [ ] **Step 1: Verify TrainingCycles empty state**

Read `src/app/components/TrainingCycles.tsx` lines 80-116. The empty state already exists with an EmptyState component, Calendar icon, "Plan your training cycle" title, and "Create Cycle" CTA. Verify it renders correctly by:
1. Checking the component renders without data
2. Confirming the CTA links to `/cycles/new`

If the empty state is already adequate, mark this as verified and move on.

- [ ] **Step 2: Verify CycleBuilder writes correctly**

Read `src/mutations/cycles.ts` — the `useSaveCycle()` mutation (lines 47-111) creates a `training_cycles` row and `cycle_days` rows. Read the CycleBuilder entry component to verify it uses this mutation.

Test by:
1. Navigate to `/cycles/new` in the dev server
2. Create a test cycle
3. Verify it appears in the cycles list
4. Verify it can be edited and activated

- [ ] **Step 3: If empty state needs improvement, update it**

If the current empty state is missing context about mobile sync, add a line:
```
"Cycles you create here will sync to the Phoenix mobile app."
```

- [ ] **Step 4: Commit if changes were made**

```bash
git add src/app/components/TrainingCycles.tsx
git commit -m "fix: improve cycles empty state with sync context"
```

---

## Final Verification

### Task 21: Full Test Suite + Typecheck

- [ ] **Step 1: Run full test suite**

Run: `npm test`

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Run build**

Run: `npm run build`

- [ ] **Step 4: Fix any failures**

Address any test failures, type errors, or build errors introduced by the changes.

- [ ] **Step 5: Final commit if needed**

```bash
git add -A
git commit -m "fix: resolve test/type/build issues from portal critical fixes"
```
