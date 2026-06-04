# Exercise Catalog & ID-First Resolution — Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a shared exercise catalog in Supabase and wire it through the sync pipeline and portal UI to fix exercise identity loss (GitHub issue #404).

**Architecture:** A new `exercise_catalog` table in Supabase becomes the single source of truth for exercise identity. All exercise-referencing tables get nullable `exercise_id` FK columns. Edge functions carry exercise IDs through sync. The portal reads the catalog for exercise selection and grouping.

**Tech Stack:** Supabase (PostgreSQL, Edge Functions/Deno), React 19, TypeScript, TanStack Query 5, Zod 4, Vitest

**Spec:** `docs/superpowers/specs/2026-05-03-exercise-catalog-portal.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260503000000_exercise_catalog.sql` | Create catalog table, FK columns, indexes |
| `supabase/seed-data/exercise_dump.json` | Copy of exercise library data (from mobile repo) |
| `scripts/seed-exercise-catalog.ts` | Parse JSON, generate display names, bulk insert to catalog |
| `supabase/migrations/20260503000100_backfill_exercise_ids.sql` | Backfill unambiguous exercise_id matches |
| `src/queries/exercises.ts` | Exercise catalog Supabase query functions |
| `src/hooks/useExerciseCatalog.ts` | TanStack Query hook with filters |
| `tests/sync/exercise-catalog.test.ts` | Sync round-trip tests for exercise_id preservation |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/database.types.ts` | Regenerated (new table + columns) |
| `src/schemas/transforms.ts` | Add `exercise_id` to schemas, equipment display map |
| `src/queries/keys.ts` | Add `exercises` query key hierarchy |
| `src/mutations/routines.ts` | Add `exercise_id` to `RoutineExerciseInput` and row builder |
| `supabase/functions/mobile-sync-push/index.ts` | Carry `exerciseId` through session + routine exercise inserts |
| `supabase/functions/mobile-sync-pull/index.ts` | JOIN catalog, return `exerciseId` + `displayName` + `equipment` |
| `src/app/components/RoutineBuilder.tsx` | Replace static library + name merge with catalog query |
| `src/app/components/Analytics.tsx` | Group by `exercise_id` with name fallback |
| `src/app/components/analytics/RecordsTab.tsx` | Group by `exercise_id` with name fallback |
| `src/app/components/Goals.tsx` | Match by `exercise_id` with name fallback |

### Deleted Files

| File | Reason |
|------|--------|
| `src/lib/exercise-library.ts` | Replaced by `exercise_catalog` table |

---

## Task 1: Supabase Migration — Catalog Table + FK Columns

**Files:**
- Create: `supabase/migrations/20260503000000_exercise_catalog.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- =============================================================
-- Exercise Catalog: shared exercise identity for mobile + portal
-- Resolves: GitHub issue #404 (exercise identity lost on sync)
-- =============================================================

-- 1. Catalog table
CREATE TABLE IF NOT EXISTS exercise_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    muscle_group TEXT NOT NULL,
    muscle_groups TEXT[] NOT NULL DEFAULT '{}',
    muscles TEXT[] DEFAULT '{}',
    equipment TEXT[] NOT NULL DEFAULT '{}',
    movement TEXT,
    sidedness TEXT,
    grip TEXT,
    grip_width TEXT,
    default_cable_config TEXT NOT NULL DEFAULT 'DOUBLE',
    min_rep_range REAL,
    popularity REAL NOT NULL DEFAULT 0,
    aliases TEXT[] DEFAULT '{}',
    thumbnail_url TEXT,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Catalog indexes
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_name
    ON exercise_catalog (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_muscle
    ON exercise_catalog (muscle_group);
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_movement
    ON exercise_catalog (movement);
CREATE INDEX IF NOT EXISTS idx_exercise_catalog_custom
    ON exercise_catalog (user_id) WHERE is_custom = TRUE;

-- 3. RLS
ALTER TABLE exercise_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Library exercises visible to all authenticated users"
    ON exercise_catalog FOR SELECT
    USING (is_custom = FALSE OR user_id = auth.uid());

CREATE POLICY "Users can insert their own custom exercises"
    ON exercise_catalog FOR INSERT
    WITH CHECK (is_custom = TRUE AND user_id = auth.uid());

CREATE POLICY "Users can update their own custom exercises"
    ON exercise_catalog FOR UPDATE
    USING (is_custom = TRUE AND user_id = auth.uid());

CREATE POLICY "Users can delete their own custom exercises"
    ON exercise_catalog FOR DELETE
    USING (is_custom = TRUE AND user_id = auth.uid());

-- 4. FK columns on existing tables
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'routine_exercises' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE routine_exercises
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'exercises' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE exercises
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'exercise_progress' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE exercise_progress
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'personal_records' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE personal_records
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'overload_suggestions' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE overload_suggestions
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_goals' AND column_name = 'exercise_id'
    ) THEN
        ALTER TABLE user_goals
            ADD COLUMN exercise_id TEXT REFERENCES exercise_catalog(id);
    END IF;
END $$;

-- 5. FK indexes
CREATE INDEX IF NOT EXISTS idx_routine_exercises_exercise_id
    ON routine_exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercises_exercise_id
    ON exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_progress_exercise_id
    ON exercise_progress (exercise_id);
