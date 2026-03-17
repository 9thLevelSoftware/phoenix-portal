# Portal Critical Fixes — Design Spec

**Date:** 2026-03-17
**Scope:** 8 reported issues across unit conversion, routines, analytics, cycles, community, settings, and challenges

## Problem Statement

The Phoenix Portal has 8 significant issues affecting core functionality:

1. Unit preference (kg/lbs) saves but never converts displayed values
2. Routines can only be edited or created — no view-only mode
3. Routine builder lacks polish (missing labels) and exercise type coverage (bodyweight, duration, AMRAP, supersets, advanced settings)
4. Analytics Hub is bare-bones while fully-built advanced charts (ROM, VBT, power, force, asymmetry) are orphaned in an inaccessible Biomechanics page
5. Training cycles have zero data in the database — empty state is ungraceful
6. Community tab returns 400 error due to missing FK relationship between `shared_routines` and `profiles`
7. Settings tab is actually Integrations — mislabeled in navigation
8. Joined challenges don't appear on the dashboard (hardcoded placeholder)

## Implementation Waves

### Wave 1: Quick Wins (Issues 6, 7, 8)

#### Issue 6: Community 400 Error

**Root cause:** `shared_routines.user_id` has a FK to `auth.users(id)` but the PostgREST query requests `profiles(display_name, avatar_url)`. There is no direct FK from `shared_routines` to `profiles`, so PostgREST returns 400.

**Fix:**
- Migration: replace the `shared_routines.user_id` FK from `auth.users(id)` to `profiles(id)`. Since `profiles.id` itself FKs to `auth.users(id)` with CASCADE, referential integrity is preserved.
- Same fix for `shared_cycles.user_id`.
- Add proper empty state to Community page for when tables have zero rows — explanatory message with CTA to share first routine.

**Files:**
- New migration in `supabase/migrations/`
- `src/app/components/Community.tsx` — add empty state

#### Issue 7: Settings → Integrations Rename

**Fix:** Rename "Settings" nav item to "Integrations" in both navigation components. Route stays `/integrations`.

**Files:**
- `src/app/components/AppSidebar.tsx` — rename label
- `src/app/components/MobileBottomNav.tsx` — rename label

#### Issue 8: Challenges on Dashboard

**Root cause:** `Dashboard.tsx` has a hardcoded "No active challenges yet" placeholder at lines 1111-1133. The `userChallengesOptions()` query hook exists in `src/queries/challenges.ts` but is never called from the dashboard.

**Fix:**
- Query `userChallengesOptions(userId)` in the dashboard's active challenges section
- Display joined challenges with name, progress indicator, and time remaining
- If no joined challenges, show CTA linking to `/challenges`

**Files:**
- `src/app/components/Dashboard.tsx` — replace placeholder with query + display

---

### Wave 2: Unit Conversion (Issue 1)

#### Architecture

**All data stays in kg in the database.** Conversion is display-only at render time. User inputs in lbs are converted to kg before persisting.

**New files:**
- `src/lib/units.ts` — Conversion utility
  - `KG_TO_LBS = 2.20462`
  - `convertWeight(valueKg: number, unit: 'kg' | 'lbs'): number`
  - `formatWeight(valueKg: number, unit: 'kg' | 'lbs'): string` — includes rounding (1 decimal for lbs, whole for kg)
  - `toKg(valueLbs: number): number` — for input conversion on save
- `src/providers/WeightUnitProvider.tsx` — React context
  - Reads `weight_unit` from the user's profile query (already cached by TanStack Query)
  - Exposes `{ unit, convertWeight, formatWeight }` via `useWeightUnit()` hook
  - Defaults to `kg` for unauthenticated users

**Components to update:**

| Component | Changes |
|-----------|---------|
| `SessionDetail.tsx` | Replace `{set.weight_kg} kg` with `formatWeight(set.weight_kg)` |
| `Analytics.tsx` | Chart axis labels, tooltips, summary cards |
| `WorkoutHistory.tsx` | Total volume display, workout card weights |
| `ExerciseProgress.tsx` | Chart labels ("Max Weight", "Volume", "Est. 1RM"), tooltips |
| `Profile.tsx` | Stats summary volume display; remove the "coming soon" TODO |
| `RoutineBuilder.tsx` | Normalize to use shared context instead of local weight_unit logic |
| `Dashboard.tsx` | Weight/volume summary cards |
| `csv.ts` (export) | Header labels and exported values |

**Edge cases:**
- Unauthenticated users: default to kg
- Null/zero weights: display as-is
- Rounding: 1 decimal for lbs (e.g., 135.0 lbs), whole numbers for kg
- Input fields: show/accept user's unit, convert to kg on save

---

### Wave 3: Routines (Issues 2, 3)

#### Issue 2: Routine View Mode

**New component:** `RoutineDetail.tsx`

**Route:** `/routines/:id/view`

