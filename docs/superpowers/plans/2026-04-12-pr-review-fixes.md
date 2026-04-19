# PR Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 13 verified bugs and code quality issues from automated PR review on feat/portal-ux-redesign branch.

**Architecture:** Fixes span three areas: (1) compute-rankings Edge Function ranking logic, (2) mutation security/redundancy, (3) client-side date handling and cleanup. All fixes are isolated — no architectural changes.

**Tech Stack:** TypeScript, Supabase Edge Functions (Deno), React, TanStack Query

---

## File Structure

| File | Changes |
|------|---------|
| `supabase/functions/compute-rankings/index.ts` | Fix 7 ranking bugs |
| `src/mutations/routines.ts` | Remove redundant cascade delete |
| `src/mutations/cycles.ts` | Remove redundant cascade delete |
| `src/queries/leaderboard.ts` | Fix query key/body mismatch |
| `src/app/components/Leaderboard.tsx` | Remove unused prop |
| `src/app/components/CalendarWidget.tsx` | Fix month navigation overflow |

---

## Task 1: Fix Zero-PR Users Ranking Bug

**Files:**
- Modify: `supabase/functions/compute-rankings/index.ts:516-533`

**Problem:** Users with 0 PRs are assigned `rank: totalUsers` (dead last), but many users may have 0 PRs and should share a tied rank.

- [ ] **Step 1: Locate the fallback logic**

Current code at lines 516-533:
```typescript
  if (prRank && prRank.length > 0) {
    const pr = prRank[0];
    rankings.push({
      metric: 'prCount',
      rank: pr.rank,
      value: pr.pr_count,
      percentile: calculatePercentile(pr.rank, totalUsers),
      totalUsers,
    });
  } else {
    rankings.push({
      metric: 'prCount',
      rank: totalUsers,  // BUG: All 0-PR users get last place
      value: 0,
      percentile: 0,
      totalUsers,
    });
  }
```

- [ ] **Step 2: Fix the fallback to calculate proper rank**

Replace lines 525-533 with:
```typescript
  } else {
    // User has 0 PRs. Get count of users with >0 PRs from RPC (already called for global rankings)
    const { data: allPrUsers } = await supabase.rpc('get_pr_count_rankings', {
      result_limit: totalUsers,
    });
    // All 0-PR users are tied at rank = (users with PRs) + 1
    const usersWithPRs = (allPrUsers ?? []).length;
    const zeroRank = usersWithPRs + 1;
    
    rankings.push({
      metric: 'prCount',
      rank: zeroRank,
      value: 0,
      percentile: calculatePercentile(zeroRank, totalUsers),
      totalUsers,
    });
  }
```

- [ ] **Step 3: Verify Edge Function still deploys**

Run: `cd supabase/functions && deno check compute-rankings/index.ts`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git commit -m "fix(leaderboard): correct rank calculation for users with zero PRs"
```

---

## Task 2: Fix Zero-Mastery Users Ranking Bug

**Files:**
- Modify: `supabase/functions/compute-rankings/index.ts:548-562`

**Problem:** Same pattern as Task 1 — users with 0 mastered exercises get `rank: totalUsers` instead of tied rank.

- [ ] **Step 1: Locate the mastery ranking logic**

Current code at lines 548-562:
```typescript
  const { data: allMasteryData } = await supabase.rpc('get_exercise_mastery_rankings', {
    result_limit: totalUsers,
  });

  const masteryValues = (allMasteryData ?? []).map(m => m.mastered_count);
  const masteryRank = masteredCount > 0 ? calculateRank(masteredCount, masteryValues) : totalUsers;

  rankings.push({
    metric: 'exerciseMastery',
    rank: masteryRank,
    value: masteredCount,
    percentile: calculatePercentile(masteryRank, totalUsers),
    totalUsers,
  });