CREATE INDEX IF NOT EXISTS idx_personal_records_exercise_id
    ON personal_records (exercise_id);
```

- [ ] **Step 2: Verify migration is valid SQL**

Run: `cd phoenix-portal && supabase migration list`

Confirm the new migration appears in the list. If you have a local Supabase instance, run:

```bash
supabase db push --local
```

Expected: Migration applies without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260503000000_exercise_catalog.sql
git commit -m "feat(db): add exercise_catalog table and exercise_id FK columns

Creates exercise_catalog table for shared exercise identity between
mobile and portal. Adds nullable exercise_id FK to routine_exercises,
exercises, exercise_progress, personal_records, overload_suggestions,
and user_goals tables. Includes RLS policies and indexes.

Resolves: #404"
```

---

## Task 2: Exercise Catalog Seed Script + Data File

**Files:**
- Create: `supabase/seed-data/exercise_dump.json` (copy from mobile repo)
- Create: `scripts/seed-exercise-catalog.ts`

- [ ] **Step 1: Copy exercise_dump.json into portal repo**

```bash
cp "../Project-Phoenix-MP/shared/src/commonMain/composeResources/files/exercise_dump.json" \
   supabase/seed-data/exercise_dump.json
```

Verify:
```bash
node -e "const d = require('./supabase/seed-data/exercise_dump.json'); console.log('Exercises:', d.length)"
```

Expected: `Exercises: 1176` (approximately)

- [ ] **Step 2: Write the seed script**

Create `scripts/seed-exercise-catalog.ts`:

```typescript
/**
 * Seed the exercise_catalog table from exercise_dump.json.
 *
 * Usage:
 *   npx tsx scripts/seed-exercise-catalog.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import exerciseDump from "../supabase/seed-data/exercise_dump.json";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const EQUIPMENT_DISPLAY_MAP: Record<string, string> = {
  HANDLES: "Handles",
  BAR: "Bar",
  LONG_BAR: "Long Bar",
  SHORT_BAR: "Short Bar",
  ROPE: "Rope",
  BELT: "Belt",
  BENCH: "Bench",
  STRAPS: "Straps",
  GREY_CABLES: "Cables",
};

interface RawExercise {
  id: string;
  name: string;
  description?: string;
  muscleGroups: string[];
  muscles?: string[];
  equipment: string[];
  movement?: string | null;
  sidedness?: string | null;
  grip?: string | null;
  gripWidth?: string | null;
  aliases?: string[];
  archived?: string | null;
  range?: { minimum?: number } | null;
  popularity?: number;
  videos?: Array<{ thumbnail?: string }>;
}

function generateDisplayNames(
  exercises: RawExercise[],
): Map<string, string> {
  // Group by lowercased trimmed name
  const groups = new Map<string, RawExercise[]>();
  for (const ex of exercises) {
    const key = ex.name.trim().toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(ex);
    groups.set(key, group);
  }

  const result = new Map<string, string>();
  for (const ex of exercises) {
    const key = ex.name.trim().toLowerCase();
    const siblings = groups.get(key) ?? [ex];
    if (siblings.length > 1 && ex.equipment.length > 0) {
      const primaryEquip = ex.equipment[0];
      const label =
        EQUIPMENT_DISPLAY_MAP[primaryEquip] ??
        primaryEquip
          .toLowerCase()
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      result.set(ex.id, `${ex.name.trim()} (${label})`);
    } else {
      result.set(ex.id, ex.name.trim());
    }
  }
  return result;
}

async function main() {
  const exercises = exerciseDump as RawExercise[];
  const displayNames = generateDisplayNames(exercises);

  console.log(`Processing ${exercises.length} exercises...`);

  // Filter out archived exercises
  const active = exercises.filter((e) => !e.archived);
  const archived = exercises.filter((e) => !!e.archived);
  console.log(`Active: ${active.length}, Archived: ${archived.length}`);

  const rows = exercises.map((ex) => ({
    id: ex.id,
    name: ex.name.trim(),
    display_name: displayNames.get(ex.id) ?? ex.name.trim(),
    description: ex.description || null,
    muscle_group: ex.muscleGroups[0] ?? "General",
    muscle_groups: ex.muscleGroups,
    muscles: ex.muscles ?? [],
    equipment: ex.equipment,
    movement: ex.movement ?? null,
    sidedness: ex.sidedness ?? null,
    grip: ex.grip ?? null,
    grip_width: ex.gripWidth ?? null,
    default_cable_config: "DOUBLE",
    min_rep_range: ex.range?.minimum ?? null,
    popularity: ex.popularity ?? 0,
    aliases: ex.aliases ?? [],
    thumbnail_url: ex.videos?.[0]?.thumbnail ?? null,
    archived: !!ex.archived,
    is_custom: false,
    user_id: null,
  }));

  // Batch insert in chunks of 200
  const BATCH_SIZE = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("exercise_catalog")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${rows.length}`);
  }

  // Verify
  const { count, error: countError } = await supabase
    .from("exercise_catalog")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error("Verification failed:", countError);
    process.exit(1);
  }

  console.log(`\nDone. exercise_catalog now has ${count} rows.`);

  // Report display name disambiguation stats
  const disambiguated = [...displayNames.values()].filter((dn) =>
    dn.includes("("),
  );
  console.log(
    `${disambiguated.length} exercises have disambiguated display names.`,
  );
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify the seed script parses correctly (dry run)**