**Displays:**
- Routine name, description, metadata (exercise count, estimated duration, last used)
- Exercise list in order: name, muscle group badge, sets/reps/weight (user's unit), rest time, training mode
- Superset groupings with visual indicators
- Advanced settings as tags/badges (AMRAP, bodyweight, eccentric, etc.)
- "Edit" button navigating to `/routines/:id`
- Responsive mobile layout

**Wiring:** Fix the View button's missing `onClick` in `RoutinesEnhanced.tsx` to navigate to `/routines/:id/view`.

#### Issue 3: Routine Builder Full Parity

**Cosmetic fixes:**
- Add proper `<Label>` elements to Reps/Weight/Rest inputs in `ExerciseDetailPanel` (currently placeholder-only)
- Weight field shows user's unit label via WeightUnit context

**Exercise type support — new UI in ExerciseDetailPanel:**

| Feature | UI Element | Behavior |
|---------|-----------|----------|
| Bodyweight toggle | Switch | Hides weight input, tags exercise as bodyweight |
| Duration-based | "Reps" ↔ "Duration" toggle | Swaps reps input for duration input (seconds/minutes) |
| AMRAP mode | Toggle switch | Hides rep count, shows "AMRAP" badge, optional time cap |
| Per-set weight/rest | Inline per-row editing | Each set row gets its own editable weight/rest fields |
| Stall detection | Toggle in collapsible "Advanced Settings" | On/off |
| Eccentric load | Dropdown in Advanced Settings | Load profile selection |
| Echo level | Dropdown in Advanced Settings | Intensity level |
| Rep count timing | Input in Advanced Settings | Timing config |
| Stop at position | Input in Advanced Settings | Position value |

**UX pattern:** Collapsible "Advanced Settings" section below main settings — clean for basic use, full power available on expand.

**Superset integration:**
- Wire existing `SupersetContainer`, `SelectionModeBar`, `ExerciseCard` into main RoutineBuilder
- Multi-select exercises → "Create Superset" action
- Visual grouping with colored left border (`superset_color`)
- Transition time input between superset exercises

**Save/load:** All fields map to existing `routine_exercises` DB columns. `useSaveRoutine` and `useUpdateRoutine` mutations delete-and-reinsert, so new fields just need inclusion in the insert payload.

---

### Wave 4: Analytics Hub Consolidation (Issue 4)

#### Merge Strategy

**Remove:** `Biomechanics.tsx` standalone page, its route, and lazy import from `routes/index.tsx`.

**Add two new tabs** to Analytics Hub (alongside Overview, Strength Progress, Trends & Insights, Body Part Analysis, External):

| New Tab | Charts | Data Source |
|---------|--------|-------------|
| **Biomechanics** | ROM Trend, Velocity Profile, Force Curve, Asymmetry Gauge | `rep_summaries` |
| **Performance** | Power Output, VBT Zone Distribution, TUT Trend | `rep_summaries` |

#### New Queries

Add to `src/queries/analytics.ts`:

- `romTrendOptions(userId, dateRange)` — Average ROM per session over time (`rep_summaries.rom_mm`)
- `velocityTrendOptions(userId, dateRange)` — Mean velocity trend + VBT zone distribution (`rep_summaries.mean_velocity_mps`)
- `powerTrendOptions(userId, dateRange)` — Average/peak power over time (`rep_summaries.power_watts`)
- `asymmetryTrendOptions(userId, dateRange)` — Asymmetry percentage trend (`rep_summaries.asymmetry_pct`)
- `tutTrendOptions(userId, dateRange)` — Average TUT per session (`rep_summaries.tut_ms`)
- `forceCurveOptions(userId, sessionId)` — Per-rep force data for drill-down

**Chart component adaptation:** Existing charts (`RomTrend`, `VelocityProfile`, `PowerOutput`, `ForceCurve`, `AsymmetryGauge`) accept per-session data. They need to also accept aggregated trend data — add a `mode: 'session' | 'trend'` prop or create thin wrapper components.

#### Existing Tab Updates

- Volume/weight charts: apply unit conversion from WeightUnit context
- Subscription gating: remains INFERNO for the whole Analytics Hub

---

### Wave 5: Cycles (Issue 5)

#### Empty State

When `training_cycles` returns zero rows, the Cycles page displays:
- Icon + heading: "No Training Cycles Yet"
- CTA button: "Create Your First Cycle" → `/cycles/new`
- Brief explanation of what training cycles are

#### CycleBuilder Verification

The portal is a full creation tool — routines and cycles created here sync to the mobile app via the shared database. Verify:
- `CycleBuilder` writes correctly to `training_cycles` and `cycle_days` tables
- Mobile app picks up new cycles via its own queries
- Created cycles appear in the Cycles list after creation

**Files:**
- `src/app/components/Cycles.tsx` (or equivalent) — add empty state
- `src/app/components/cycle-builder/` — verify write behavior

---

## Project Context Update

The portal is NOT view-only. It is a full companion app for both viewing and creating routines/cycles, with data syncing bidirectionally via the shared Supabase database. The CLAUDE.md description should be updated to reflect this.

## Out of Scope

- Mobile app changes for cycle data writing (separate ticket)
- New chart component creation (existing charts are reused)
- Authentication flow changes
- Subscription tier changes