```

- [ ] **Step 2: Fix the fallback calculation**

Replace lines 553-554 with:
```typescript
  const masteryValues = (allMasteryData ?? []).map(m => m.mastered_count);
  // Users with 0 mastery rank after all users with positive mastery
  const usersWithMastery = masteryValues.length;
  const masteryRank = masteredCount > 0 
    ? calculateRank(masteredCount, masteryValues) 
    : usersWithMastery + 1;
```

- [ ] **Step 3: Verify Edge Function still deploys**

Run: `cd supabase/functions && deno check compute-rankings/index.ts`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git commit -m "fix(leaderboard): correct rank calculation for users with zero mastery"
```

---

## Task 3: Preserve SQL RANK() Ties in RPC Results

**Files:**
- Modify: `supabase/functions/compute-rankings/index.ts:597-616`

**Problem:** `buildRankingsFromRpc` ignores the `rank` field from SQL and uses `index + 1`, breaking tie handling.

- [ ] **Step 1: Locate buildRankingsFromRpc function**

Current code at lines 597-616:
```typescript
function buildRankingsFromRpc(
  rpcResults: Array<{ user_id: string; [key: string]: unknown }>,
  profilesMap: Map<string, { id: string; display_name: string | null; avatar_url: string | null; user_id: string | null }>,
  totalEligible: number
): LeaderboardEntry[] {
  // RPC results are already ordered and limited
  // Get the value field (pr_count or mastered_count)
  return rpcResults.map((result, index) => {
    const profile = profilesMap.get(result.user_id);
    const value = (result.pr_count ?? result.mastered_count ?? 0) as number;
    return {
      userId: result.user_id,
      displayName: profile?.display_name ?? 'Anonymous',
      avatarUrl: profile?.avatar_url ?? null,
      rank: index + 1,  // BUG: Ignores SQL RANK()
      value,
      percentile: calculatePercentile(index + 1, totalEligible),
    };
  });
}
```

- [ ] **Step 2: Use the RPC-provided rank**

Replace the function with:
```typescript
function buildRankingsFromRpc(
  rpcResults: Array<{ user_id: string; rank?: number; [key: string]: unknown }>,
  profilesMap: Map<string, { id: string; display_name: string | null; avatar_url: string | null; user_id: string | null }>,
  totalEligible: number
): LeaderboardEntry[] {
  return rpcResults.map((result) => {
    const profile = profilesMap.get(result.user_id);
    const value = (result.pr_count ?? result.mastered_count ?? 0) as number;
    // Use SQL RANK() from RPC, preserving ties
    const rank = (result.rank as number) ?? 1;
    return {
      userId: result.user_id,
      displayName: profile?.display_name ?? 'Anonymous',
      avatarUrl: profile?.avatar_url ?? null,
      rank,
      value,
      percentile: calculatePercentile(rank, totalEligible),
    };
  });
}
```

- [ ] **Step 3: Verify Edge Function still deploys**

Run: `cd supabase/functions && deno check compute-rankings/index.ts`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git commit -m "fix(leaderboard): preserve SQL RANK() ties in RPC results"
```

---

## Task 4: Fix Weekly Metric Rotation Off-by-One

**Files:**
- Modify: `supabase/functions/compute-rankings/index.ts:76-84`

**Problem:** `weekNumber % WEEKLY_METRICS.length` makes week 1 map to index 1, skipping the first metric.

- [ ] **Step 1: Locate getWeeklyMetric function**

Current code at lines 76-84:
```typescript
function getWeeklyMetric(weekStart: string): { metric: string; label: string } {
  // Get week number of the year for rotation
  const date = new Date(weekStart);
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  const metricIndex = weekNumber % WEEKLY_METRICS.length;  // BUG: Off by one
  return WEEKLY_METRICS[metricIndex];
}
```

- [ ] **Step 2: Fix the index calculation**

Replace line 82 with:
```typescript
  const metricIndex = (weekNumber - 1) % WEEKLY_METRICS.length;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git commit -m "fix(leaderboard): correct weekly metric rotation index"