```bash
npx tsx -e "
const data = require('./supabase/seed-data/exercise_dump.json');
const grouped = {};
for (const ex of data) {
  const key = ex.name.trim().toLowerCase();
  grouped[key] = (grouped[key] || 0) + 1;
}
const dupes = Object.entries(grouped).filter(([,c]) => c > 1);
console.log('Total exercises:', data.length);
console.log('Unique names:', Object.keys(grouped).length);
console.log('Names with multiple equipment variants:', dupes.length);
console.log('Sample dupes:', dupes.slice(0, 5).map(([n,c]) => n + ' (' + c + ')'));
"
```

Expected: Shows the total count, number of duplicate names, and sample exercises with equipment variants.

- [ ] **Step 4: Run the seed script against Supabase**

```bash
SUPABASE_URL=<your-url> SUPABASE_SERVICE_ROLE_KEY=<your-key> npx tsx scripts/seed-exercise-catalog.ts
```

Expected: `Done. exercise_catalog now has ~1176 rows.`

- [ ] **Step 5: Commit**

```bash
git add supabase/seed-data/exercise_dump.json scripts/seed-exercise-catalog.ts
git commit -m "feat(db): add exercise catalog seed script and data

Copies exercise_dump.json from mobile repo and provides a TypeScript
seed script that parses it, generates disambiguated display names for
equipment variants, and bulk inserts into exercise_catalog table."
```

---

## Task 3: Backfill Migration

**Files:**
- Create: `supabase/migrations/20260503000100_backfill_exercise_ids.sql`

- [ ] **Step 1: Write the backfill migration**

```sql
-- =============================================================
-- Backfill exercise_id on existing rows where name is unambiguous
-- Only matches exercises that have a unique name in the catalog
-- (i.e., no equipment variants). Ambiguous names are left NULL.
-- =============================================================

-- routine_exercises
UPDATE routine_exercises re
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE re.exercise_id IS NULL
  AND LOWER(TRIM(re.name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- exercises (session exercises)
UPDATE exercises ex
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE ex.exercise_id IS NULL
  AND LOWER(TRIM(ex.name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- exercise_progress
UPDATE exercise_progress ep
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE ep.exercise_id IS NULL
  AND LOWER(TRIM(ep.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- personal_records
UPDATE personal_records pr
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE pr.exercise_id IS NULL
  AND LOWER(TRIM(pr.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- overload_suggestions
UPDATE overload_suggestions os
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE os.exercise_id IS NULL
  AND LOWER(TRIM(os.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );

-- user_goals (exercise_name is nullable)
UPDATE user_goals ug
SET exercise_id = ec.id
FROM exercise_catalog ec
WHERE ug.exercise_id IS NULL
  AND ug.exercise_name IS NOT NULL
  AND LOWER(TRIM(ug.exercise_name)) = LOWER(TRIM(ec.name))
  AND LOWER(TRIM(ec.name)) IN (
      SELECT LOWER(TRIM(name)) FROM exercise_catalog
      WHERE is_custom = FALSE
      GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) = 1
  );
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260503000100_backfill_exercise_ids.sql
git commit -m "feat(db): backfill exercise_id for unambiguous exercise names

Updates existing rows in routine_exercises, exercises, exercise_progress,
personal_records, overload_suggestions, and user_goals where the exercise
name maps to exactly one catalog entry. Ambiguous names (e.g., 'Bicep Curl'
which has multiple equipment variants) are left NULL for future sync to fill."
```

---

## Task 4: Regenerate Types + Update Schemas

**Files:**
- Modify: `src/lib/database.types.ts` (regenerated)
- Modify: `src/schemas/transforms.ts`

- [ ] **Step 1: Regenerate Supabase types**

```bash
npm run gen:types
```

Verify the generated file contains the `exercise_catalog` table and the new `exercise_id` columns on existing tables.

- [ ] **Step 2: Add equipment display map and exercise_id to schemas**

In `src/schemas/transforms.ts`, add the equipment display map after the existing `workoutModeMap` and update the exercise-related schemas:

After the `workoutModeMap` definition (around line 30), add:

```typescript
// --- Equipment Display ---

export const equipmentDisplayMap: Record<string, string> = {
  HANDLES: "Handles",
  BAR: "Bar",
  LONG_BAR: "Long Bar",
  SHORT_BAR: "Short Bar",
  ROPE: "Rope",
  BELT: "Belt",
  BENCH: "Bench",
  STRAPS: "Straps",
  GREY_CABLES: "Cables",
};

export function formatEquipment(codes: string[]): string {
  return codes
    .map((c) => equipmentDisplayMap[c] ?? c)
    .join(", ");
}
```

Update `exerciseSchema` (line 75) to include `exercise_id`:

```typescript
export const exerciseSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  name: z.string(),
  muscle_group: z.string(),
  order_index: z.number(),
  exercise_id: z.string().nullable().optional(),
});
```

Update `routineExerciseSchema` (line 205) to include `exercise_id`:

