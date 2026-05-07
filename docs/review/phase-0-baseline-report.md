# Phase 0 -- Baseline Report

Generated: 2026-03-18

---

## Outdated Dependencies

**Total outdated packages:** 51 (across direct and dev dependencies)

### npm audit summary

4 **high** severity vulnerabilities found, all in the vite-plugin-pwa dependency chain:

- serialize-javascript <=7.0.2 -- RCE via RegExp.flags and Date.prototype.toISOString() (GHSA-5c6j-r48x-rmvq, CVSS 8.1)
- @rollup/plugin-terser 0.2.0 - 0.4.4 -- depends on vulnerable serialize-javascript
- workbox-build >=7.1.0 -- depends on vulnerable @rollup/plugin-terser
- vite-plugin-pwa >=0.20.0 -- depends on vulnerable workbox-build

Fix requires downgrading vite-plugin-pwa to 0.19.8 (breaking change, major version rollback) or waiting for upstream patch.

---

### HIGH Risk

Packages that are multiple major versions behind, have known security vulnerabilities, or require significant migration effort.

| Package                  | Current | Latest | Type          | Notes                                                                                                                                                            |
| ------------------------ | ------- | ------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vite-plugin-pwa          | 1.2.0   | 1.2.0  | devDependency | **Security**: transitive dep serialize-javascript has HIGH severity RCE (CVSS 8.1). No patch available without breaking change.                                  |
| react-resizable-panels   | 2.1.7   | 4.7.3  | dependency    | **2 major versions behind** (2.x -> 4.x). API surface likely changed significantly. Used for layout panels.                                                      |
| date-fns                 | 3.6.0   | 4.1.0  | dependency    | **1 major version behind**. Pinned (no caret). date-fns v4 rewrites the module system and drops CommonJS -- migration effort is moderate but touches many files. |
| vite                     | 7.3.1   | 8.0.0  | devDependency | **1 major version behind**. Core build tool -- major version bump means potential config changes, plugin compatibility breaks. Needs careful testing.            |
| @vitejs/plugin-react     | 5.1.4   | 6.0.1  | devDependency | **1 major version behind**. Coupled to Vite major version. Must upgrade alongside Vite 8.                                                                        |
| typescript               | 5.7.3   | 5.9.3  | devDependency | Pinned to ~5.7.0. 2 minor versions behind. TS minor versions can introduce new strictness errors. Risk is moderate but impact is broad (entire codebase).        |
| rollup-plugin-visualizer | 6.0.5   | 7.0.1  | devDependency | **1 major version behind**. Build analysis tool -- lower impact but may break with Vite 8 upgrade.                                                               |
| jsdom                    | 28.1.0  | 29.0.0 | devDependency | **1 major version behind**. Test environment -- could affect Vitest test execution.                                                                              |

### MEDIUM Risk

Packages with significant minor version gaps or behavioral change potential due to pinning.

| Package                     | Current  | Latest  | Type          | Notes                                                                                                                 |
| --------------------------- | -------- | ------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| @sentry/vite-plugin         | 4.9.1    | 5.1.1   | devDependency | 1 major version behind. Sentry plugins tend to have breaking config changes between majors.                           |
| lucide-react                | 0.487.0  | 0.577.0 | dependency    | 90 minor versions behind (pre-1.0 semver, so minors can break). Icon library -- possible renamed/removed icons.       |
| motion (Framer Motion)      | 12.23.24 | 12.38.0 | dependency    | 15 patch versions behind within same major. Pinned (no caret). Large delta -- cumulative behavioral changes possible. |
| react-hook-form             | 7.55.0   | 7.71.2  | dependency    | 16 minor versions behind. Pinned (no caret). Forms are critical path -- subtle validation behavior changes possible.  |
| sonner                      | 2.0.3    | 2.0.7   | dependency    | 4 patch versions behind. Pinned (no caret). Toast notifications -- low surface area but pinned for a reason.          |
| tailwind-merge              | 3.2.0    | 3.5.0   | dependency    | 3 minor versions behind. Pinned (no caret). Class merge logic changes could affect styling.                           |
| @radix-ui/react-checkbox    | 1.1.4    | 1.3.3   | dependency    | 2 minor versions behind. Pinned. Checkbox behavior/API may have changed.                                              |
| @radix-ui/react-radio-group | 1.2.3    | 1.3.8   | dependency    | 1 minor version behind. Pinned. Radio group API changes.                                                              |
| @radix-ui/react-select      | 2.1.6    | 2.2.6   | dependency    | 1 minor version behind. Pinned. Select is complex -- behavioral changes possible.                                     |
| @radix-ui/react-slider      | 1.2.3    | 1.3.6   | dependency    | 1 minor version behind. Pinned. Slider interaction changes.                                                           |
| @radix-ui/react-slot        | 1.1.2    | 1.2.4   | dependency    | 1 minor version behind. Pinned. Slot is foundational to shadcn/ui composition -- changes here cascade.                |
| @radix-ui/react-switch      | 1.1.3    | 1.2.6   | dependency    | 1 minor version behind. Pinned. Switch state management changes.                                                      |
| @radix-ui/react-tooltip     | 1.1.8    | 1.2.8   | dependency    | 1 minor version behind. Pinned. Tooltip positioning/behavior changes.                                                 |

