# Phoenix Portal UX Redesign

**Date:** 2026-04-12  
**Status:** Approved  
**Scope:** Web portal only (phoenix-portal). Mobile app changes limited to sync handling.

## Summary

Five changes to align the web portal's purpose as a library/community tool rather than a workout execution platform:

1. **Remove cycle activation** — Portal becomes read-only for active state
2. **Add delete functionality** — Routines and cycles can be deleted with sync propagation
3. **Redesign leaderboard** — True competitive rankings replacing misplaced personal records
4. **Redesign workouts tab** — List-first layout with compact calendar widget
5. **Remove celebration popups** — Broken UX removed entirely

---

## 1. Cycle Activation Removal

### Current State
- Portal shows "ACTIVE CYCLE" badge and progress tracking
- Users can see cycle execution state (Week X of Y, % complete)

### Target State
- Remove all activation/deactivation controls
- Display **read-only** "Active on mobile" badge for cycles currently active on user's device
- Remove progress bar and week tracking (mobile-execution context)
- Cycles display as library items: name, duration, workout/rest counts, Edit button
- Status shows only "DRAFT" or "Active on mobile"

### Files Affected
- `src/app/components/TrainingCycles.tsx` — Remove activation logic, simplify card display
- `src/mutations/cycles.ts` — Remove activation mutation if present

---

## 2. Delete Functionality

### Behavior
- **Hard delete** — Row removed from database permanently
- **Historical preservation** — Workout sessions retain routine/cycle name as snapshot field

### Confirmation Dialog
```
Delete "[Name]"?

This will permanently delete this [routine/cycle] and remove it from 
your mobile app on the next sync.

If this cycle is currently active on your mobile app, it will be deactivated.

Your workout history will be preserved.

[Cancel]  [Delete]
```

### Sync Implications
- Mobile's next pull sync receives deletion
- Active cycle on mobile → deactivates and removes
- Workout history on both platforms retains routine/cycle name snapshot

### UI Placement
- Add "Delete" to kebab menu (⋮) on routine/cycle cards
- Destructive red styling for delete action

### Files Affected
- `src/mutations/routines.ts` — Add `useDeleteRoutine()`
- `src/mutations/cycles.ts` — Add `useDeleteCycle()`
- `src/app/components/RoutinesEnhanced.tsx` — Add delete to card menu
- `src/app/components/TrainingCycles.tsx` — Add delete to card menu
- New or existing confirmation dialog component
- `supabase/functions/mobile-sync-pull/index.ts` — Handle deleted records

### Database Consideration
- Verify `workout_sessions` has `routine_name`/`cycle_name` text fields for snapshot preservation
- If not, add migration to store name at workout completion time

---

## 3. Leaderboard Redesign

