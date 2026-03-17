# Portal Critical Fixes — Design Spec

**Date:** 2026-03-17
**Scope:** 8 reported issues across unit conversion, routines, analytics, cycles, community, settings, and challenges

## Problem Statement

The Phoenix Portal has 8 significant issues affecting core functionality:

1. Unit preference (kg/lbs) saves but never converts displayed values
2. Routines can only be edited or created — no view-only mode
3. Routine builder lacks polish (missing labels) and exercise type coverage (bodyweight, duration, AMRAP, supersets, advanced settings)
4. Analytics Hub is bare-bones while fully-built advanced charts (ROM, VBT, power, force, asymmetry) are orphaned in an inaccessible Biomechanics page
5. Training cycles have zero data in the database — empty state may need improvement
6. Community tab returns 400 error due to missing FK relationship between `shared_routines` and `profiles`
7. Settings tab is actually Integrations — mislabeled in navigation
8. Joined challenges don't appear on the dashboard (hardcoded placeholder)

## Cross-Wave Dependencies

- **Wave 4 depends on Wave 2:** Analytics charts need `units.ts` for weight/volume display conversion. Wave 2 must complete before Wave 4 chart work begins.
- **Wave 3 uses Wave 2:** RoutineBuilder and RoutineDetail use `units.ts` for weight display/input.

## Implementation Waves

### Wave 1: Quick Wins (Issues 6, 7, 8 + CLAUDE.md update)

#### Issue 6: Community 400 Error

**Root cause:** `shared_routines.user_id` has a FK to `auth.users(id)` but the PostgREST query requests `profiles(display_name, avatar_url)`. There is no direct FK from `shared_routines` to `profiles`, so PostgREST returns 400.

**Fix:** Use a PostgREST foreign key hint in the query instead of changing the FK. This avoids breaking the existing `ON DELETE SET NULL` behavior from `20260301_deletion_support.sql` which is critical for GDPR account deletion anonymization.

Update the community query in `src/queries/community.ts` to use the hint syntax:
```
.select("*, profiles!shared_routines_user_id_fkey(display_name, avatar_url)")
```

If PostgREST cannot resolve the indirect relationship through `auth.users`, the alternative is to create a PostgreSQL view or use an RPC function that joins the tables server-side.

Also add proper empty state to Community page for when tables have zero rows — explanatory message with CTA to share first routine.

**Files:**
- `src/queries/community.ts` — update `.select()` with FK hint
- `src/app/components/Community.tsx` — add empty state

#### Issue 7: Settings → Integrations Rename

**Fix:** Rename "Settings" nav item to "Integrations" in all three locations. Route stays `/integrations`.

**Files (3 locations):**
- `src/app/components/AppSidebar.tsx` — navGroups array (line ~83)
- `src/app/components/AppSidebar.tsx` — avatar dropdown menu DropdownMenuItem (line ~298)
- `src/app/components/MobileBottomNav.tsx` — moreGroups array (line ~55)

#### Issue 8: Challenges on Dashboard

**Root cause:** `Dashboard.tsx` has a hardcoded "No active challenges yet" placeholder at lines 1111-1133. The `userChallengesOptions()` query hook exists in `src/queries/challenges.ts` but is never called from the dashboard.

**Fix:**
- Query `userChallengesOptions(userId)` in the dashboard's active challenges section
- Display joined challenges with name, progress indicator, and time remaining
- If no joined challenges, show CTA linking to `/challenges`

**Files:**
- `src/app/components/Dashboard.tsx` — replace placeholder with query + display

#### CLAUDE.md Update

Update the project overview in `CLAUDE.md` to reflect that the portal is a full companion app for both viewing and creating routines/cycles, not view-only. Remove the statement "This is a view-only companion app — all workout control happens in the mobile app."

---

### Wave 2: Unit Conversion (Issue 1)

#### Architecture

**All data stays in kg in the database.** Conversion is display-only at render time. User inputs in lbs are converted to kg before persisting.