### LOW Risk (summary)

**24 packages** with patch or minor updates available, all within semver-compatible ranges. No action needed for beta launch.

<details>
<summary>Click to expand full list</summary>

| Package                         | Current | Latest  | Type          | Delta |
| ------------------------------- | ------- | ------- | ------------- | ----- |
| @biomejs/biome                  | 2.4.2   | 2.4.8   | devDependency | patch |
| @dnd-kit/helpers                | 0.3.0   | 0.3.2   | dependency    | patch |
| @dnd-kit/react                  | 0.3.0   | 0.3.2   | dependency    | patch |
| @radix-ui/react-accordion       | 1.2.3   | 1.2.12  | dependency    | patch |
| @radix-ui/react-alert-dialog    | 1.1.6   | 1.1.15  | dependency    | patch |
| @radix-ui/react-aspect-ratio    | 1.1.2   | 1.1.8   | dependency    | patch |
| @radix-ui/react-avatar          | 1.1.3   | 1.1.11  | dependency    | patch |
| @radix-ui/react-collapsible     | 1.1.3   | 1.1.12  | dependency    | patch |
| @radix-ui/react-context-menu    | 2.2.6   | 2.2.16  | dependency    | patch |
| @radix-ui/react-dialog          | 1.1.6   | 1.1.15  | dependency    | patch |
| @radix-ui/react-dropdown-menu   | 2.1.6   | 2.1.16  | dependency    | patch |
| @radix-ui/react-hover-card      | 1.1.6   | 1.1.15  | dependency    | patch |
| @radix-ui/react-label           | 2.1.2   | 2.1.8   | dependency    | patch |
| @radix-ui/react-menubar         | 1.1.6   | 1.1.16  | dependency    | patch |
| @radix-ui/react-navigation-menu | 1.2.5   | 1.2.14  | dependency    | patch |
| @radix-ui/react-popover         | 1.1.6   | 1.1.15  | dependency    | patch |
| @radix-ui/react-progress        | 1.1.2   | 1.1.8   | dependency    | patch |
| @radix-ui/react-scroll-area     | 1.2.3   | 1.2.10  | dependency    | patch |
| @radix-ui/react-separator       | 1.1.2   | 1.1.8   | dependency    | patch |
| @radix-ui/react-tabs            | 1.1.3   | 1.1.13  | dependency    | patch |
| @radix-ui/react-toggle          | 1.1.2   | 1.1.10  | dependency    | patch |
| @radix-ui/react-toggle-group    | 1.1.2   | 1.1.11  | dependency    | patch |
| @sentry/react                   | 10.39.0 | 10.44.0 | dependency    | minor |
| @supabase/supabase-js           | 2.95.3  | 2.99.2  | dependency    | minor |
| @tailwindcss/vite               | 4.1.18  | 4.2.2   | devDependency | minor |
| @tanstack/react-query           | 5.90.21 | 5.91.0  | dependency    | minor |
| react-day-picker                | 9.13.2  | 9.14.0  | dependency    | minor |
| react-router                    | 7.13.0  | 7.13.1  | dependency    | patch |
| recharts                        | 3.7.0   | 3.8.0   | dependency    | minor |
| tailwindcss                     | 4.1.18  | 4.2.2   | devDependency | minor |
| tw-animate-css                  | 1.3.8   | 1.4.0   | dependency    | minor |
| vitest                          | 4.0.18  | 4.1.0   | devDependency | minor |
| zustand                         | 5.0.11  | 5.0.12  | dependency    | patch |