### Current State
- `/records` route shows PersonalRecords (user's own PRs)
- Sidebar labels it "Leaderboard" but content is not competitive
- `CommunityRankings` component exists but renders empty

### Target State
True competitive leaderboard with two sections:

#### Global All-Time Rankings
| Metric | Description |
|--------|-------------|
| Total Volume | Lifetime weight lifted |
| Workout Count | Total sessions completed |
| Longest Streak | Most consecutive workout days |
| Current Streak | Active streak |
| PR Count | Total personal records set |
| Exercise Mastery | Exercises with 10+ sessions |

Display: User sees their rank, percentile, and surrounding competitors.

#### Weekly/Monthly Competitions
- **Automated rotation:** System picks metric each week
- **Special events:** Admin-curated challenges can override
- Leaderboard resets at period end

#### Privacy
- Opt-out toggle in Profile: "Hide me from leaderboards"
- Opted-out users don't appear but can view

#### Personal Records Relocation
- Move entirely to **Analytics** tab
- Leaderboard becomes purely competitive

### Files Affected
- `src/app/components/CommunityRankings.tsx` — Populate with real data
- `src/app/components/PersonalRecords.tsx` — Relocate to Analytics
- `src/app/components/analytics/` — Integrate PR display
- New: `src/queries/leaderboard.ts` — Leaderboard data queries
- New: Edge Function for ranking computation (scheduled job)
- `src/app/components/Profile.tsx` or settings — Add opt-out toggle
- Database: `leaderboard_rankings` table or computed views
- Sidebar navigation update

---

## 4. Workouts Tab Redesign

### Current State
- Full-page calendar dominates view
- List view exists as toggle alternative
- Calendar shows intensity-colored days, PR indicators

### Target State
List-first layout with compact calendar widget in sidebar.

#### Layout (Desktop)
```
┌─────────────────────────────────────────────────────────────┐
│  Workouts                              [Filter ▾] [Range ▾] │
├──────────────────────────────────┬──────────────────────────┤
│                                  │  ┌──────────────────┐    │
│  WORKOUT HISTORY LIST            │  │   April 2026     │    │
│                                  │  │ < [calendar] >   │    │
│  ┌─────────────────────────┐     │  │  Su Mo Tu We ... │    │
│  │ Apr 11 · Push Day       │     │  │  ·  ·  1  2  3   │    │
│  │ 45 min · 12,400 kg      │     │  │  ●  ○  ●  ·  ·   │    │
│  │ 3 PRs                   │     │  └──────────────────┘    │
│  └─────────────────────────┘     │                          │
│                                  │  Quick Stats             │
│  ┌─────────────────────────┐     │  This week: 3 workouts   │
│  │ Apr 9 · Full Body       │     │  Streak: 12 days         │
│  │ 52 min · 18,200 kg      │     │  Monthly volume: 84,000  │
│  └─────────────────────────┘     │                          │
│                                  │                          │
│  [Load more...]                  │                          │
└──────────────────────────────────┴──────────────────────────┘
```

#### Behavior
- **List (main area):** Paginated workout history, click to expand
- **Calendar widget (sidebar):** Compact month view, dots for workout days, click date to filter list
- **Quick stats (sidebar):** Week count, streak, monthly volume
- **Filters:** Date range, routine, workout mode
- **Mobile:** Calendar widget collapses to week strip or hides behind toggle

### Files Affected
- `src/app/components/WorkoutHistory.tsx` — Major refactor
- New: `src/app/components/CalendarWidget.tsx`
- New: `src/app/components/WorkoutQuickStats.tsx`
- Responsive breakpoints for mobile

---

## 5. Celebration Popup Removal

### Current Issues
- Shows wrong units (kg despite user's lbs preference)
- Random/unpredictable trigger timing
- Poor visual design
- Dismissal broken (screen stays blurred)

### Target State
Remove entirely.

### Removal Scope
- Delete celebration popup component(s)
- Remove trigger logic
- Remove blur overlay
- Clean up related state (Zustand fields, etc.)

### What Stays
- Toast notifications for routine actions (functional feedback)
- In-line success indicators

### Future
Celebrations can be revisited with proper design:
- Correct unit handling
- Clear trigger rules
- Tasteful, dismissible UI

But out of scope for this work.

### Files to Investigate
- Search for celebration/confetti/achievement components
- Check blur overlay tied to celebrations
- Remove imports and state management

---

## Implementation Order (Suggested)

1. **Celebration popup removal** — Quick win, removes broken UX
2. **Cycle activation removal** — Straightforward UI cleanup
3. **Delete functionality** — Moderate scope, requires sync handling
4. **Workouts tab redesign** — UI refactor, isolated to one route
5. **Leaderboard redesign** — Largest scope, requires new Edge Function and data pipeline

---

## Sync Contract Changes

### mobile-sync-pull Updates
- Must handle deleted routines/cycles
- Return deletion markers or tombstones for mobile to process
- Mobile deactivates active cycle if deleted

### Database Changes
- Verify/add `routine_name`, `cycle_name` snapshot fields on `workout_sessions`
- Add `leaderboard_opt_out` boolean to user profile
- Leaderboard ranking tables/views (design TBD during implementation)

---

## Out of Scope

- Mobile app UI changes (beyond sync handling)
- Celebration popup redesign (deferred)
- Exercise-specific leaderboards (future enhancement)
- Admin UI for curating special leaderboard events (can use direct DB for MVP)