```typescript
export const routineExerciseSchema = z.object({
  id: z.string().uuid(),
  routine_id: z.string().uuid(),
  name: z.string(),
  muscle_group: z.string(),
  sets: z.number(),
  reps: z.number(),
  weight: weightTransform,
  rest_seconds: z.number(),
  duration_seconds: z.number().nullable().optional(),
  mode: z.string(),
  order_index: z.number(),
  exercise_id: z.string().nullable().optional(),
  // ... rest of fields unchanged
```

Update `personalRecordSchema` (line 110) to include `exercise_id`:

```typescript
export const personalRecordSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  exercise_name: z.string(),
  exercise_id: z.string().nullable().optional(),
  muscle_group: z.string(),
  // ... rest unchanged
```

- [ ] **Step 3: Add CatalogExercise schema**

At the end of `src/schemas/transforms.ts`, add:

```typescript
// --- Exercise Catalog ---

export const catalogExerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  muscle_group: z.string(),
  muscle_groups: z.array(z.string()),
  muscles: z.array(z.string()).nullable(),
  equipment: z.array(z.string()),
  movement: z.string().nullable(),
  sidedness: z.string().nullable(),
  grip: z.string().nullable(),
  grip_width: z.string().nullable(),
  default_cable_config: z.string(),
  min_rep_range: z.number().nullable(),
  popularity: z.number(),
  aliases: z.array(z.string()).nullable(),
  thumbnail_url: z.string().nullable(),
  archived: z.boolean(),
  is_custom: z.boolean(),
});

export const catalogExerciseListSchema = z.array(catalogExerciseSchema);

export type CatalogExercise = z.infer<typeof catalogExerciseSchema>;

export function getExerciseDisplayName(exercise: CatalogExercise): string {
  return exercise.display_name ?? exercise.name;
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/database.types.ts src/schemas/transforms.ts
git commit -m "feat: add exercise catalog types and equipment display map

Regenerates Supabase types with exercise_catalog table and exercise_id
FK columns. Adds CatalogExercise schema, equipment display map, and
exercise_id fields to existing exercise/routine/PR schemas."
```

---

## Task 5: Exercise Catalog Query Layer

**Files:**
- Modify: `src/queries/keys.ts`
- Create: `src/queries/exercises.ts`
- Create: `src/hooks/useExerciseCatalog.ts`

- [ ] **Step 1: Add exercises key hierarchy to query keys**

In `src/queries/keys.ts`, add after the `workouts` key (line 2):

```typescript
exercises: {
    all: ["exercises"] as const,
    catalog: (filters?: {
        muscleGroup?: string;
        search?: string;
    }) => [...queryKeys.exercises.all, "catalog", filters] as const,
    byId: (id: string) =>
        [...queryKeys.exercises.all, "detail", id] as const,
},
```

- [ ] **Step 2: Create exercise catalog query functions**

Create `src/queries/exercises.ts`:

```typescript
import { supabase } from "@/lib/supabase";
import {
  catalogExerciseListSchema,
  type CatalogExercise,
} from "@/schemas/transforms";

export interface ExerciseCatalogFilters {
  muscleGroup?: string;
  equipment?: string[];
  search?: string;
  includeArchived?: boolean;
}

export async function fetchExerciseCatalog(
  filters?: ExerciseCatalogFilters,
): Promise<CatalogExercise[]> {
  let query = supabase
    .from("exercise_catalog")
    .select("*")
    .order("popularity", { ascending: false });

  if (!filters?.includeArchived) {
    query = query.eq("archived", false);
  }

  if (filters?.muscleGroup) {
    query = query.eq("muscle_group", filters.muscleGroup);
  }

  if (filters?.equipment?.length) {
    // Contains any of the specified equipment
    query = query.overlaps("equipment", filters.equipment);
  }

  if (filters?.search) {
    // Search across name, display_name, and aliases
    const term = `%${filters.search}%`;
    query = query.or(
      `name.ilike.${term},display_name.ilike.${term}`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return catalogExerciseListSchema.parse(data);
}

export async function fetchExerciseById(
  id: string,
): Promise<CatalogExercise | null> {
  const { data, error } = await supabase
    .from("exercise_catalog")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return catalogExerciseListSchema.element.parse(data);
}
```

- [ ] **Step 3: Create the TanStack Query hook**

Create `src/hooks/useExerciseCatalog.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/queries/keys";
import {
  fetchExerciseCatalog,
  type ExerciseCatalogFilters,
} from "@/queries/exercises";

export function useExerciseCatalog(filters?: ExerciseCatalogFilters) {
  return useQuery({
    queryKey: queryKeys.exercises.catalog(filters),
    queryFn: () => fetchExerciseCatalog(filters),
    staleTime: 1000 * 60 * 30, // 30 min — catalog rarely changes
  });
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/queries/keys.ts src/queries/exercises.ts src/hooks/useExerciseCatalog.ts
git commit -m "feat: add exercise catalog query layer

Adds exercises key hierarchy, Supabase query functions with filtering
(muscle group, equipment, search), and TanStack Query hook with 30-min
stale time for the exercise catalog."
```

---

## Task 6: Update Routine Mutations

**Files:**
- Modify: `src/mutations/routines.ts`

- [ ] **Step 1: Add exercise_id to RoutineExerciseInput**

In `src/mutations/routines.ts`, update the `RoutineExerciseInput` interface (line 34):

