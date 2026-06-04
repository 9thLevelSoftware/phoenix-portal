# Local Profile Sync Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal and sync pipeline profile-aware so that workouts, routines, cycles, and personal records from different mobile local profiles are correctly tagged, stored, and filterable — preventing data contamination between profiles.

**Architecture:** Add a `local_profiles` table to Supabase (composite PK on `user_id, id` to allow the same profile ID like "default" across different users). Add a nullable `local_profile_id` FK column to **profile-scoped** data tables only (`workout_sessions`, `routines`, `training_cycles`, `personal_records`, `exercise_progress`). Gamification data (`earned_badges`, `rpg_attributes`, `gamification_stats`, `exercise_signatures`) stays **user-global** because the mobile app computes these across all profiles. Update both sync Edge Functions to accept and propagate profile context. Add a profile-aware Zustand store (session-persisted) and filter UI to the portal. All changes are backward-compatible: `local_profile_id` is nullable, so existing data continues to work.

**Tech Stack:** Supabase (PostgreSQL migrations, RLS), Deno Edge Functions, React 19, TypeScript, TanStack Query 5, Zustand 5, Tailwind v4 + shadcn/ui

---

## Problem Statement

### Current Behavior

The mobile app supports multiple local profiles per device (`UserProfile` table with `id`, `name`, `colorIndex`, `isActive`, `supabase_user_id`). However:

1. **No profile scoping on data tables.** `WorkoutSession`, `PersonalRecord`, `Routine`, `TrainingCycle` in mobile SQLite have no `profile_id` column.
2. **Sync grabs everything.** `selectSessionsModifiedSince` is `SELECT * FROM WorkoutSession WHERE updatedAt > ? AND deletedAt IS NULL` — no profile filter.
3. **Sync DTOs lack profile identity.** `SyncPushRequest` and its child DTOs have no `profileId` field.
4. **Edge Functions are profile-blind.** `mobile-sync-push` uses `userId` from JWT for all `user_id` columns. No `local_profile_id` is accepted or stored.
5. **Portal has no profile concept.** All queries filter by `user_id` only. No profile selector UI.

### Data Contamination Scenarios

| Scenario | Effect |
|----------|--------|
| Same Supabase account, 2+ local profiles (e.g., "Training" + "Testing") | All workouts mix together in portal; stats inflated; test PRs pollute real records |
| Different Supabase accounts on shared device (household) | Person A's sync pushes ALL device data (including B's workouts) to A's account — **privacy violation** |
| Profile deleted on mobile, data already synced | Orphaned data in portal with no way to identify or clean it up |

### Scope

This plan covers the **portal-side changes only**: Supabase schema, Edge Functions, portal queries, portal UI. Mobile-side changes are identified as prerequisites but not implemented here.

### Profile-Scoped vs User-Global Data

Critical design decision: **not all data should be profile-scoped.** The mobile app computes badges, RPG attributes, and gamification stats globally (not per-profile). Making these profile-scoped on the portal would create a mismatch.

| Data | Scoping | Rationale |
|------|---------|-----------|
| `workout_sessions` | **Profile-scoped** | Directly produced by a profile's workout activity |
| `routines` | **Profile-scoped** | Created/used within a specific profile context |
| `training_cycles` | **Profile-scoped** | Scheduled training for a specific profile |
| `personal_records` | **Profile-scoped** | PRs are per-profile achievement |
| `exercise_progress` | **Profile-scoped** | Derived from profile-scoped sessions |
| `earned_badges` | **User-global** | Mobile computes globally; conflict key is `(user_id, badge_id)` |
| `rpg_attributes` | **User-global** | Mobile computes globally; one row per user, conflict on `user_id` |
| `gamification_stats` | **User-global** | Mobile computes globally; one row per user, conflict on `user_id` |
| `exercise_signatures` | **User-global** | Movement patterns are user-level; conflict on `(user_id, exercise_id)` |

This avoids breaking the existing upsert conflict keys on user-global tables while correctly scoping workout data.

---

## Cross-Project Dependency: Mobile Changes Required

The portal changes are necessary but not sufficient. The mobile app (Project-Phoenix-MP) must also be updated (separate plan):

1. **SQLDelight schema:** Add `profileId TEXT` column to `WorkoutSession`, `PersonalRecord`, `Routine`, `TrainingCycle`
2. **Session recording:** Set `profileId` from `activeProfile.id` when creating new sessions, routines, etc.
3. **PortalSyncDtos.kt:** Add `profileId: String?` and `profileName: String?` to `PortalSyncPayload` (the active push DTO — NOT the legacy `SyncModels.kt/SyncPushRequest` which is obsolete)
4. **PortalSyncAdapter:** Propagate active profile's `id` and `name` into the push payload
5. **PortalApiClient.kt:** Add optional `profileId` to the pull request body sent by `pullPortalPayload()`
6. **PortalSyncPullResponse (PortalSyncDtos.kt):** Add `localProfiles` field to deserialize the new pull response (mobile uses `ignoreUnknownKeys = true` so this is non-breaking until mobile adds the field)

### Sync Cursor Model — Critical Constraint

The mobile app has a **single global `lastSync` timestamp** (`tokenStorage.getLastSyncTimestamp()` in `SyncManager.kt:116`), advanced after each sync (`SyncManager.kt:103`). This means:

**DO NOT filter outgoing sync queries by profile.** If mobile filters `selectSessionsModifiedSince` by active profile, syncing as Profile A advances the cursor past Profile B's unsynced data — permanently skipping it.