```

---

## Task 5: Handle Supabase Query Errors in computeGlobalRankings

**Files:**
- Modify: `supabase/functions/compute-rankings/index.ts:215-244`

**Problem:** Database queries only capture `data`, ignoring `error`. Silent failures return empty rankings.

- [ ] **Step 1: Locate the queries in computeGlobalRankings**

Current code at lines 215-221:
```typescript
  // Get eligible users (leaderboard_participation = true)
  const { data: eligibleProfiles } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, user_id')
    .eq('leaderboard_participation', true);
```

- [ ] **Step 2: Add error handling to all queries**

Replace lines 215-244 with:
```typescript
  // Get eligible users (leaderboard_participation = true)
  const { data: eligibleProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, user_id')
    .eq('leaderboard_participation', true);

  if (profilesError) {
    console.error('Failed to fetch profiles:', profilesError);
    throw new Error('Failed to fetch leaderboard profiles');
  }

  const eligibleUserIds = (eligibleProfiles ?? []).map(p => p.user_id).filter(Boolean) as string[];
  const profilesByUserId = new Map(
    (eligibleProfiles ?? []).map(p => [p.user_id, p])
  );

  if (eligibleUserIds.length === 0) {
    return {
      totalVolume: [],
      workoutCount: [],
      longestStreak: [],
      currentStreak: [],
      prCount: [],
      exerciseMastery: [],
    };
  }

  // Query gamification_stats for volume, workouts, streaks
  const { data: stats, error: statsError } = await supabase
    .from('gamification_stats')
    .select('user_id, total_volume_kg, total_workouts, longest_streak, current_streak')
    .in('user_id', eligibleUserIds);

  if (statsError) {
    console.error('Failed to fetch gamification stats:', statsError);
    throw new Error('Failed to fetch leaderboard stats');
  }
```

- [ ] **Step 3: Also fix the RPC calls (lines 246-253)**

Replace:
```typescript
  // Query PR counts via database function
  const { data: prRankings, error: prError } = await supabase.rpc('get_pr_count_rankings', {
    result_limit: LIMIT,
  });

  if (prError) {
    console.error('Failed to fetch PR rankings:', prError);
    throw new Error('Failed to compute PR rankings');
  }

  // Query exercise mastery via database function
  const { data: masteryRankings, error: masteryError } = await supabase.rpc('get_exercise_mastery_rankings', {
    result_limit: LIMIT,
  });

  if (masteryError) {
    console.error('Failed to fetch mastery rankings:', masteryError);
    throw new Error('Failed to compute mastery rankings');
  }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git commit -m "fix(leaderboard): handle database query errors in global rankings"
```

---

## Task 6: Add Ordering to Weekly Event Lookup

**Files:**
- Modify: `supabase/functions/compute-rankings/index.ts:322-330`

**Problem:** `.limit(1)` without `.order()` returns arbitrary event when multiple overlap.

- [ ] **Step 1: Locate the event query**

Current code at lines 322-329:
```typescript
  // Check for special events
  const { data: events } = await supabase
    .from('leaderboard_events')
    .select('id, name, metric, metric_label, start_date, end_date')
    .lte('start_date', end)
    .gte('end_date', start)
    .eq('is_active', true)
    .limit(1);
```

- [ ] **Step 2: Add deterministic ordering**

Replace with:
```typescript
  // Check for special events (prefer most recently started if overlapping)
  const { data: events, error: eventsError } = await supabase
    .from('leaderboard_events')
    .select('id, name, metric, metric_label, start_date, end_date')
    .lte('start_date', end)
    .gte('end_date', start)
    .eq('is_active', true)
    .order('start_date', { ascending: false })
    .limit(1);

  if (eventsError) {
    console.error('Failed to fetch leaderboard events:', eventsError);
    // Non-fatal: fall back to normal metric rotation
  }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git commit -m "fix(leaderboard): add deterministic ordering to weekly event lookup"
```

---

## Task 7: Fix Exercise Mastery Calculation in computeUserRankings

**Files:**
- Modify: `supabase/functions/compute-rankings/index.ts:535-546`

**Problem:** Local calculation counts exercise rows, but should count distinct sessions per exercise (matching the RPC logic).

- [ ] **Step 1: Locate the mastery calculation**

Current code at lines 535-546:
```typescript
  // Count distinct exercises with 10+ sessions for the user
  const { data: masteryData } = await supabase
    .from('exercises')
    .select('name')
    .eq('user_id', targetUserId);

  const exerciseCounts = new Map<string, number>();
  for (const ex of masteryData ?? []) {
    exerciseCounts.set(ex.name, (exerciseCounts.get(ex.name) ?? 0) + 1);
  }
  const masteredCount = [...exerciseCounts.values()].filter(c => c >= 10).length;
```

- [ ] **Step 2: Fix to count distinct sessions**

Replace with:
```typescript
  // Count distinct exercises with 10+ sessions for the user
  // Must match RPC logic: COUNT(DISTINCT session_id) >= 10
  const { data: masteryData, error: masteryQueryError } = await supabase
    .from('exercises')
    .select('name, session_id')
    .eq('user_id', targetUserId);

  if (masteryQueryError) {
    console.error('Failed to fetch user exercise data:', masteryQueryError);
  }

  // Group by exercise name, count distinct sessions
  const exerciseSessionMap = new Map<string, Set<string>>();
  for (const ex of masteryData ?? []) {
    if (!exerciseSessionMap.has(ex.name)) {
      exerciseSessionMap.set(ex.name, new Set());
    }
    exerciseSessionMap.get(ex.name)!.add(ex.session_id);
  }
  const masteredCount = [...exerciseSessionMap.values()].filter(sessions => sessions.size >= 10).length;
```

- [ ] **Step 3: Verify Edge Function still deploys**

Run: `cd supabase/functions && deno check compute-rankings/index.ts`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-rankings/index.ts
git commit -m "fix(leaderboard): count distinct sessions for exercise mastery"
```

---

## Task 8: Remove Redundant routine_exercises Delete

**Files:**
- Modify: `src/mutations/routines.ts:231-269`

**Problem:** Schema has `ON DELETE CASCADE` on `routine_exercises.routine_id`. Pre-deleting exercises is redundant and creates a security risk (exercises deleted even if routine delete fails ownership check).

- [ ] **Step 1: Locate useDeleteRoutine**

Current code at lines 231-269:
```typescript
export function useDeleteRoutine() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (routineId: string) => {
			if (!user) throw new Error("Must be logged in to delete routines");

			// Delete routine_exercises first (FK constraint)
			const { error: exError } = await supabase
				.from("routine_exercises")
				.delete()
				.eq("routine_id", routineId);

			if (exError) throw exError;

			// Delete the routine
			const { error: routineError } = await supabase
				.from("routines")
				.delete()
				.eq("id", routineId)
				.eq("user_id", user.id);

			if (routineError) throw routineError;

			return { id: routineId };
		},
		// ...
	});
}
```

- [ ] **Step 2: Simplify to rely on CASCADE**

Replace lines 235-257 with:
```typescript
		mutationFn: async (routineId: string) => {
			if (!user) throw new Error("Must be logged in to delete routines");

			// Delete the routine (CASCADE handles routine_exercises)
			const { error: routineError } = await supabase
				.from("routines")
				.delete()
				.eq("id", routineId)
				.eq("user_id", user.id);

			if (routineError) throw routineError;

			return { id: routineId };
		},
```

- [ ] **Step 3: Run type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/mutations/routines.ts
git commit -m "fix(routines): rely on CASCADE for exercise deletion, remove security risk"
```

---

## Task 9: Remove Redundant cycle_days Delete

**Files:**
- Modify: `src/mutations/cycles.ts:188-226`

**Problem:** Same pattern as Task 8 — `cycle_days` has `ON DELETE CASCADE`.

- [ ] **Step 1: Locate useDeleteCycle**

Current code at lines 188-226:
```typescript
export function useDeleteCycle() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (cycleId: string) => {
			if (!user) throw new Error("Must be logged in to delete cycles");

			// Delete cycle_days first (FK constraint)
			const { error: daysError } = await supabase
				.from("cycle_days")
				.delete()
				.eq("cycle_id", cycleId);

			if (daysError) throw daysError;

			// Delete the cycle
			const { error: cycleError } = await supabase
				.from("training_cycles")
				.delete()
				.eq("id", cycleId)
				.eq("user_id", user.id);

			if (cycleError) throw cycleError;

			return { id: cycleId };
		},
		// ...
	});
}
```

- [ ] **Step 2: Simplify to rely on CASCADE**

Replace lines 192-214 with:
```typescript
		mutationFn: async (cycleId: string) => {
			if (!user) throw new Error("Must be logged in to delete cycles");

			// Delete the cycle (CASCADE handles cycle_days)
			const { error: cycleError } = await supabase
				.from("training_cycles")
				.delete()
				.eq("id", cycleId)
				.eq("user_id", user.id);

			if (cycleError) throw cycleError;

			return { id: cycleId };
		},