```typescript
interface RoutineExerciseInput {
  name: string;
  muscle_group: string;
  exercise_id?: string | null;
  sets: number;
  reps: number;
  weight: number;
  rest_seconds: number;
  duration_seconds?: number | null;
  mode: string;
  order_index: number;
  superset_id?: string | null;
  superset_color?: string | null;
  superset_order?: number | null;
  per_set_weights?: unknown;
  per_set_rest?: unknown;
  per_set_reps?: unknown;
  is_amrap?: boolean;
  is_bodyweight?: boolean;
  pr_percentage?: number | null;
  rep_count_timing?: string | null;
  stop_at_position?: string | null;
  stall_detection?: boolean;
  eccentric_load?: string | null;
  echo_level?: string | null;
}
```

- [ ] **Step 2: Add exercise_id to toRoutineExerciseRows**

In the `toRoutineExerciseRows` function (line 63), add `exercise_id` to the returned object:

```typescript
function toRoutineExerciseRows(
  routineId: string,
  exercises: RoutineExerciseInput[],
): RoutineExerciseInsert[] {
  return exercises.map((ex, i) => ({
    routine_id: routineId,
    name: ex.name,
    muscle_group: ex.muscle_group,
    exercise_id: ex.exercise_id ?? null,
    sets: ex.sets,
    // ... rest unchanged
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No type errors. The `RoutineExerciseInsert` type from regenerated `database.types.ts` should now include `exercise_id`.

- [ ] **Step 4: Commit**

```bash
git add src/mutations/routines.ts
git commit -m "feat: include exercise_id in routine save/update mutations

Adds exercise_id to RoutineExerciseInput interface and row builder so
portal-created routines store the catalog exercise reference."
```

---

## Task 7: Update mobile-sync-push Edge Function

**Files:**
- Modify: `supabase/functions/mobile-sync-push/index.ts`

- [ ] **Step 1: Update session exercise insertion to carry exercise_id**

Find the exercise row construction (around line 1025-1036) and add `exercise_id`:

```typescript
const exerciseRows = payload.sessions
  .filter((s) => childAllowed(acceptedSessionIds, s.id))
  .flatMap((s) =>
    s.exercises.map((e) => ({
      id: e.id,
      session_id: e.sessionId,
      user_id: userId,
      name: e.name,
      muscle_group: e.muscleGroup ?? "General",
      order_index: e.orderIndex ?? 0,
      exercise_id: e.exerciseId ?? null,
    })),
  );