**Correct model: unfiltered outgoing deltas with per-record profile tags.**
- Mobile sync queries remain unfiltered (grab ALL records since `lastSync`, as today)
- Each record carries its own `profileId` from the local DB (set at creation time in step 2)
- `PortalSyncAdapter` reads each record's `profileId` and includes it in the push payload
- The edge function tags each record with its own profile ID (not a single payload-level ID)
- The global `lastSync` cursor continues to work correctly

This requires the push DTO to carry `profileId` per-session/per-routine/per-cycle rather than a single top-level `profileId`. The portal edge function in this plan already accepts per-payload `profileId` as a first step; per-record tagging is the eventual correct state.

### Profile Lifecycle Sync

The mobile should also send its **full list of local profiles** in each push (not just the active one). This allows the edge function to:
- Upsert all profiles that exist on the device
- Delete any `local_profiles` rows that no longer exist on the device (profile was deleted on mobile)

Without this, deleted profiles accumulate as stale rows in Supabase and the cleanup trigger never fires.

**Portal deploys first** (backward-compatible). Mobile ships afterward.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260321_local_profile_support.sql` | Schema migration: `local_profiles` table + `local_profile_id` on profile-scoped data tables |
| `src/stores/useProfileFilterStore.ts` | Zustand store for active local profile filter (session-persisted) |
| `src/queries/localProfiles.ts` | TanStack Query hooks for fetching local profiles |
| `src/app/components/LocalProfileFilter.tsx` | Profile filter dropdown component for sidebar |
| `src/app/components/__tests__/LocalProfileFilter.test.tsx` | Tests for profile filter component |
| `src/lib/__tests__/profileFilter.test.ts` | Tests for profile filtering store logic |

### Modified Files

| File | Changes |
|------|---------|
| `supabase/functions/mobile-sync-push/index.ts` | Accept `profileId`/`profileName`/`allProfiles`; sync `local_profiles` table (upsert + delete stale); tag profile-scoped data; update PR dedup key |
| `supabase/functions/mobile-sync-pull/index.ts` | Accept optional `profileId`; filter profile-scoped data; return `localProfiles` |
| `src/mutations/routines.ts` | Set `local_profile_id` from active profile filter on routine create/save |
| `src/mutations/cycles.ts` | Set `local_profile_id` from active profile filter on cycle create/save |
| `src/lib/database.types.ts` | Regenerated after migration |
| `src/queries/keys.ts` | Add `localProfiles` namespace; add `profileId` param to profile-scoped keys |
| `src/queries/workouts.ts` | Profile filter on `workoutListOptions`, `workoutListPageOptions`, `dashboardStatsOptions`, `recentPRsOptions` |
| `src/queries/routines.ts` | Profile filter on routine list options |
| `src/queries/cycles.ts` | Profile filter on cycle list options |
| `src/queries/records.ts` | Profile filter on records query |
| `src/queries/analytics.ts` | Profile filter on `volumeTrendOptions`, `muscleGroupOptions`, `strengthProgressOptions`, `volumeComparisonOptions`, `formScoreTrendOptions`, `safetyTrendOptions`, `calorieHistoryOptions` |
| `src/queries/progress.ts` | Profile filter on exercise progress queries |
| `src/queries/profile.ts` | Profile filter on `profileStatsOptions`, `topExercisesOptions` (NOT badges/rpg/gamification — those are user-global) |
| `src/hooks/useRealtimeSync.ts` | Invalidate `localProfiles` query key on sync_complete |
| `src/app/components/AppSidebar.tsx` | Mount `LocalProfileFilter` component |
| `src/app/components/Dashboard.tsx` | Pass active profile filter to queries |
| `src/app/components/Analytics.tsx` | Pass active profile filter to analytics queries |
| `src/app/components/WorkoutHistory.tsx` | Pass `activeProfileId` to `workoutListOptions` (line 42) |
| `src/app/components/Goals.tsx` | Pass `activeProfileId` to `workoutListOptions`, `personalRecordsOptions` (lines 68-69) |
| `src/app/components/Recovery.tsx` | Pass `activeProfileId` to `workoutListOptions` (line 88) |
| `src/app/components/ExerciseProgress.tsx` | Pass `activeProfileId` to `exerciseProgressOptions` (line 31) |
| `src/app/components/SummaryReport.tsx` | Pass `activeProfileId` to `weeklySummaryOptions` (line 19) |
| `src/queries/__tests__/workouts.test.ts` | Update query key assertions for new `profileId` param |
| `src/queries/__tests__/routines.test.ts` | Update query key assertions |
| `src/queries/__tests__/cycles.test.ts` | Update query key assertions |
| `src/queries/__tests__/records.test.ts` | Update query key assertions |
| `src/queries/__tests__/profile.test.ts` | Update query key assertions |
| `src/schemas/transforms.ts` | Add `localProfileId` passthrough to workout/routine/cycle/record transforms |

---

## Task 1: Database Migration — `local_profiles` Table and FK Columns

**Files:**
- Create: `supabase/migrations/20260321_local_profile_support.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- =============================================================================
-- Local Profile Support
-- Stores mobile app local profile metadata and adds profile FK to
-- profile-scoped data tables. Gamification tables (badges, rpg, stats,
-- signatures) remain user-global — mobile computes them across all profiles.
-- All new columns are nullable for backward compatibility.
-- =============================================================================