</details>

---

### Observations and Recommendations

1. **Security-critical (act before beta):** The vite-plugin-pwa -> serialize-javascript vulnerability chain (CVSS 8.1, RCE) is the only security finding. Since this is a build-time/dev dependency (not shipped to users at runtime), the real-world risk is lower than the CVSS implies. However, it should be resolved before production. Evaluate whether downgrading to vite-plugin-pwa@0.19.8 is viable or if the PWA plugin can be temporarily removed.

2. **Pinned Radix UI packages:** 27 Radix UI packages are pinned without caret ranges. This was likely intentional to avoid shadcn/ui breakage. A batch update of all Radix packages together (after testing) is the right approach -- do not update them piecemeal.

3. **Vite 7 -> 8 migration:** This is the highest-effort upgrade. It will likely require coordinated updates to @vitejs/plugin-react, rollup-plugin-visualizer, and @sentry/vite-plugin. Defer to post-beta unless a blocking issue is found.

4. **date-fns 3 -> 4:** The v4 migration drops CommonJS and restructures imports. Grep for date-fns usage across the codebase to estimate migration scope before attempting.

5. **react-resizable-panels 2 -> 4:** Skipped major version 3 entirely. Review the changelog for API changes. This package is used for layout panels and a breaking change would be visually obvious.

6. **Pinning strategy:** Several runtime dependencies (motion, react-hook-form, sonner, tailwind-merge, date-fns, lucide-react) are pinned without caret ranges. This prevents automatic patch/minor updates. Consider whether this was intentional or if caret ranges should be restored after the beta stabilizes.

---

## Static Analysis Baseline

### TypeScript (`npm run typecheck`)
- **Total errors: 0**
- **Total warnings: 0**
- TypeScript compilation is clean. No type errors detected across the project.
- Note: Edge Function files (`supabase/functions/`) are excluded from `tsconfig.json` scope, so Deno-related type issues are not surfaced by this check.

### Biome (`npx @biomejs/biome check .`)
- **Biome version:** 2.4.2 (config schema references 2.4.7 -- minor mismatch, non-blocking)
- **Files checked:** 308
- **Total diagnostics: 509** (333 errors, 174 warnings, 2 infos)