**New file:**
- `src/lib/units.ts` — Pure conversion utility functions
  - `KG_TO_LBS = 2.20462`
  - `convertWeight(valueKg: number, unit: 'kg' | 'lbs'): number`
  - `formatWeight(valueKg: number, unit: 'kg' | 'lbs'): string` — includes rounding (1 decimal for lbs, whole for kg)
  - `toKg(valueLbs: number): number` — for input conversion on save
  - `formatVolume(valueKg: number, unit: 'kg' | 'lbs'): string` — for large volume values with K/M suffixes

**No React context provider.** The user's `weight_unit` is already available from the profile query cached by TanStack Query. Components that need unit conversion read the profile query directly (many already do) and pass the unit to the pure functions in `units.ts`. This follows the existing codebase pattern and avoids unnecessary indirection.

**Pattern for components:**
```tsx
const { data: profile } = useQuery(profileOptions(userId));
const unit = profile?.weight_unit === "lbs" ? "lbs" : "kg";
// Then use: formatWeight(someKgValue, unit)
```

**Components to update:**

| Component | Changes |
|-----------|---------|
| `SessionDetail.tsx` | Replace `{set.weight_kg} kg` with `formatWeight(set.weight_kg, unit)` |
| `Analytics.tsx` | Chart axis labels, tooltips, summary cards |
| `WorkoutHistory.tsx` | Total volume display, workout card weights |
| `ExerciseProgress.tsx` | Chart labels ("Max Weight", "Volume", "Est. 1RM"), tooltips |
| `PersonalRecords.tsx` | PR values that are weight-based |
| `Profile.tsx` | Stats summary volume display; remove the "coming soon" TODO |
| `RoutineBuilder.tsx` | Normalize to use shared `units.ts` instead of local weight_unit logic |
| `Dashboard.tsx` | Weight/volume summary cards, PR display |
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
- Exercise list in order: name, muscle group badge, sets/reps/weight (user's unit via `units.ts`), rest time, training mode
- Superset groupings with visual indicators
- Advanced settings as tags/badges (AMRAP, bodyweight, eccentric, etc.)
- "Edit" button navigating to `/routines/:id`
- Responsive mobile layout

**Wiring:** Fix the View button's missing `onClick` in `RoutinesEnhanced.tsx` to navigate to `/routines/:id/view`.

#### Issue 3: Routine Builder Full Parity

**Database migration required:** The `routine_exercises` table is missing columns for bodyweight and duration exercise types. Add a migration:
- `is_bodyweight BOOLEAN DEFAULT false`
- `duration_seconds INTEGER` (nullable — null means rep-based exercise)

All other advanced fields (`is_amrap`, `pr_percentage`, `rep_count_timing`, `stop_at_position`, `stall_detection`, `eccentric_load`, `echo_level`, `per_set_weights`, `per_set_rest`, `superset_id`, `superset_color`, `superset_order`) already exist.

**Type updates:** Update `RoutineExerciseInput` in `src/mutations/routines.ts` to include `is_bodyweight` and `duration_seconds`.

**Schema updates:** Update any Zod validation schemas in `src/schemas/` that validate routine exercise data to include the new fields.

**Cosmetic fixes:**
- Add proper `<Label>` elements to Reps/Weight/Rest inputs in `ExerciseDetailPanel` (currently placeholder-only)
- Weight field shows user's unit label via `units.ts`

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

**Save/load:** Most fields map to existing `routine_exercises` DB columns. The new `is_bodyweight` and `duration_seconds` columns are added by migration. `useSaveRoutine` and `useUpdateRoutine` mutations delete-and-reinsert, so new fields just need inclusion in the insert payload.

---

### Wave 4: Analytics Hub Consolidation (Issue 4)

**Prerequisite:** Wave 2 (`units.ts`) must be complete before starting chart work.

#### Merge Strategy

**Remove:** `Biomechanics.tsx` standalone page, its route, and lazy import from `routes/index.tsx`.

**Redirect:** Add a redirect from `/biomechanics` to `/analytics?tab=biomechanics` to prevent 404s for any existing bookmarks.

**Add two new tabs** to Analytics Hub (alongside Overview, Strength Progress, Trends & Insights, Body Part Analysis, External):

| New Tab | Charts | Data Source |
|---------|--------|-------------|
| **Biomechanics** | ROM Trend, Velocity Profile, Force Curve, Asymmetry Gauge | `rep_summaries` |
| **Performance** | Power Output, VBT Zone Distribution, TUT Trend | `rep_summaries` |

#### Subscription Tier Gating

The Analytics Hub route is currently gated at **FLAME** tier, while Biomechanics was gated at **INFERNO** tier. After merging:
- Existing tabs (Overview, Strength Progress, Trends & Insights, Body Part Analysis, External) remain accessible at **FLAME** tier
- New tabs (Biomechanics, Performance) are individually gated with `<SubscriptionGate requiredTier="INFERNO">` wrapping their tab content
- Tab triggers for the new tabs are visible to FLAME users but show an upgrade prompt when clicked

#### New Queries

Add to `src/queries/analytics.ts`:

- `romTrendOptions(userId, dateRange)` — Average ROM per session over time (`rep_summaries.rom_mm`)
- `velocityTrendOptions(userId, dateRange)` — Mean velocity trend + VBT zone distribution (`rep_summaries.mean_velocity_mps`)
- `powerTrendOptions(userId, dateRange)` — Average/peak power over time (`rep_summaries.power_watts`)
- `asymmetryTrendOptions(userId, dateRange)` — Asymmetry percentage trend (`rep_summaries.asymmetry_pct`)
- `tutTrendOptions(userId, dateRange)` — Average TUT per session (`rep_summaries.tut_ms`)
- `forceCurveOptions(userId, sessionId)` — Per-rep force data for drill-down

#### Chart Component Strategy

Existing charts (`RomTrend`, `VelocityProfile`, `PowerOutput`, `ForceCurve`, `AsymmetryGauge`) are built for per-session, per-rep data. Aggregated trend data (session-level averages over weeks/months) has a fundamentally different shape — different X axis (dates vs rep numbers), different Y scale, different tooltip content.

**Approach:** Create new wrapper components for the aggregated views rather than adding mode props to existing charts. This avoids regressions in Biomechanics-style usage (which the RoutineDetail or future session detail views may still use).

New components in `src/app/components/charts/`:
- `RomTrendAggregated.tsx` — session-average ROM over time
- `VelocityTrendAggregated.tsx` — session-average velocity over time + zone distribution
- `PowerTrendAggregated.tsx` — session-average/peak power over time
- `AsymmetryTrendAggregated.tsx` — session-average asymmetry over time
- `TutTrend.tsx` — new, session-average TUT over time (no existing chart for this)

The per-session charts remain available for drill-down views within the Biomechanics tab (click a session point → see rep-by-rep detail).

#### Existing Tab Updates

- Volume/weight charts: apply unit conversion via `units.ts`

---

### Wave 5: Cycles (Issue 5)

#### Empty State

**Note:** `TrainingCycles.tsx` already has an `EmptyState` component with icon, title, description, and "Create Cycle" CTA button (lines ~80-116). Verify this is rendering correctly before rebuilding. If it already works, this item is resolved.

If the empty state needs improvement:
- Ensure CTA links to `/cycles/new`
- Add brief explanation of what training cycles are and that they sync to the mobile app

#### CycleBuilder Verification

The portal is a full creation tool — routines and cycles created here sync to the mobile app via the shared database. Verify:
- `CycleBuilder` writes correctly to `training_cycles` and `cycle_days` tables
- Created cycles appear in the Cycles list after creation
- Mobile app can read portal-created cycles

**Files:**
- `src/app/components/TrainingCycles.tsx` — verify empty state
- `src/app/components/cycle-builder/` — verify write behavior

---

## Out of Scope

- Mobile app changes (separate codebase)
- Authentication flow changes
- Subscription tier restructuring (only per-tab gating within existing tiers)
- New pricing or billing changes