```

- [ ] **Step 3: Run type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/mutations/cycles.ts
git commit -m "fix(cycles): rely on CASCADE for days deletion, remove security risk"
```

---

## Task 10: Fix Query Key / Request Body weekStart Mismatch

**Files:**
- Modify: `src/queries/leaderboard.ts:59-76`

**Problem:** Query key uses `weekStart ?? getCurrentWeekStart()` but request body sends `weekStart` as-is (potentially undefined). Cache key won't match if server computes different default.

- [ ] **Step 1: Locate weeklyCompetitionOptions**

Current code at lines 59-76:
```typescript
export const weeklyCompetitionOptions = (weekStart?: string) =>
  queryOptions({
    queryKey: queryKeys.leaderboard.weekly(
      weekStart ?? getCurrentWeekStart()
    ),
    queryFn: async (): Promise<WeeklyCompetition> => {
      const { data, error } = await supabase.functions.invoke(
        "compute-rankings",
        {
          body: { type: "weekly", weekStart },
        }
      );

      if (error) throw error;
      return data as WeeklyCompetition;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
```

- [ ] **Step 2: Normalize weekStart before use**

Replace with:
```typescript
export const weeklyCompetitionOptions = (weekStart?: string) => {
  // Normalize to ensure query key and request body use same value
  const normalizedWeekStart = weekStart ?? getCurrentWeekStart();
  
  return queryOptions({
    queryKey: queryKeys.leaderboard.weekly(normalizedWeekStart),
    queryFn: async (): Promise<WeeklyCompetition> => {
      const { data, error } = await supabase.functions.invoke(
        "compute-rankings",
        {
          body: { type: "weekly", weekStart: normalizedWeekStart },
        }
      );

      if (error) throw error;
      return data as WeeklyCompetition;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};
```