#### Formatting Issues: 305 files
All 305 formatting issues are **CRLF line-ending mismatches** (Windows `\r\n` vs Biome's expected `\n`). No structural formatting problems (indentation, spacing, etc.) were detected. This is a single `biome format --write .` fix away from zero.

#### Import Organization (assist): 26 issues
All 26 are `assist/source/organizeImports` -- import statement ordering. Auto-fixable.

#### Lint Issues: 177 total

**By category:**

| Category             | Count | Severity   |
| -------------------- | ----- | ---------- |
| Suspicious           | 74    | warn       |
| Accessibility (a11y) | 71    | warn       |
| Style                | 23    | warn       |
| Correctness          | 8     | warn/error |
| Complexity           | 1     | warn       |

**By rule (detailed):**

| Rule                          | Count | Category    |
| ----------------------------- | ----- | ----------- |
| `noArrayIndexKey`             | 57    | suspicious  |
| `useButtonType`               | 46    | a11y        |
| `noNonNullAssertion`          | 22    | style       |
| `noSvgWithoutTitle`           | 11    | a11y        |
| `noExplicitAny`               | 10    | suspicious  |
| `useSemanticElements`         | 5     | a11y        |
| `useIterableCallbackReturn`   | 5     | suspicious  |
| `noStaticElementInteractions` | 3     | a11y        |
| `noUnusedVariables`           | 3     | correctness |
| `useFocusableInteractive`     | 2     | a11y        |
| `noLabelWithoutControl`       | 2     | a11y        |
| `useExhaustiveDependencies`   | 2     | correctness |
| `noUnusedFunctionParameters`  | 2     | correctness |
| `useAriaPropsForRole`         | 1     | a11y        |
| `noRedundantAlt`              | 1     | a11y        |
| `noGlobalIsNan`               | 1     | suspicious  |
| `noDocumentCookie`            | 1     | suspicious  |
| `useConst`                    | 1     | style       |
| `noUnusedImports`             | 1     | correctness |
| `noUselessFragments`          | 1     | complexity  |

**Top files by lint issue count:**

| File                                           | Issues |
| ---------------------------------------------- | ------ |
| `src/lib/computeNextWorkout.test.ts`           | 12     |
| `src/app/components/Dashboard.tsx`             | 10     |
| `src/app/components/CelebrationDemo.tsx`       | 9      |
| `src/app/components/Analytics.tsx`             | 9      |
| `src/app/components/PersonalRecords.tsx`       | 7      |
| `src/app/components/cycle-builder/DayCard.tsx` | 5      |
| `src/app/components/RoutineBuilder.tsx`        | 5      |
| `src/app/components/Goals.tsx`                 | 5      |
| `src/app/components/ConsistencyCalendar.tsx`   | 5      |
| `src/app/components/WorkoutHistory.tsx`        | 4      |

#### Configuration Note
The `biome.json` schema references version `2.4.7` but the installed CLI is `2.4.2`. This produces a deserialization info diagnostic but does not affect analysis results. Running `biome migrate` would resolve it.

### Observations and Recommendations

1. **Formatting (305 issues):** All CRLF. A single `biome format --write .` pass eliminates these. Consider adding `lineEnding: "lf"` to `biome.json` and configuring `.gitattributes` with `* text=auto eol=lf` to prevent recurrence on Windows.

2. **`noArrayIndexKey` (57 issues):** The dominant lint finding. Many are in skeleton/placeholder rendering where index keys are actually safe (static lists). Others in dynamic lists (Dashboard, Analytics, PersonalRecords) should be audited for stable key alternatives.

3. **`useButtonType` (46 issues):** All missing `type="button"` on `<button>` elements. Mechanical fix -- no behavioral risk. High-value a11y improvement.

4. **`noNonNullAssertion` (22 issues):** Non-null assertions (`!`) scattered across components. Each should be reviewed for null safety -- some may mask runtime errors.

5. **`useExhaustiveDependencies` (2 issues):** These are the highest-priority correctness findings. Missing or stale deps in `useEffect`/`useMemo` can cause subtle bugs. Should be triaged before beta.

6. **`noGlobalIsNan` (1 issue):** Using global `isNaN()` instead of `Number.isNaN()`. The global version coerces to number first, which can produce unexpected results. Quick fix.

7. **Zero TypeScript errors** is a strong baseline signal. The codebase type safety is healthy.

---

## Database Migration Health

**Migration count:** 27 files in `supabase/migrations/`, applied in lexicographic order.

### Subscription Schema Evolution

#### Original (00001_create_subscriptions.sql) -- Stripe era

Columns on `public.subscriptions`:

| Column                   | Type        | Constraints                                                        |
| ------------------------ | ----------- | ------------------------------------------------------------------ |
| `id`                     | UUID        | PRIMARY KEY, DEFAULT gen_random_uuid()                             |
| `user_id`                | UUID        | NOT NULL, FK auth.users, UNIQUE                                    |
| `stripe_customer_id`     | TEXT        | NOT NULL                                                           |
| `stripe_subscription_id` | TEXT        | UNIQUE NOT NULL                                                    |
| `tier`                   | TEXT        | NOT NULL, CHECK (FREE, PHOENIX, ELITE)                             |
| `status`                 | TEXT        | NOT NULL, CHECK (active, past_due, canceled, trialing, incomplete) |
| `price_id`               | TEXT        | NOT NULL                                                           |
| `current_period_start`   | TIMESTAMPTZ | NOT NULL                                                           |
| `current_period_end`     | TIMESTAMPTZ | NOT NULL                                                           |
| `cancel_at_period_end`   | BOOLEAN     | DEFAULT FALSE                                                      |
| `created_at`             | TIMESTAMPTZ | DEFAULT NOW()                                                      |
| `updated_at`             | TIMESTAMPTZ | DEFAULT NOW()                                                      |

Also created `public.profiles` with `stripe_customer_id TEXT UNIQUE` column.

#### After RevenueCat migration (20260303_revenuecat_schema_migration.sql)

- **Dropped:** `stripe_customer_id`, `stripe_subscription_id`, `price_id` (all three Stripe-specific columns)
- **Added:** `revenuecat_customer_id` (TEXT), `product_id` (TEXT), `entitlement_ids` (TEXT[], DEFAULT '{}'), `store` (TEXT), `environment` (TEXT, DEFAULT 'PRODUCTION'), `last_event_id` (TEXT)
- **Altered:** `current_period_start` DROP NOT NULL
- **Not touched:** `current_period_end` NOT NULL constraint was left in place

#### After tier alignment (20260316_align_tier_names.sql)

- **Changed:** `tier` CHECK constraint from `(FREE, PHOENIX, ELITE)` to `(FREE, EMBER, FLAME, INFERNO)`
- **Changed:** RLS policy on `community_comments` updated to match new tier names

#### After Paddle migration (20260317_paddle_schema_fix.sql)

- **Added:** `paddle_customer_id` (TEXT), `paddle_subscription_id` (TEXT), `price_id` (TEXT)
- **Dropped:** `revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store`
- **Changed:** `status` CHECK constraint updated to include `none`
- **Not dropped:** `environment` column (orphaned -- was a RevenueCat-era addition)

#### Final column set (after all 27 migrations applied)

| Column                   | Type        | Constraints                                                              | Origin              |
| ------------------------ | ----------- | ------------------------------------------------------------------------ | ------------------- |
| `id`                     | UUID        | PK, DEFAULT gen_random_uuid()                                            | 00001               |
| `user_id`                | UUID        | NOT NULL, FK, UNIQUE                                                     | 00001               |
| `paddle_customer_id`     | TEXT        | nullable                                                                 | 20260317            |
| `paddle_subscription_id` | TEXT        | nullable                                                                 | 20260317            |
| `tier`                   | TEXT        | NOT NULL, CHECK (FREE, EMBER, FLAME, INFERNO)                            | 00001 + 20260316    |
| `status`                 | TEXT        | NOT NULL, CHECK (active, past_due, canceled, trialing, incomplete, none) | 00001 + 20260317    |
| `price_id`               | TEXT        | nullable                                                                 | 20260317 (re-added) |
| `current_period_start`   | TIMESTAMPTZ | nullable (NOT NULL relaxed by 20260303)                                  | 00001 + 20260303    |
| `current_period_end`     | TIMESTAMPTZ | **NOT NULL (never relaxed)**                                             | 00001               |
| `cancel_at_period_end`   | BOOLEAN     | DEFAULT FALSE                                                            | 00001               |
| `environment`            | TEXT        | DEFAULT 'PRODUCTION'                                                     | 20260303 (orphaned) |
| `last_event_id`          | TEXT        | nullable                                                                 | 20260303            |
| `created_at`             | TIMESTAMPTZ | DEFAULT NOW()                                                            | 00001               |
| `updated_at`             | TIMESTAMPTZ | DEFAULT NOW()                                                            | 00001               |

This matches the generated TypeScript types in `src/lib/database.types.ts` (lines 1133-1183).

### Paddle Webhook Compatibility

The Edge Function at `supabase/functions/paddle-webhooks/index.ts` (lines 222-239) upserts with `onConflict: "user_id"`:

```
user_id, paddle_customer_id, paddle_subscription_id, tier, status,
price_id, current_period_start, current_period_end, cancel_at_period_end,
last_event_id, updated_at
```

- All upsert columns exist in schema: **YES**
- `onConflict: "user_id"` strategy works: **YES** (UNIQUE constraint on user_id exists from 00001)
- Tier values compatible with CHECK: **YES** (mapPriceIdToTier returns FREE/EMBER/FLAME/INFERNO)
- Status values compatible with CHECK: **YES** (mapPaddleStatusToSubscriptionStatus returns active/trialing/canceled/past_due/none)
- Orphaned columns (exist in schema, not written by webhook): `environment`, `created_at`

### Issues Found

#### Issue DB-1 (HIGH) -- Client-side `paddle.ts` writes to non-existent columns

**File:** `src/lib/paddle.ts` lines 174-186 (`buildSubscriptionUpsert()`)

The `buildSubscriptionUpsert()` function writes to `stripe_customer_id` and `stripe_subscription_id`. These columns were **dropped** by the RevenueCat migration (20260303) and never re-added. The actual database columns are `paddle_customer_id` and `paddle_subscription_id`.

The function comments describe these as "legacy Stripe column names" but the columns no longer exist. The Edge Function does NOT use this client-side function (it builds its own payload inline at line 223), so the production webhook path is unaffected. However:

- The function is exported and tested (`src/lib/__tests__/paddle-webhook-handlers.test.ts` lines 88-89, 152-153)
- If any future code path calls `buildSubscriptionUpsert()` and passes the result to a Supabase upsert, Paddle customer/subscription IDs would be silently lost (Supabase ignores unknown columns)
- The tests pass because they only check the return object shape, not actual database writes

**Recommendation:** Rename `stripe_customer_id` to `paddle_customer_id` and `stripe_subscription_id` to `paddle_subscription_id` in `buildSubscriptionUpsert()`. Update the corresponding test assertions.

#### Issue DB-2 (MEDIUM) -- `current_period_end` NOT NULL can reject valid Paddle events

**File:** `supabase/migrations/00001_create_subscriptions.sql` line 38

`current_period_end` retains its original NOT NULL constraint. The RevenueCat migration relaxed `current_period_start` to nullable but did NOT do the same for `current_period_end`. The Paddle migration also did not address this.

The webhook computes:
```typescript
current_period_end: event.data.current_billing_period?.ends_at ?? null,
```

Paddle omits `current_billing_period` on `subscription.canceled` and `subscription.paused` events when no future billing period exists. In that case, the value resolves to `null`.

- **INSERT path (new user):** Fails with NOT NULL violation. The webhook returns 500, Paddle retries, all retries fail.
- **UPDATE path (existing row):** The upsert merges columns, so the existing non-null value is preserved. No failure.

This is a latent bug that will only manifest if a user's first-ever subscription event is a cancellation or pause (unlikely but possible if webhook ordering is not guaranteed).

**Recommendation:** Add to a cleanup migration: `ALTER TABLE public.subscriptions ALTER COLUMN current_period_end DROP NOT NULL;`

#### Issue DB-3 (LOW) -- Orphaned `environment` column on subscriptions

**File:** Added by `supabase/migrations/20260303_revenuecat_schema_migration.sql` line 54

The `environment` column (TEXT, DEFAULT 'PRODUCTION') was added for RevenueCat sandbox/production filtering. The Paddle migration dropped the other four RevenueCat columns (`revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store`) but missed `environment`.

No code reads or writes this column. It has a DEFAULT value so it does not block inserts. It appears in `database.types.ts` line 1139.

**Recommendation:** Drop in cleanup migration: `ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS environment;`

#### Issue DB-4 (LOW) -- Orphaned `stripe_customer_id` on profiles table

**File:** Created by `supabase/migrations/00001_create_subscriptions.sql` line 10

The `profiles` table retains `stripe_customer_id TEXT UNIQUE` from the original Stripe integration. No migration has dropped it. No application code reads or writes this column. It appears in `database.types.ts` line 599.

**Recommendation:** Drop in cleanup migration: `ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_customer_id;`

### Summary

| Category                                       | Status                                                           | Severity |
| ---------------------------------------------- | ---------------------------------------------------------------- | -------- |
| Migration file count                           | 27 files, all consistent                                         | OK       |
| Subscription schema evolution                  | 4 migrations traced, internally consistent                       | OK       |
| Paddle webhook column compatibility            | All 11 upsert columns exist in schema                            | OK       |
| Client-side upsert builder uses wrong columns  | `paddle.ts` writes to dropped Stripe columns                     | HIGH     |
| NOT NULL constraint risk                       | `current_period_end` can reject edge-case events                 | MEDIUM   |
| Orphaned column: `environment`                 | Exists, unused, harmless but untidy                              | LOW      |
| Orphaned column: `profiles.stripe_customer_id` | Exists, unused, harmless but untidy                              | LOW      |
| Upsert conflict strategy                       | UNIQUE(user_id) constraint validates `onConflict`                | OK       |
| Tier CHECK constraint                          | All mapped values (FREE/EMBER/FLAME/INFERNO) valid               | OK       |
| Status CHECK constraint                        | All mapped values (active/trialing/canceled/past_due/none) valid | OK       |