-- 1. Local profiles table
-- Composite PK allows the same profile ID (e.g., "default") across different users.
CREATE TABLE IF NOT EXISTS local_profiles (
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    id          TEXT        NOT NULL,  -- Mobile's UserProfile.id (UUID or "default")
    name        TEXT        NOT NULL,
    color_index INTEGER     NOT NULL DEFAULT 0,
    device_id   TEXT,                  -- Which device this profile was synced from
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_local_profiles_user_id ON local_profiles(user_id);

-- RLS
ALTER TABLE local_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own local profiles"
    ON local_profiles FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own local profiles"
    ON local_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own local profiles"
    ON local_profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own local profiles"
    ON local_profiles FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to local profiles"
    ON local_profiles FOR ALL USING (auth.role() = 'service_role');

-- 2. Add local_profile_id to PROFILE-SCOPED data tables only.
-- NOT added to: earned_badges, rpg_attributes, gamification_stats,
-- exercise_signatures (those are user-global, mobile computes them globally).

ALTER TABLE workout_sessions
    ADD COLUMN IF NOT EXISTS local_profile_id TEXT;

ALTER TABLE routines
    ADD COLUMN IF NOT EXISTS local_profile_id TEXT;

ALTER TABLE training_cycles
    ADD COLUMN IF NOT EXISTS local_profile_id TEXT;

ALTER TABLE personal_records
    ADD COLUMN IF NOT EXISTS local_profile_id TEXT;

ALTER TABLE exercise_progress
    ADD COLUMN IF NOT EXISTS local_profile_id TEXT;

-- 3. Foreign key constraints with ON DELETE SET NULL.
-- PostgreSQL allows nullable FK columns: when local_profile_id is NULL the
-- constraint is simply not checked, so existing pre-profile data is unaffected.
-- When local_profile_id is non-NULL, referential integrity is enforced.

ALTER TABLE workout_sessions
    ADD CONSTRAINT fk_workout_sessions_profile
    FOREIGN KEY (user_id, local_profile_id)
    REFERENCES local_profiles(user_id, id)
    ON DELETE SET NULL
    NOT VALID;  -- skip validation of existing rows (all NULL)

ALTER TABLE routines
    ADD CONSTRAINT fk_routines_profile
    FOREIGN KEY (user_id, local_profile_id)
    REFERENCES local_profiles(user_id, id)
    ON DELETE SET NULL
    NOT VALID;

ALTER TABLE training_cycles
    ADD CONSTRAINT fk_training_cycles_profile
    FOREIGN KEY (user_id, local_profile_id)
    REFERENCES local_profiles(user_id, id)
    ON DELETE SET NULL
    NOT VALID;

ALTER TABLE personal_records
    ADD CONSTRAINT fk_personal_records_profile
    FOREIGN KEY (user_id, local_profile_id)
    REFERENCES local_profiles(user_id, id)
    ON DELETE SET NULL
    NOT VALID;

ALTER TABLE exercise_progress
    ADD CONSTRAINT fk_exercise_progress_profile
    FOREIGN KEY (user_id, local_profile_id)
    REFERENCES local_profiles(user_id, id)
    ON DELETE SET NULL
    NOT VALID;

-- 4. Indexes for profile-scoped queries
CREATE INDEX IF NOT EXISTS idx_workout_sessions_profile
    ON workout_sessions(user_id, local_profile_id);

CREATE INDEX IF NOT EXISTS idx_routines_profile
    ON routines(user_id, local_profile_id);

CREATE INDEX IF NOT EXISTS idx_training_cycles_profile
    ON training_cycles(user_id, local_profile_id);

CREATE INDEX IF NOT EXISTS idx_personal_records_profile
    ON personal_records(user_id, local_profile_id);

CREATE INDEX IF NOT EXISTS idx_exercise_progress_profile
    ON exercise_progress(user_id, local_profile_id);

-- 5. No cleanup trigger needed — the FK ON DELETE SET NULL handles cascading
-- when a local profile is deleted: all referencing rows get local_profile_id = NULL.

-- 6. Validate FK constraints after initial deployment (run once data is clean)
-- ALTER TABLE workout_sessions VALIDATE CONSTRAINT fk_workout_sessions_profile;
-- ALTER TABLE routines VALIDATE CONSTRAINT fk_routines_profile;
-- (etc. — run these manually after confirming no orphaned references exist)
```

- [ ] **Step 2: Apply the migration**

Run: `cd phoenix-portal && supabase migration up` (or apply via Supabase dashboard)
Expected: All tables created/altered without errors.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `cd phoenix-portal && npm run gen:types`
Expected: `src/lib/database.types.ts` updated with `local_profiles` table and `local_profile_id` on profile-scoped tables.

- [ ] **Step 4: Verify types include new fields**

Confirm in `src/lib/database.types.ts`:
- `local_profiles` table type exists with composite PK fields
- `workout_sessions.Row` includes `local_profile_id: string | null`
- `routines.Row` includes `local_profile_id: string | null`
- Same for `training_cycles`, `personal_records`, `exercise_progress`
- `earned_badges`, `rpg_attributes`, `gamification_stats`, `exercise_signatures` do NOT have `local_profile_id`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260321_local_profile_support.sql src/lib/database.types.ts
git commit -m "feat: add local_profiles table and local_profile_id FK to profile-scoped data tables"
```

---

## Task 2: Update `mobile-sync-push` Edge Function

**Files:**
- Modify: `supabase/functions/mobile-sync-push/index.ts`

- [ ] **Step 1: Add profile fields to `PushPayload` interface**

In the `PushPayload` interface (around line 60), add profile fields:

```typescript
interface LocalProfileDto {
  id: string;
  name: string;
  colorIndex: number;
}

interface PushPayload {
  deviceId: string;
  platform: string;
  lastSync: number;
  // Active profile for tagging incoming data (null for older clients)
  profileId?: string | null;
  profileName?: string | null;
  // Full profile snapshot for lifecycle sync (null for older clients)
  allProfiles?: LocalProfileDto[] | null;
  sessions: SessionDto[];
  // ... rest unchanged
}
```

- [ ] **Step 2: Sync local profiles table (upsert + delete stale)**

After the `payload.platform` validation block (around line 368), before the counters:

```typescript
    // =========================================================================
    // 3b. Sync local profiles table
    // =========================================================================
    const localProfileId: string | null = payload.profileId ?? null;
    const allProfiles: LocalProfileDto[] | null = payload.allProfiles ?? null;

    if (allProfiles && allProfiles.length > 0) {
      // Upsert all profiles from the device
      const profileRows = allProfiles.map((p) => ({
        user_id: userId,
        id: p.id,
        name: p.name,
        color_index: p.colorIndex,
        device_id: payload.deviceId,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from('local_profiles')
        .upsert(profileRows, { onConflict: 'user_id,id' });

      if (upsertError) {
        console.warn('Failed to upsert local profiles:', upsertError.message);
      }

      // Delete profiles that no longer exist on the device
      const activeIds = allProfiles.map((p) => p.id);
      const { error: deleteError } = await supabase
        .from('local_profiles')
        .delete()
        .eq('user_id', userId)
        .eq('device_id', payload.deviceId)  // Only delete profiles from this device
        .not('id', 'in', `(${activeIds.map((id) => `"${id}"`).join(',')})`);

      if (deleteError) {
        console.warn('Failed to clean stale profiles:', deleteError.message);
      }
    } else if (localProfileId && payload.profileName) {
      // Fallback for older clients: upsert just the active profile
      const { error: profileError } = await supabase
        .from('local_profiles')
        .upsert(
          {
            user_id: userId,
            id: localProfileId,
            name: payload.profileName,
            device_id: payload.deviceId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,id' }
        );

      if (profileError) {
        console.warn('Failed to upsert local profile:', profileError.message);
        // Non-fatal: continue sync even if profile upsert fails
      }
    }
```

- [ ] **Step 3: Tag workout_sessions rows with `local_profile_id`**

In the session row mapping (around line 390), add:

```typescript
      const sessionRows = payload.sessions.map((s) => ({
        id: s.id,
        user_id: userId,
        local_profile_id: localProfileId,  // NEW
        name: s.name,
        // ... rest unchanged
      }));
```

- [ ] **Step 4: Tag routines with `local_profile_id`**

In the routines upsert section, add `local_profile_id: localProfileId` to each routine row.

- [ ] **Step 5: Tag training_cycles with `local_profile_id`**

In the cycles upsert section, add `local_profile_id: localProfileId` to each cycle row.

- [ ] **Step 6: Tag personal_records with `local_profile_id` AND update dedup key**

In the personal records section (around line 605-658), two changes:

1. Add `local_profile_id: localProfileId` to the insert row object.
2. **Update the dedup key string** to include profile context. Find the dedup key construction (around line 643-646) and add `localProfileId`:

```typescript
    // BEFORE (dedup key without profile):
    const dedupKey = `${pr.exerciseName}:${pr.achievedAt}:${pr.value}:${pr.recordType}:${pr.workoutPhase}`;

    // AFTER (dedup key WITH profile — prevents cross-profile dedup):
    const profileTag = localProfileId ?? '__no_profile__';
    const dedupKey = `${profileTag}:${pr.exerciseName}:${pr.achievedAt}:${pr.value}:${pr.recordType}:${pr.workoutPhase}`;
```

This ensures PRs from different profiles with identical exercise/timestamp/value are not deduplicated against each other.

- [ ] **Step 7: Tag exercise_progress with `local_profile_id`**

In the exercise_progress computation section (around line 534-599), add `local_profile_id: localProfileId` to the insert row.

- [ ] **Step 8: Do NOT tag user-global tables**

Confirm that `earned_badges`, `rpg_attributes`, `gamification_stats`, and `exercise_signatures` upsert sections are **not modified** — these remain user-global. Their existing `onConflict` keys (`user_id`, `user_id,badge_id`, `user_id,exercise_id`) are unchanged.

- [ ] **Step 9: Include profile info in broadcast payload**

In the `sync_complete` broadcast (around line 948), use the existing `httpSend` pattern (not `.send()`):

```typescript
    await supabase.channel(`sync:${userId}`).httpSend('sync_complete', {
      deviceId: payload.deviceId,
      platform: payload.platform,
      profileId: localProfileId,
      profileName: payload.profileName ?? null,
      timestamp: syncTime,
      counts: { /* existing counts */ },
    });
```

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/mobile-sync-push/index.ts
git commit -m "feat: accept profileId/profileName in sync-push, tag profile-scoped data"
```

---

## Task 3: Update `mobile-sync-pull` Edge Function

**Files:**
- Modify: `supabase/functions/mobile-sync-pull/index.ts`

- [ ] **Step 1: Accept optional `profileId` in pull request body**

```typescript
    const body = await req.json();
    const lastSync = body.lastSync ?? 0;
    const deviceId = body.deviceId ?? 'unknown';
    const profileId: string | null = body.profileId ?? null;  // NEW
```

- [ ] **Step 2: Add profile filter to profile-scoped queries**

For `workout_sessions`, `routines`, `training_cycles`, `personal_records` — add conditional filter:

```typescript
    let sessionsQuery = supabase
      .from('workout_sessions')
      .select('*, exercises(*, sets(*, rep_summaries(*)))')
      .eq('user_id', userId)
      .gte('started_at', new Date(lastSync).toISOString());

    if (profileId) {
      sessionsQuery = sessionsQuery.eq('local_profile_id', profileId);
    }

    const { data: sessions, error: sessionsError } = await sessionsQuery;
```

Apply the same conditional `.eq('local_profile_id', profileId)` to routines, cycles, and personal_records queries.

- [ ] **Step 3: Do NOT filter user-global queries**

Confirm that `earned_badges`, `rpg_attributes`, `gamification_stats` queries are NOT filtered by profile — they are user-global.

- [ ] **Step 4: Include user's local_profiles in pull response**

```typescript
    const { data: localProfiles } = await supabase
      .from('local_profiles')
      .select('id, name, color_index, device_id, created_at, updated_at')
      .eq('user_id', userId);

    return new Response(
      JSON.stringify({
        syncTime,
        sessions: sessions ?? [],
        routines: routines ?? [],
        cycles: cycles ?? [],
        // ... existing fields ...
        localProfiles: localProfiles ?? [],  // NEW
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mobile-sync-pull/index.ts
git commit -m "feat: add profile-scoped filtering to sync-pull, return local_profiles"
```

---

## Task 4: Profile Filter Zustand Store

**Files:**
- Create: `src/stores/useProfileFilterStore.ts`
- Test: `src/lib/__tests__/profileFilter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/profileFilter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useProfileFilterStore } from '@/stores/useProfileFilterStore';

describe('useProfileFilterStore', () => {
  beforeEach(() => {
    useProfileFilterStore.getState().reset();
  });

  it('defaults to null (all profiles / unfiltered)', () => {
    expect(useProfileFilterStore.getState().activeProfileId).toBeNull();
  });

  it('sets a specific profile filter', () => {
    useProfileFilterStore.getState().setActiveProfileId('profile-123');
    expect(useProfileFilterStore.getState().activeProfileId).toBe('profile-123');
  });

  it('clears the filter back to null', () => {
    useProfileFilterStore.getState().setActiveProfileId('profile-123');
    useProfileFilterStore.getState().setActiveProfileId(null);
    expect(useProfileFilterStore.getState().activeProfileId).toBeNull();
  });

  it('reset() clears the profile filter', () => {
    useProfileFilterStore.getState().setActiveProfileId('profile-123');
    useProfileFilterStore.getState().reset();
    expect(useProfileFilterStore.getState().activeProfileId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/profileFilter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store with session persistence**

```typescript
// src/stores/useProfileFilterStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ProfileFilterState {
  /** null = show all profiles (unfiltered), string = filter by this local_profile_id */
  activeProfileId: string | null;
  setActiveProfileId: (profileId: string | null) => void;
  reset: () => void;
}

export const useProfileFilterStore = create<ProfileFilterState>()(
  persist(
    (set) => ({
      activeProfileId: null,
      setActiveProfileId: (profileId) => set({ activeProfileId: profileId }),
      reset: () => set({ activeProfileId: null }),
    }),
    {
      name: 'phoenix-profile-filter',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd phoenix-portal && npx vitest run src/lib/__tests__/profileFilter.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/useProfileFilterStore.ts src/lib/__tests__/profileFilter.test.ts
git commit -m "feat: add useProfileFilterStore with session persistence"
```

---

## Task 5: Local Profiles TanStack Query Hook

**Files:**
- Create: `src/queries/localProfiles.ts`
- Modify: `src/queries/keys.ts`

- [ ] **Step 1: Add `localProfiles` key namespace**

In `src/queries/keys.ts`, add after the `profile` block:

```typescript
  localProfiles: {
    all: ["localProfiles"] as const,
    byUser: (userId: string) =>
      [...queryKeys.localProfiles.all, userId] as const,
  },
```

- [ ] **Step 2: Create query hook**

```typescript
// src/queries/localProfiles.ts
import { queryOptions } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from './keys';

export interface LocalProfile {
  id: string;
  name: string;
  color_index: number;
  device_id: string | null;
  created_at: string;
  updated_at: string;
}

export function localProfilesOptions(userId: string) {
  return queryOptions({
    queryKey: queryKeys.localProfiles.byUser(userId),
    queryFn: async (): Promise<LocalProfile[]> => {
      const { data, error } = await supabase
        .from('local_profiles')
        .select('id, name, color_index, device_id, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000, // 5 min — profiles change rarely
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/queries/localProfiles.ts src/queries/keys.ts
git commit -m "feat: add localProfiles query hook and key namespace"
```

---

## Task 6: Add Profile Filter to Portal Queries

**Files:**
- Modify: `src/queries/keys.ts` — add `profileId` param to profile-scoped keys
- Modify: `src/queries/workouts.ts` — ALL 4 query functions
- Modify: `src/queries/routines.ts`
- Modify: `src/queries/cycles.ts`
- Modify: `src/queries/records.ts`
- Modify: `src/queries/analytics.ts` — ALL 7 session-based query functions
- Modify: `src/queries/progress.ts`
- Modify: `src/queries/profile.ts` — `profileStatsOptions` and `topExercisesOptions` only (NOT badges/rpg/gamification)

### Query Key Updates

- [ ] **Step 1: Update query keys to include optional profileId**

In `src/queries/keys.ts`, update all profile-scoped key factories. Pattern:

```typescript
  workouts: {
    all: ["workouts"] as const,
    list: (userId: string, profileId?: string | null) =>
      [...queryKeys.workouts.all, "list", userId, profileId ?? "all"] as const,
    // detail, comparison keys stay unchanged — they query by session ID
    detail: (sessionId: string) =>
      [...queryKeys.workouts.all, "detail", sessionId] as const,
    comparison: (sessionAId: string, sessionBId: string) =>
      [...queryKeys.workouts.all, "comparison", sessionAId, sessionBId] as const,
  },
```

Apply to: `records.byUser`, `routines.byUser`, `cycles.byUser`, `analytics.summary`, `progress.exercises`, `progress.byExercise`, `progress.summary`, `profile.stats`, `profile.topExercises`.

**Do NOT add profileId to:** `profile.badges`, `profile.rpg`, `profile.gamification` — these are user-global.

### Workouts Queries

- [ ] **Step 2: Update `workoutListOptions`**

```typescript
export function workoutListOptions(userId: string, profileId?: string | null) {
  return queryOptions({
    queryKey: queryKeys.workouts.list(userId, profileId),
    queryFn: async () => {
      let query = supabase
        .from("workout_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(50);

      if (profileId) {
        query = query.eq("local_profile_id", profileId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}
```

- [ ] **Step 3: Update `workoutListPageOptions`**

Same pattern: add optional `profileId`, conditional `.eq()`.

- [ ] **Step 4: Update `dashboardStatsOptions`**

This queries `workout_sessions` for the past 7 days. Add profile filter:

```typescript
export function dashboardStatsOptions(userId: string, profileId?: string | null) {
  // ... existing logic, add conditional .eq("local_profile_id", profileId)
}
```

- [ ] **Step 5: Update `recentPRsOptions`**

This queries `personal_records`. Add profile filter.

### Other Query Files

- [ ] **Step 6: Update `routines.ts`**

Add optional `profileId` to routine list query.

- [ ] **Step 7: Update `cycles.ts`**

Add optional `profileId` to cycle list query.

- [ ] **Step 8: Update `records.ts`**

Add optional `profileId` to personal records query.

- [ ] **Step 9: Update `analytics.ts` — ALL session-based queries**

These queries need profile filtering. Each fetches `workout_sessions` and/or `personal_records`:

| Function | Filter Target |
|----------|---------------|
| `volumeTrendOptions` | `workout_sessions` |
| `muscleGroupOptions` | `workout_sessions` → `exercises` (filter at session stage) |
| `strengthProgressOptions` | `personal_records` |
| `volumeComparisonOptions` | `workout_sessions` |
| `formScoreTrendOptions` | `workout_sessions` |
| `safetyTrendOptions` | `workout_sessions` |
| `calorieHistoryOptions` | `workout_sessions` |

For functions with two-step queries (fetch session IDs, then fetch child records), the profile filter goes on the **session query** — child records are scoped by the session FK.

- [ ] **Step 10: Update `progress.ts`**

Add optional `profileId` to exercise progress queries. `exercise_progress` table now has `local_profile_id`.

- [ ] **Step 11: Update `profile.ts` — stats and topExercises only**

`profileStatsOptions` queries `workout_sessions` and `personal_records` → add profile filter.
`topExercisesOptions` fetches session IDs then exercises → add profile filter at session stage.

**Do NOT modify** `earnedBadgesOptions`, `rpgAttributesOptions`, `gamificationStatsOptions` — these are user-global, not profile-scoped. They continue to use `.maybeSingle()` keyed on `user_id` only.

- [ ] **Step 12: Commit**

```bash
git add src/queries/keys.ts src/queries/workouts.ts src/queries/routines.ts \
  src/queries/cycles.ts src/queries/records.ts src/queries/analytics.ts \
  src/queries/progress.ts src/queries/profile.ts
git commit -m "feat: add optional profileId filter to all profile-scoped queries"
```

---

## Task 7: Profile Filter UI Component

**Files:**
- Create: `src/app/components/LocalProfileFilter.tsx`
- Create: `src/app/components/__tests__/LocalProfileFilter.test.tsx`
- Modify: `src/app/components/AppSidebar.tsx`

- [ ] **Step 1: Write tests with properly controlled mocks**

```typescript
// src/app/components/__tests__/LocalProfileFilter.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocalProfileFilter } from '../LocalProfileFilter';
import { useProfileFilterStore } from '@/stores/useProfileFilterStore';

// Default mock returns 2 profiles
const mockProfiles = [
  { id: 'default', name: 'Default', color_index: 0, device_id: null, created_at: '', updated_at: '' },
  { id: 'profile-2', name: 'Training', color_index: 1, device_id: null, created_at: '', updated_at: '' },
];

let mockQueryReturn = { data: mockProfiles, isLoading: false };

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: () => mockQueryReturn,
  };
});

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('LocalProfileFilter', () => {
  beforeEach(() => {
    useProfileFilterStore.getState().reset();
    mockQueryReturn = { data: mockProfiles, isLoading: false };
  });

  it('renders nothing when user has 0 or 1 profiles', () => {
    mockQueryReturn = { data: [mockProfiles[0]], isLoading: false };
    const { container } = renderWithProviders(
      <LocalProfileFilter userId="test-user" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when profiles are loading', () => {
    mockQueryReturn = { data: undefined, isLoading: true };
    const { container } = renderWithProviders(
      <LocalProfileFilter userId="test-user" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders filter when user has 2+ profiles', () => {
    renderWithProviders(<LocalProfileFilter userId="test-user" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('defaults to "All Profiles" selection', () => {
    renderWithProviders(<LocalProfileFilter userId="test-user" />);
    expect(screen.getByText('All Profiles')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd phoenix-portal && npx vitest run src/app/components/__tests__/LocalProfileFilter.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `LocalProfileFilter`**

```typescript
// src/app/components/LocalProfileFilter.tsx
import { useQuery } from '@tanstack/react-query';
import { localProfilesOptions } from '@/queries/localProfiles';
import { useProfileFilterStore } from '@/stores/useProfileFilterStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';

// Profile color palette (indexes 0-7 match mobile's ProfileSidePanel color array)
const PROFILE_COLORS = [
  '#FF6B35', // Ember (0)
  '#3B82F6', // Blue (1)
  '#10B981', // Green (2)
  '#F59E0B', // Gold (3)
  '#8B5CF6', // Purple (4)
  '#EC4899', // Pink (5)
  '#14B8A6', // Teal (6)
  '#F97316', // Orange (7)
];

interface LocalProfileFilterProps {
  userId: string;
}

export function LocalProfileFilter({ userId }: LocalProfileFilterProps) {
  const { data: profiles = [], isLoading } = useQuery(localProfilesOptions(userId));
  const { activeProfileId, setActiveProfileId } = useProfileFilterStore();

  // Don't render if loading, or user has 0 or 1 profiles
  if (isLoading || profiles.length <= 1) return null;

  return (
    <div className="px-3 py-2">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
        Profile
      </label>
      <Select
        value={activeProfileId ?? 'all'}
        onValueChange={(value) =>
          setActiveProfileId(value === 'all' ? null : value)
        }
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder="All Profiles" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Profiles</SelectItem>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor:
                      PROFILE_COLORS[profile.color_index] ?? PROFILE_COLORS[0],
                  }}
                />
                {profile.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd phoenix-portal && npx vitest run src/app/components/__tests__/LocalProfileFilter.test.tsx`
Expected: PASS

- [ ] **Step 5: Mount in sidebar**

In `src/app/components/AppSidebar.tsx`, import and render below the user avatar/name:

```typescript
import { LocalProfileFilter } from './LocalProfileFilter';
// ... in the sidebar render, below the user info:
<LocalProfileFilter userId={userId} />
```

- [ ] **Step 6: Commit**

```bash
git add src/app/components/LocalProfileFilter.tsx \
  src/app/components/__tests__/LocalProfileFilter.test.tsx \
  src/app/components/AppSidebar.tsx
git commit -m "feat: add LocalProfileFilter component and mount in sidebar"
```

---

## Task 8: Wire Profile Filter into Page Components

**Files:**
- Modify: `src/app/components/Dashboard.tsx`
- Modify: `src/app/components/Analytics.tsx`
- Modify: `src/app/components/Profile.tsx`
- Modify: `src/app/components/WorkoutHistory.tsx`
- Modify: `src/app/components/Goals.tsx`
- Modify: `src/app/components/Recovery.tsx`
- Modify: `src/app/components/ExerciseProgress.tsx`
- Modify: `src/app/components/SummaryReport.tsx`

- [ ] **Step 1: Import and use profile filter in Dashboard**

```typescript
import { useProfileFilterStore } from '@/stores/useProfileFilterStore';

// Inside component:
const { activeProfileId } = useProfileFilterStore();

// Pass to all profile-scoped queries:
const { data: workouts } = useQuery(workoutListOptions(userId, activeProfileId));
const { data: stats } = useQuery(dashboardStatsOptions(userId, activeProfileId));
const { data: recentPRs } = useQuery(recentPRsOptions(userId, activeProfileId));

// Do NOT pass to badge/rpg/gamification queries — those stay user-global
```

- [ ] **Step 2: Same pattern for Analytics**

Pass `activeProfileId` to all 7 analytics query functions.

- [ ] **Step 3: Same pattern for Profile page**

Pass to `profileStatsOptions` and `topExercisesOptions` only.
Do NOT pass to `earnedBadgesOptions`, `rpgAttributesOptions`, `gamificationStatsOptions`.

- [ ] **Step 4: WorkoutHistory.tsx**

Line 42 calls `workoutListOptions(user?.id ?? "")` — add `activeProfileId` as second arg.

- [ ] **Step 5: Goals.tsx**

Lines 68-69 call `workoutListOptions` and `personalRecordsOptions` — add `activeProfileId` to both.

- [ ] **Step 6: Recovery.tsx**

Line 88 calls `workoutListOptions` — add `activeProfileId`.

- [ ] **Step 7: ExerciseProgress.tsx**

Line 31 calls `exerciseProgressOptions` — add `activeProfileId`.

- [ ] **Step 8: SummaryReport.tsx**

Line 19 calls `weeklySummaryOptions` — add `activeProfileId` (if this query reads `workout_sessions`).

- [ ] **Step 9: End-to-end verification**

Run: `cd phoenix-portal && npm run dev`
- If user has 2+ synced profiles, sidebar shows profile dropdown
- Selecting a specific profile re-filters all workout/routine/cycle data
- Selecting "All Profiles" shows everything
- Badges, RPG attributes, gamification stats remain constant regardless of profile filter

- [ ] **Step 10: Commit**

```bash
git add src/app/components/Dashboard.tsx src/app/components/Analytics.tsx \
  src/app/components/Profile.tsx src/app/components/WorkoutHistory.tsx \
  src/app/components/Goals.tsx src/app/components/Recovery.tsx \
  src/app/components/ExerciseProgress.tsx src/app/components/SummaryReport.tsx
git commit -m "feat: wire profile filter into all page components"
```

---

## Task 9: Update Portal Mutations (Routines + Cycles)

**Files:**
- Modify: `src/mutations/routines.ts`
- Modify: `src/mutations/cycles.ts`

Portal-authored routines and cycles must carry `local_profile_id` when the user has an active profile filter. Without this, portal-created content lands in "All Profiles" limbo.

- [ ] **Step 1: Update `useSaveRoutine` mutation to include `local_profile_id`**

In `src/mutations/routines.ts`, the routine insert (around line 88) currently sets `user_id` but not `local_profile_id`. Add:

```typescript
import { useProfileFilterStore } from '@/stores/useProfileFilterStore';

// Inside useSaveRoutine:
const { activeProfileId } = useProfileFilterStore.getState();

// In the insert/upsert object:
{
  user_id: userId,
  local_profile_id: activeProfileId,  // NEW — null if "All Profiles" selected
  name: routine.name,
  // ... rest unchanged
}
```

- [ ] **Step 2: Update routine query invalidation**

The `onSuccess` handler at line 160 invalidates `queryKeys.routines.byUser(user.id)`. Since the key signature now includes `profileId`, use prefix invalidation to clear all profile variants:

```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
```

- [ ] **Step 3: Update `useSaveCycle` mutation to include `local_profile_id`**

In `src/mutations/cycles.ts` (around line 63), same pattern:

```typescript
{
  user_id: userId,
  local_profile_id: activeProfileId,  // NEW
  name: cycle.name,
  // ... rest unchanged
}
```

- [ ] **Step 4: Update cycle query invalidation**

Same prefix invalidation pattern for cycles.

- [ ] **Step 5: Commit**

```bash
git add src/mutations/routines.ts src/mutations/cycles.ts
git commit -m "feat: set local_profile_id on portal-created routines and cycles"
```

---

## Task 10: Update Query Key Tests

**Files:**
- Modify: `src/queries/__tests__/workouts.test.ts`
- Modify: `src/queries/__tests__/routines.test.ts`
- Modify: `src/queries/__tests__/cycles.test.ts`
- Modify: `src/queries/__tests__/records.test.ts`
- Modify: `src/queries/__tests__/profile.test.ts`

Query key shapes changed (added optional `profileId` param). Existing test assertions on key structure will fail.

- [ ] **Step 1: Update workouts.test.ts**

Find assertions on `queryKeys.workouts.list(userId)` and update to `queryKeys.workouts.list(userId, undefined)` or verify the key now includes `"all"` as the default profile segment.

- [ ] **Step 2: Update routines.test.ts**

Same pattern for `queryKeys.routines.byUser(userId)`.

- [ ] **Step 3: Update cycles.test.ts**

Same pattern.

- [ ] **Step 4: Update records.test.ts**

Same pattern.

- [ ] **Step 5: Update profile.test.ts**

Same pattern for `queryKeys.profile.stats(userId)`, `queryKeys.profile.topExercises(userId)`.

- [ ] **Step 6: Run all query tests**

Run: `cd phoenix-portal && npx vitest run src/queries/__tests__/`
Expected: All pass with updated key assertions.

- [ ] **Step 7: Commit**

```bash
git add src/queries/__tests__/
git commit -m "test: update query key assertions for profileId parameter"
```

---

## Task 11: Update Realtime Sync Hook and Transforms

**Files:**
- Modify: `src/hooks/useRealtimeSync.ts`
- Modify: `src/schemas/transforms.ts`

- [ ] **Step 1: Ensure localProfiles cache invalidated on sync_complete**

The current hook calls `queryClient.invalidateQueries()` (full invalidation). Verify this covers `localProfiles` keys. If selective invalidation is used, add:

```typescript
queryClient.invalidateQueries({ queryKey: queryKeys.localProfiles.all });
```

- [ ] **Step 2: Add `local_profile_id` passthrough in transforms**

In `src/schemas/transforms.ts`, add to workout session, routine, cycle, and record Zod schemas:

```typescript
local_profile_id: z.string().nullable().optional(),
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRealtimeSync.ts src/schemas/transforms.ts
git commit -m "feat: ensure sync invalidates localProfiles, add profile passthrough to transforms"
```

---

## Task 12: Full Verification

- [ ] **Step 1: TypeScript type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors.

- [ ] **Step 2: Unit tests**

Run: `cd phoenix-portal && npm test`
Expected: All tests pass.

- [ ] **Step 3: Lint check**

Run: `cd phoenix-portal && npx biome check`
Expected: No lint errors.

- [ ] **Step 4: Production build**

Run: `cd phoenix-portal && npm run build`
Expected: Clean build to `/dist`.

- [ ] **Step 5: Fix any issues and commit**

```bash
git commit -m "fix: resolve type/lint issues from local profile support"
```

---

## Backward Compatibility

| Concern | Mitigation |
|---------|------------|
| Older mobile clients don't send `profileId` | `payload.profileId ?? null` defaults to null; data stored with `local_profile_id = NULL` |
| Existing Supabase data has no profile | Columns are nullable; queries use conditional `.eq()` only when `profileId` is non-null |
| User-global tables unchanged | Badges, RPG, gamification, signatures keep existing upsert conflict keys |
| Portal users with 0 or 1 profiles | `LocalProfileFilter` renders nothing — zero UI impact |
| Profile deleted on mobile | FK `ON DELETE SET NULL` nullifies references; `allProfiles` snapshot removes stale rows |
| Same profile ID ("default") across users | Composite PK `(user_id, id)` prevents collisions |
| Portal-created routines/cycles | Tagged with `activeProfileId` from Zustand store; null if "All Profiles" |
| Query key shape change | Existing tests updated in Task 10; mutation invalidations use prefix matching |

## Migration Strategy for Existing Data

1. **Leave as-is** (recommended): "All Profiles" view shows everything including legacy data with `local_profile_id = NULL`.
2. **Mobile re-sync**: When mobile ships profile support, the next full sync tags data correctly. Requires mobile "full re-sync" option.
3. **Backfill "default"**: One-time `UPDATE ... SET local_profile_id = 'default' WHERE local_profile_id IS NULL` — only safe if all users started with default profile.

Option 1 for initial deployment. Option 2 is the eventual correct state.

## Excluded from Scope (Intentional)

| Item | Reason |
|------|--------|
| `insights` queries | Generated by Edge Function, aggregates user data; revisit when insights become profile-aware |
| `benchmarks` queries | Community-wide aggregation; not user-scoped |
| `session_phase_statistics` | Scoped through session FK; profile filter on sessions implicitly filters phase stats |
| `rep_telemetry`, `rep_summaries`, `sets`, `exercises` | Child records of sessions; scoped through session FK cascade |