- [ ] **Step 3: Run type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/queries/leaderboard.ts
git commit -m "fix(leaderboard): ensure query key matches request body for weekly competition"
```

---

## Task 11: Remove Unused userRankings Prop from GlobalRankings

**Files:**
- Modify: `src/app/components/Leaderboard.tsx:213-225`

**Problem:** `userRankings` prop is passed but never used inside the component.

- [ ] **Step 1: Locate GlobalRankings interface and component**

Current code at lines 213-225:
```typescript
interface GlobalRankingsProps {
    data: GlobalLeaderboard | undefined;
    isLoading: boolean;
    currentUserId: string | undefined;
    userRankings: UserRanking[] | undefined;
}

function GlobalRankings({
    data,
    isLoading,
    currentUserId,
    userRankings,
}: GlobalRankingsProps) {
```

- [ ] **Step 2: Remove unused prop from interface and destructure**

Replace with:
```typescript
interface GlobalRankingsProps {
    data: GlobalLeaderboard | undefined;
    isLoading: boolean;
    currentUserId: string | undefined;
}

function GlobalRankings({
    data,
    isLoading,
    currentUserId,
}: GlobalRankingsProps) {
```

- [ ] **Step 3: Update the call site (around line 605)**

Find:
```typescript
<GlobalRankings
    data={globalData}
    isLoading={globalLoading}
    currentUserId={user?.id}
    userRankings={userRankings}
/>
```

Replace with:
```typescript
<GlobalRankings
    data={globalData}
    isLoading={globalLoading}
    currentUserId={user?.id}
/>
```

- [ ] **Step 4: Run type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Leaderboard.tsx
git commit -m "refactor(leaderboard): remove unused userRankings prop from GlobalRankings"
```

---

## Task 12: Fix CalendarWidget Month Navigation Overflow

**Files:**
- Modify: `src/app/components/CalendarWidget.tsx:42-46`

**Problem:** Navigating from dates like Jan 31 can overflow — `setMonth(0 + 1)` on Jan 31 yields March 3 (Feb doesn't have 31 days).

- [ ] **Step 1: Locate navigateMonth function**

Current code at lines 42-46:
```typescript
  const navigateMonth = (direction: "prev" | "next") => {
    const newDate = new Date(currentMonth);
    newDate.setMonth(newDate.getMonth() + (direction === "prev" ? -1 : 1));
    onMonthChange(newDate);
  };
```

- [ ] **Step 2: Fix by setting day to 1 before changing month**

Replace with:
```typescript
  const navigateMonth = (direction: "prev" | "next") => {
    // Set day to 1 first to avoid month overflow (e.g., Jan 31 + 1 month = Mar 3)
    const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    newDate.setMonth(newDate.getMonth() + (direction === "prev" ? -1 : 1));
    onMonthChange(newDate);
  };
```

- [ ] **Step 3: Run type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/components/CalendarWidget.tsx
git commit -m "fix(calendar): prevent month navigation overflow on end-of-month dates"
```

---

## Task 13: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run full type check**

Run: `cd phoenix-portal && npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run linter**

Run: `cd phoenix-portal && npx biome check src/ supabase/`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 3: Run tests**

Run: `cd phoenix-portal && npm test`
Expected: All tests pass

- [ ] **Step 4: Verify Edge Function syntax**

Run: `cd phoenix-portal/supabase/functions && deno check compute-rankings/index.ts`
Expected: No type errors

- [ ] **Step 5: Create summary commit if needed**

If all individual commits succeeded, push to remote:
```bash
git push origin feat/portal-ux-redesign
```

---

## Summary

| Task | Issue | Files |
|------|-------|-------|
| 1 | Zero-PR users ranking | compute-rankings/index.ts |
| 2 | Zero-mastery users ranking | compute-rankings/index.ts |
| 3 | RPC rank ties lost | compute-rankings/index.ts |
| 4 | Weekly metric off-by-one | compute-rankings/index.ts |
| 5 | Query errors ignored | compute-rankings/index.ts |
| 6 | Event lookup ordering | compute-rankings/index.ts |
| 7 | Mastery session count | compute-rankings/index.ts |
| 8 | Routine delete cascade | mutations/routines.ts |
| 9 | Cycle delete cascade | mutations/cycles.ts |
| 10 | Query key mismatch | queries/leaderboard.ts |
| 11 | Unused prop | Leaderboard.tsx |
| 12 | Month navigation | CalendarWidget.tsx |
| 13 | Final verification | All |