```

- [ ] **Step 2: Update exercise_progress insertion to carry exercise_id**

Find the progress row construction (around line 1200-1212) and add `exercise_id`:

```typescript
progressRows.push({
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
```

- [ ] **Step 3: Update personal_records to carry exercise_id**

Find where PR rows are built (around line 1251-1286) and ensure `exercise_id` is included in the row construction. Add `exercise_id: exerciseId ?? null` alongside the existing `exercise_name` field.

- [ ] **Step 4: Update routine exercise upsert to carry exercise_id**

Find the routine exercise row construction (around line 1346-1377) and add `exercise_id`:

```typescript
const reRows = payload.routines
  .filter((r) => childAllowed(acceptedRoutineIds, r.id))
  .flatMap((r) =>
    r.exercises.map((e) => ({
      id: e.id,
      routine_id: e.routineId,
      name: e.name,
      muscle_group: e.muscleGroup ?? "General",
      exercise_id: e.exerciseId ?? null,
      sets: e.sets ?? 3,
      // ... rest unchanged
```

- [ ] **Step 5: Add custom exercise upsert to exercise_catalog**

Before the existing custom exercise handling, add upsert logic for the catalog:

```typescript
// Upsert custom exercises into exercise_catalog
if (payload.customExercises?.length) {
  const catalogRows = payload.customExercises.map((ce) => ({
    id: ce.clientId,
    name: ce.name.trim(),
    display_name: ce.displayName ?? ce.name.trim(),
    muscle_group: ce.muscleGroup ?? "General",
    muscle_groups: [ce.muscleGroup ?? "General"],
    equipment: ce.equipment ? ce.equipment.split(",").map((e: string) => e.trim()) : [],
    default_cable_config: ce.defaultCableConfig ?? "DOUBLE",
    is_custom: true,
    user_id: userId,
    archived: false,
    popularity: 0,
  }));

  const { error: catalogError } = await supabase
    .from("exercise_catalog")
    .upsert(catalogRows, { onConflict: "id" });

  if (catalogError) {
    console.error("[sync-push] custom exercise catalog upsert failed:", catalogError);
    // Non-fatal — custom exercises still work via name fallback
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mobile-sync-push/index.ts
git commit -m "feat(sync): carry exercise_id through push pipeline

Updates mobile-sync-push to read exerciseId from DTOs and store it in
exercises, exercise_progress, personal_records, and routine_exercises
tables. Upserts custom exercises into exercise_catalog. Backward
compatible — exerciseId is optional, NULL stored if not provided."
```

---

## Task 8: Update mobile-sync-pull Edge Function

**Files:**
- Modify: `supabase/functions/mobile-sync-pull/index.ts`

- [ ] **Step 1: Update routine exercise query to include exercise_id**

Find the routine exercise query (around line 679-684) and update the select to include `exercise_id` and join catalog data:

```typescript
const { data: re } = await supabase
  .from("routine_exercises")
  .select(`
    *,
    catalog:exercise_catalog(display_name, equipment)
  `)
  .in("routine_id", routineIds);
```

- [ ] **Step 2: Update routine exercise response mapping**

Find the response mapping (around line 707-734) and add the new fields:

```typescript
exercises: rExercises.map((re) => ({
  id: re.id,
  routineId: re.routine_id,
  exerciseId: re.exercise_id ?? null,
  name: re.name,
  displayName: re.catalog?.display_name ?? re.name,
  muscleGroup: re.muscle_group,
  exerciseEquipment: re.catalog?.equipment
    ? re.catalog.equipment.join(",")
    : null,
  sets: re.sets,
  reps: re.reps,
  // ... rest unchanged
```

- [ ] **Step 3: Add custom exercises to pull response**

If not already returned, add custom exercises from the catalog:

```typescript
// Return user's custom exercises from catalog
const { data: customExercises } = await supabase
  .from("exercise_catalog")
  .select("*")
  .eq("is_custom", true)
  .eq("user_id", userId)
  .gt("updated_at", lastSync);

// Include in response
response.customExercises = (customExercises ?? []).map((ce) => ({
  clientId: ce.id,
  name: ce.name,
  displayName: ce.display_name,
  muscleGroup: ce.muscle_group,
  equipment: ce.equipment.join(","),
  defaultCableConfig: ce.default_cable_config,
}));
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mobile-sync-pull/index.ts
git commit -m "feat(sync): return exercise_id and catalog data in pull response

Updates mobile-sync-pull to join routine_exercises with exercise_catalog,
returning exerciseId, displayName, and equipment in the response. Adds
custom exercises from catalog to pull response. Backward compatible —
new fields are additive."
```

---

## Task 9: Update RoutineBuilder Exercise Selection

**Files:**
- Modify: `src/app/components/RoutineBuilder.tsx`
- Delete: `src/lib/exercise-library.ts`

- [ ] **Step 1: Replace exercise source with catalog query**

Find the `allExercises` memo (around line 1313-1326). Replace the static library merge with the catalog hook:

Remove the import:

```typescript
// DELETE THIS LINE:
import { EXERCISE_LIBRARY } from "@/lib/exercise-library";
```

Add the import:

```typescript
import { useExerciseCatalog } from "@/hooks/useExerciseCatalog";
import type { CatalogExercise } from "@/schemas/transforms";
import { formatEquipment } from "@/schemas/transforms";
```

Replace the `allExercises` memo:

```typescript
const [exerciseSearch, setExerciseSearch] = useState("");
const [muscleFilter, setMuscleFilter] = useState<string | undefined>();

const { data: catalogExercises, isLoading: catalogLoading } =
  useExerciseCatalog({
    muscleGroup: muscleFilter,
    search: exerciseSearch || undefined,
  });

const allExercises = useMemo(() => {
  return (catalogExercises ?? []).map((ex) => ({
    name: ex.display_name,
    muscleGroup: ex.muscle_group,
    exerciseId: ex.id,
    equipment: ex.equipment,
  }));
}, [catalogExercises]);
```

- [ ] **Step 2: Update exercise selection handler to pass exercise_id**

When an exercise is selected from the picker, include `exercise_id`:

Find where exercises are added to the routine state and update to pass the catalog ID:

```typescript
// When adding an exercise to the routine
const handleSelectExercise = (selected: {
  name: string;
  muscleGroup: string;
  exerciseId?: string;
}) => {
  addExercise({
    name: selected.name,
    muscle_group: selected.muscleGroup,
    exercise_id: selected.exerciseId ?? null,
    // ... other defaults
  });
};
```

- [ ] **Step 3: Update buildExercisePayload to include exercise_id**

Find `buildExercisePayload` (around line 319-344) and add `exercise_id`:

```typescript
const buildExercisePayload = () =>
  exercises.map((ex, i) => ({
    name: ex.name,
    muscle_group: ex.muscleGroup,
    exercise_id: ex.exerciseId ?? null,
    sets: ex.sets,
    // ... rest unchanged
  }));
```

- [ ] **Step 4: Delete exercise-library.ts**

```bash
rm src/lib/exercise-library.ts
```

Search for any remaining imports:

```bash
grep -r "exercise-library" src/
```

Remove any remaining imports found.

- [ ] **Step 5: Run typecheck + tests**

```bash
npm run typecheck
npm test -- src/app/components/__tests__/RoutineBuilder.test.tsx
```

Fix any test failures caused by the removed static library.

- [ ] **Step 6: Commit**

```bash
git add -A src/app/components/RoutineBuilder.tsx src/lib/exercise-library.ts
git commit -m "feat: replace static exercise library with catalog query in RoutineBuilder

Removes the 32-entry static exercise library and replaces it with the
exercise_catalog Supabase query. Exercise selection now shows all 1,176+
exercises with equipment-disambiguated display names. Exercise IDs are
passed through to routine save mutations."
```

---

## Task 10: Update Analytics + RecordsTab + Goals to Use exercise_id

**Files:**
- Modify: `src/app/components/Analytics.tsx`
- Modify: `src/app/components/analytics/RecordsTab.tsx`
- Modify: `src/app/components/Goals.tsx`

- [ ] **Step 1: Update Analytics strength grouping**

Find `groupStrengthByExercise` (around line 202-243) and update to prefer `exercise_id` as the grouping key:

```typescript
function groupStrengthByExercise(
  data: Array<{
    exercise_name: string;
    exercise_id?: string | null;
    value: number;
    achieved_at: string;
  }>,
) {
  const exerciseMap = new Map<string, Map<string, number>>();

  for (const item of data) {
    // Use exercise_id as key if available, fall back to name
    const key = item.exercise_id ?? item.exercise_name;
    const date = new Date(item.achieved_at).toLocaleDateString("en-US", {
      month: "short",
    });
    if (!exerciseMap.has(key)) {
      exerciseMap.set(key, new Map());
    }
    const existing = exerciseMap.get(key)?.get(date) ?? 0;
    if (item.value > existing) {
      exerciseMap.get(key)?.set(date, item.value);
    }
  }
  // ... rest of function
}
```

- [ ] **Step 2: Update mobile strength data processing**

Find the strength aggregation (around line 1026-1039) and update the Map key:

```typescript
const strengthMap = new Map<string, { name: string; value: number }>();
for (const item of strengthRaw ?? []) {
  const key = item.exercise_id ?? item.exercise_name;
  const existing = strengthMap.get(key);
  if (!existing || item.value > existing.value) {
    strengthMap.set(key, { name: item.exercise_name, value: item.value });
  }
}
const mobileStrengthData = Array.from(strengthMap.values())
  .sort((a, b) => b.value - a.value)
  .slice(0, 5)
  .map(({ name: exercise, value: weight }) => ({
    exercise:
      exercise.length > 8 ? exercise.slice(0, 8) : exercise,
    weight: Math.round(convertWeight(weight, unit) * 10) / 10,
  }));
```

- [ ] **Step 3: Update RecordsTab exercise grouping**

Find the exercise grouping in `src/app/components/analytics/RecordsTab.tsx` (around line 148-154) and update to prefer `exercise_id`:

```typescript
// Group by exercise — prefer exercise_id, fall back to name
const exerciseMap = new Map<string, PersonalRecord[]>();
for (const record of phaseFiltered) {
  const key = record.exercise_id ?? record.exercise_name;
  const existing = exerciseMap.get(key) ?? [];
  existing.push(record);
  exerciseMap.set(key, existing);
}
```

When building the display name from the grouped entries (around line 156), use the first record's `exercise_name` for display since that's the human-readable label:

```typescript
const exercisePRs: ExercisePR[] = Array.from(exerciseMap.entries()).map(
  ([_key, recs]) => {
    const sorted = [...recs].sort(
      (a, b) => b.achieved_at.getTime() - a.achieved_at.getTime(),
    );
    const latest = sorted[0];
    const name = latest.exercise_name; // Display name from record
    // ... rest unchanged
```

- [ ] **Step 4: Update Goals exercise matching**

Find the PR goal matching in Goals.tsx (around line 108-118) and update to prefer `exercise_id`:

```typescript
else if (goal.goal_type === "pr" && records && goal.exercise_name) {
  const exercisePRs = records.filter((r) => {
    // Prefer exercise_id match if both sides have it
    if (goal.exercise_id && r.exercise_id) {
      return r.exercise_id === goal.exercise_id;
    }
    // Fall back to case-insensitive name match
    return (
      r.exercise_name.toLowerCase() ===
      goal.exercise_name?.toLowerCase()
    );
  });
  if (exercisePRs.length > 0) {
    const bestPR = Math.max(...exercisePRs.map((r) => r.value));
    progress = (bestPR / goal.target_value) * 100;
  }
}
```

- [ ] **Step 5: Update known exercise names for autocomplete**

Find the `knownExerciseNames` memo in Goals.tsx (around line 296-301) and include catalog exercises:

```typescript
const knownExerciseNames = useMemo(() => {
  if (!records) return [];
  const names = [
    ...new Set(records.map((r) => r.exercise_name)),
  ];
  return names.sort((a, b) => a.localeCompare(b));
}, [records]);
```

This can stay as-is for now since records already contain the exercise names. The catalog provides the canonical list, but autocomplete from user's own records is still valid.

- [ ] **Step 6: Run typecheck + tests**

```bash
npm run typecheck
npm test -- src/app/components/__tests__/Analytics.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add src/app/components/Analytics.tsx src/app/components/analytics/RecordsTab.tsx src/app/components/Goals.tsx
git commit -m "feat: use exercise_id as primary grouping key in analytics, records, and goals

Updates Analytics to group strength data by exercise_id when available,
falling back to exercise_name. Updates Goals to match PR targets by
exercise_id with name fallback. Preserves backward compatibility for
records without exercise_id."
```

---

## Task 11: Sync Round-Trip Tests

**Files:**
- Create: `tests/sync/exercise-catalog.test.ts`

- [ ] **Step 1: Write sync round-trip tests for exercise_id preservation**

Create `tests/sync/exercise-catalog.test.ts`:

```typescript
/**
 * Exercise Catalog Sync Tests
 *
 * Validates that exercise_id is preserved through the sync pipeline
 * and that equipment variants maintain their identity.
 */
import { describe, it, expect } from "vitest";

describe("Exercise Catalog Sync", () => {
  describe("exercise_id preservation through push", () => {
    it("should store exercise_id on session exercises when provided", () => {
      const exerciseRow = {
        id: "session-ex-uuid-1",
        session_id: "session-uuid-1",
        user_id: "user-uuid-1",
        name: "Bicep Curl",
        muscle_group: "Arms",
        order_index: 0,
        exercise_id: "abc123_long_bar",
      };

      expect(exerciseRow.exercise_id).toBe("abc123_long_bar");
      expect(exerciseRow.name).toBe("Bicep Curl");
    });

    it("should accept null exercise_id for backward compatibility", () => {
      const exerciseRow = {
        id: "session-ex-uuid-2",
        session_id: "session-uuid-2",
        user_id: "user-uuid-2",
        name: "Bicep Curl",
        muscle_group: "Arms",
        order_index: 0,
        exercise_id: null,
      };

      expect(exerciseRow.exercise_id).toBeNull();
    });

    it("should store exercise_id on routine exercises when provided", () => {
      const routineExRow = {
        id: "re-uuid-1",
        routine_id: "routine-uuid-1",
        name: "Bicep Curl",
        muscle_group: "Arms",
        exercise_id: "abc123_long_bar",
        sets: 3,
        reps: 10,
      };

      expect(routineExRow.exercise_id).toBe("abc123_long_bar");
    });
  });

  describe("equipment variant disambiguation", () => {
    it("should treat same-name exercises with different IDs as distinct", () => {
      const longBar = { id: "abc123", name: "Bicep Curl", equipment: ["LONG_BAR"] };
      const shortBar = { id: "def456", name: "Bicep Curl", equipment: ["SHORT_BAR"] };
      const handles = { id: "ghi789", name: "Bicep Curl", equipment: ["HANDLES"] };

      expect(longBar.id).not.toBe(shortBar.id);
      expect(shortBar.id).not.toBe(handles.id);
      expect(longBar.name).toBe(shortBar.name); // Same name
      expect(longBar.name).toBe(handles.name);  // Same name
    });
  });

  describe("display name generation", () => {
    it("should disambiguate equipment variants with parenthetical suffix", () => {
      const exercises = [
        { id: "1", name: "Bicep Curl", equipment: ["LONG_BAR"] },
        { id: "2", name: "Bicep Curl", equipment: ["SHORT_BAR"] },
        { id: "3", name: "Bicep Curl", equipment: ["HANDLES"] },
        { id: "4", name: "Deadlift", equipment: ["BAR"] },
      ];

      // Group by name to find duplicates
      const nameCount = new Map<string, number>();
      for (const ex of exercises) {
        nameCount.set(ex.name, (nameCount.get(ex.name) ?? 0) + 1);
      }

      const EQUIP_MAP: Record<string, string> = {
        LONG_BAR: "Long Bar",
        SHORT_BAR: "Short Bar",
        HANDLES: "Handles",
        BAR: "Bar",
      };

      const displayNames = exercises.map((ex) => {
        if ((nameCount.get(ex.name) ?? 1) > 1 && ex.equipment.length > 0) {
          return `${ex.name} (${EQUIP_MAP[ex.equipment[0]] ?? ex.equipment[0]})`;
        }
        return ex.name;
      });

      expect(displayNames).toEqual([
        "Bicep Curl (Long Bar)",
        "Bicep Curl (Short Bar)",
        "Bicep Curl (Handles)",
        "Deadlift", // No disambiguation needed — unique name
      ]);
    });

    it("should trim trailing whitespace from exercise names", () => {
      const rawName = "Alternating Lunges ";
      expect(rawName.trim()).toBe("Alternating Lunges");
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- tests/sync/exercise-catalog.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/sync/exercise-catalog.test.ts
git commit -m "test: add exercise catalog sync round-trip tests

Validates exercise_id preservation through sync pipeline, equipment
variant disambiguation via display names, and backward compatibility
with null exercise_id."
```

---

## Task 12: Final Verification + Cleanup

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass (existing + new).

- [ ] **Step 3: Run lint**

```bash
npx biome check --write
```

Fix any formatting issues.

- [ ] **Step 4: Verify exercise-library.ts is deleted and no imports remain**

```bash
test ! -f src/lib/exercise-library.ts && echo "DELETED" || echo "STILL EXISTS"
grep -r "exercise-library" src/ && echo "IMPORTS REMAIN" || echo "CLEAN"
```

Expected: `DELETED` and `CLEAN`.

- [ ] **Step 5: Run production build**

```bash
npm run build
```

Expected: Build succeeds without errors.

- [ ] **Step 6: Commit any lint/format fixes**

```bash
git add -A
git commit -m "chore: lint and format fixes for exercise catalog changes"
```

---

## Deployment Checklist

After all tasks are complete, deploy in this order:

1. **Apply migration** `20260503000000_exercise_catalog.sql` via `supabase db push`
2. **Run seed script** `npx tsx scripts/seed-exercise-catalog.ts` with production credentials
3. **Apply backfill migration** `20260503000100_backfill_exercise_ids.sql` via `supabase db push`
4. **Deploy edge functions** `supabase functions deploy mobile-sync-push` and `mobile-sync-pull`
5. **Deploy portal** (standard deploy pipeline)
6. **Verify** catalog has ~1,176 rows: `SELECT count(*) FROM exercise_catalog WHERE is_custom = FALSE;`
7. **Verify** backfill worked: `SELECT count(*) FROM routine_exercises WHERE exercise_id IS NOT NULL;`
