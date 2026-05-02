# Portal Static UX/UI Audit — Findings

**Scope:** phoenix-portal React app (`phoenix-portal/src/app/`, `phoenix-portal/src/hooks/`, `phoenix-portal/src/lib/`, `phoenix-portal/src/queries/`, `phoenix-portal/src/styles/theme.css`, `phoenix-portal/src/main.tsx`)
**Auditor:** UX Researcher (portal)
**Method:** Static review of TSX/TS sources only — no live runtime testing.

**Files reviewed (representative sample):**
- Routes: `routes/index.tsx`, `routes/AppLayout.tsx`, `routes/ProtectedRoute.tsx`, `routes/SubscribedRoute.tsx`
- Shell/nav: `components/AppSidebar.tsx`, `components/MobileBottomNav.tsx`, `components/SkipToContent.tsx`, `components/OfflineBanner.tsx`, `components/PageLoading.tsx`, `components/PageShell.tsx`, `components/ErrorFallback.tsx`, `components/NotFound.tsx`, `components/PortalBanner.tsx`, `components/WhatsNewBanner.tsx`, `components/CookieConsentBanner.tsx`, `components/OnboardingOverlay.tsx`
- Surfaces: `components/Dashboard.tsx`, `components/LandingPage.tsx`, `components/AuthCallback.tsx`, `components/ResetPassword.tsx`, `components/Analytics.tsx`, `components/Biomechanics.tsx`, `components/Leaderboard.tsx`, `components/Goals.tsx`, `components/Recovery.tsx`, `components/RoutineBuilder.tsx`, `components/CycleBuilder.tsx`, `components/RoutinesEnhanced.tsx`, `components/RoutineDetail.tsx`, `components/SessionDetail.tsx`, `components/WorkoutHistory.tsx`, `components/Profile.tsx`, `components/PricingPlans.tsx`, `components/Integrations.tsx`, `components/FAQ.tsx`, `components/FormAnalysis.tsx`, `components/InsightsFeed.tsx`, `components/ConsistencyCalendar.tsx`, `components/ExerciseProgress.tsx`, `components/ComparisonView.tsx`, `components/PWAInstallPrompt.tsx`, `components/FeatureHint.tsx`, `components/SubscriptionGate.tsx`, `components/UpgradePrompt.tsx`, `components/DeleteConfirmDialog.tsx`, `components/ui/empty-state.tsx`
- Plumbing: `lib/pricing.ts`, `lib/units.ts`, `schemas/transforms.ts`, `providers/QueryProvider.tsx`, `hooks/useRealtimeSync.ts`, `styles/theme.css`

## Summary

- **22 findings:** 4 CRITICAL, 8 HIGH, 7 MEDIUM, 3 POLISH
- **Top recurring patterns:**
  1. **Catastrophic state-coverage gap.** ~75 `useQuery` call sites across 30 components, only 4 read `isError`. With `QueryProvider` set to `retry: 1` and `refetchOnWindowFocus: false`, transient failures leave the UI stuck in skeleton or "no data" view forever.
  2. **Stale tier copy.** FAQ, Profile, and Goals still describe a 2-tier (Ember/Inferno) or "Phoenix/Elite" world — actual tiers are FREE/EMBER/FLAME/INFERNO. PLAN_LABELS in Profile is missing FLAME entirely, so paying FLAME customers see `undefined`.
  3. **Hardcoded primary hex (`#FF6B35`, `#DC2626`, `#F59E0B`, etc.) in ~30 components**, defeating theme.css tokens. Two-thirds of these are in chart/insight/landing surfaces; the worst offenders embed it inside Framer Motion `animate` props on Dashboard, where reduced-motion respect still leaks the brand glow.
  4. **No mobile→portal sync feedback.** `useRealtimeSync` silently invalidates queries; the user has no visual confirmation that "your last set just landed." Combined with the offline banner being the only ambient sync surface, users on a flaky connection can't distinguish "loading" from "stuck."
  5. **Inconsistent loading/error/empty triplets across data-dense surfaces.** Some components use `EmptyState`, some inline messages, some Card+Skeleton; some show retry buttons (Dashboard `ActiveChallengesSection`, Biomechanics `ErrorCard`), most do not. There is no shared error fallback for query-level errors.

- **Coverage gaps (cannot assess statically):**
  - Whether the auto-collapse sidebar at 1280px causes layout shift on slow networks.
  - Whether the `SubscriptionGate` skeleton (`Skeleton h-32 w-full`) renders on top of `AppLayout` page transition or below it.
  - Whether the `MobileBottomNav` `pb-safe` correctly clears iOS home indicator on landscape iPhones.
  - Real WCAG contrast ratios — left to A11y/parity audit (04-a11y-parity.md). Hex values cited here are observations, not measurements.
  - Whether toast deduplication works during sync-burst invalidations.
  - First-paint behavior on the FREE tier when Dashboard / History / Goals / Recovery are all blocked by SubscriptionGate.

---

## Findings

### F-001 [CRITICAL] Pricing tiers in FAQ contradict actual product

**Surface:** Portal
**Category:** 10 (Subscription/paywall UX) — also 1, 9
**Location:** `phoenix-portal/src/app/components/FAQ.tsx:73-85`
**Observation:** FAQ tells users:
> "We offer two tiers: **Ember** ($15/mo — cloud sync, unlimited history, community sharing, and third-party connections), and **Inferno** ($25/mo …)."
The actual product, per `phoenix-portal/src/lib/pricing.ts:18-71`, has three paid tiers: **Ember $5**, **Flame $15**, **Inferno $25**. The FAQ has merged Ember+Flame into a single "Ember $15," which is now the price of FLAME. A user reading the FAQ before subscribing will believe they get community sharing and third-party connections at the $5 Ember tier, then hit the SubscribedRoute paywall on `/community`, `/integrations`, `/routines`, `/cycles` (which require FLAME, see `routes/index.tsx:184-205`).
**Why it hurts:** This is misrepresentation that converts to refund requests. It is the single document a confused user reads to disambiguate tiers, and it is materially wrong about what a $5 subscription unlocks. Compounds the FREE→EMBER→FLAME→INFERNO ladder confusion already created by the inconsistent feature gating.
**Severity rationale:** CRITICAL because it directly mis-sells. Failure of legal/marketing-truth standard, not just UX polish. HIGH would be "outdated naming"; this is "wrong price for wrong feature set."
**Proposed fix (quick-win, ≤2 hr):** Regenerate the FAQ tier paragraph from `TIER_PRICING` in `lib/pricing.ts` so the source of truth flows. Add a build-time check (vitest) asserting that all tier names in FAQ.tsx are in `TIER_PRICING`. Same pattern as `LandingPage.tsx:330-338` already does for the landing pricing grid.
**Parity flag:** NO (portal-only billing copy)

---

### F-002 [CRITICAL] Profile shows `undefined` for FLAME subscribers

**Surface:** Portal
**Category:** 10 — also 1
**Location:** `phoenix-portal/src/app/components/Profile.tsx:73-77` (`PLAN_LABELS` const) and line 400 (`{PLAN_LABELS[tier]}`)
**Observation:** The lookup table is:
```
const PLAN_LABELS: Record<string, string> = {
  FREE: "No Active Subscription",
  EMBER: "Ember Plan",
  INFERNO: "Inferno Plan",
};
```
There is no entry for FLAME. Since the Subscription card renders `{PLAN_LABELS[tier]}` directly, a FLAME subscriber sees an empty/undefined slot next to their tier badge.
**Why it hurts:** A paying FLAME customer (the most popular tier per `PricingPlans.tsx:89`'s `popular: true`) opens Profile, sees their TierBadge ("Flame"), then sees a blank/undefined plan name. It is jarring at exactly the moment that should reassure them about their billing status.
**Severity rationale:** CRITICAL because it's a regression visible to the largest paid cohort and breaks trust on the Subscription surface (the only place users verify what they're paying for). Borderline data-loss class — billing comprehension failure.
**Proposed fix (quick-win, ≤30 min):** Replace the `PLAN_LABELS` literal with a derivation from `TIER_PRICING.find(t => t.tier === tier)?.name + " Plan"`, with a `?? "No Active Subscription"` fallback. Same pattern in `UpgradePrompt.tsx`.
**Parity flag:** NO

---

### F-003 [CRITICAL] Goals FREE-tier upsell mentions non-existent "Phoenix and Elite" tiers

**Surface:** Portal
**Category:** 10 — also 9
**Location:** `phoenix-portal/src/app/components/Goals.tsx:357`
**Observation:** Description on the upgrade prompt reads:
> "Goal tracking is available for Phoenix and Elite subscribers."
Neither "Phoenix" nor "Elite" exists in `TIER_PRICING`. The actual gating (line 293) is `isInferno ? Infinity : isPremium ? 3 : 1` — that is, FREE = 1 goal, EMBER/FLAME = 3, INFERNO = unlimited. Goals are accessible at EMBER, not blocked behind a higher tier.
**Why it hurts:** A FREE user sees this pseudo-FREE state (still gets 1 goal) **plus** an upsell to fictional tiers. They can't compare "Phoenix" to anything on `/pricing` and assume the portal is broken or out of date.
**Severity rationale:** CRITICAL because the copy actively misinforms about a feature paywall on a primary, paid surface. Combines copy bug + branding inconsistency + paywall confusion.
**Proposed fix (quick-win, ≤30 min):** Change copy to "Goal tracking is available on Ember and above." Pull tier names from `lib/pricing.ts` so this can never drift again. Audit Goals tier-gate logic — the page conditionally renders the upsell when `!isPremium`, but FREE users actually get 1 goal per the `maxGoals` calc; either the gate or the maxGoals math is wrong (probably the gate, since a 1-goal experience for FREE is a reasonable funnel).
**Parity flag:** NO

---

### F-004 [CRITICAL] Query layer has no error UX — 70+ `useQuery` calls silently fail

**Surface:** Portal
**Category:** 3 (State coverage)
**Location:** `phoenix-portal/src/providers/QueryProvider.tsx:4-12` (config); pattern across `phoenix-portal/src/app/components/*.tsx` (~75 `useQuery` calls in 30 files; only 4 components read `isError`: `Dashboard.tsx`, `Community.tsx`, `NextWorkoutWidget.tsx`, `RoutineDetail.tsx`).
**Observation:** `QueryProvider` is configured with `retry: 1` and `refetchOnWindowFocus: false`. After one retry, a failed query parks indefinitely. Most consumers only read `data` and `isPending` — when `data === undefined` post-failure, they show empty states like "No workouts yet" / "No personal records yet" / hidden cards rather than "Couldn't load." Examples:
- `Profile.tsx:145-173` — 8 `useQuery` calls, zero error checks. A failed `profileOptions` displays "?" initials, blank Subscription card, blank stats — looks like a brand-new user.
- `Recovery.tsx:88-91` (FreeRecoveryView) — `workouts` query failure silently shows "0 rest days" → suggests user didn't train.
- `Analytics.tsx:488-516` — 8 queries, no error path. Volume tab silently flatlines.
- `Leaderboard.tsx`, `Integrations.tsx`, `WorkoutHistory.tsx`, `RoutinesEnhanced.tsx`, `Challenges.tsx`, `ExerciseProgress.tsx` — same pattern.
**Why it hurts:** A user on a flaky connection (or hitting an outage, or with an expired token that hasn't triggered re-auth) sees what looks like *empty state* — they think their data is missing or wasn't synced. They will retry with the back/forward button, switch tabs, then escalate to support: "I lost my workouts." There's also no perceived feedback loop to differentiate slow load from broken load.
**Severity rationale:** CRITICAL because it conflates "no data" with "data unreachable" — semantic data-loss illusion. `react-error-boundary` only catches throws during render, not query failures, so the global ErrorFallback never trips for these.
**Proposed fix (design-spike, ≥1 day):**
1. **Quick win (same day):** Set `throwOnError: true` in `QueryProvider` defaults (or per-page) for queries on protected routes, so they propagate to `PageErrorFallback` in `AppLayout.tsx:71`. PageErrorFallback already handles non-chunk errors with a "Try Again" button.
2. **Better:** Build a shared `<QueryStateBoundary loading={…} error={…} empty={…}>` wrapper that takes `isPending`/`isError`/`isEmpty` and renders the right UI. Replace the bespoke skeletons across 30+ components.
3. Add a global toast handler on `queryClient.getQueryCache().subscribe(…)` for `error` events so silent failures at least surface in a non-modal banner.
4. Consider `retry: 2` and exponential backoff for transient network errors (matches the mobile sync philosophy in `Project-Phoenix-MP/CLAUDE.md`).
**Parity flag:** YES — mobile has explicit sync error UI per the SyncManager docs; portal does not match.

---

### F-005 [HIGH] No mobile→portal sync confirmation; users can't tell when fresh data has arrived

**Surface:** Portal
**Category:** 3, 8
**Location:** `phoenix-portal/src/hooks/useRealtimeSync.ts:23-110`
**Observation:** The hook listens for `sync_complete` Supabase broadcasts and silently calls `queryClient.invalidateQueries(...)` for ~13 query families. There is no toast, banner, header pulse, or live indicator. Compare to `OfflineBanner.tsx` (loud, fixed-top destructive banner): the *negative* event has a strong affordance, the *positive* event has none.
**Why it hurts:** A user finishing a workout looks at their portal expecting their last set to appear. Because invalidation just refreshes data, on a fast-enough render they may not even register the swap. On a slow render, the spinner/skeleton briefly shows, then numbers update — but the user can't be sure: "did my mobile actually push, or am I looking at cache?" Also, debounced 400ms invalidation can skip a renders-during-burst, masking failed syncs.
**Severity rationale:** HIGH because it weakens the core value prop (real-time companion to mobile). Not CRITICAL because it doesn't break tasks — but it materially erodes trust in the portal. Cross-platform parity gap: mobile has visible "Syncing…" indicators; portal is silent.
**Proposed fix (quick-win, ≤2 hr):** Add a brief, dismissible toast on each `sync_complete` ("Synced from mobile · just now"), throttled to once per 30s. Use the existing `Toaster` from `AppLayout.tsx:90`. Bonus: a tiny "Last sync: 12s ago" badge in the AppSidebar header next to the Phoenix Portal wordmark, derived from a Zustand store updated in the broadcast handler.
**Parity flag:** YES — mobile sync visibility; portal absent.

---

### F-006 [HIGH] Hardcoded `#FF6B35`/`#DC2626` everywhere bypasses theme tokens; brand-color migration risk

**Surface:** Portal
**Category:** 1 (Visual design & brand consistency)
**Location:** ~30 components hardcode primary hex. Worst offenders:
- `phoenix-portal/src/app/components/Dashboard.tsx:587-590, 906-909` — `drop-shadow(0 0 10px #FF6B35) → 0 0 20px #DC2626` inside Framer Motion `animate.filter` keyframes (mobile + desktop streak card duplicate).
- `phoenix-portal/src/app/components/WhatsNewBanner.tsx:40-65` — backgrounds, borders, sparkle color, text color all hardcoded to `#FF6B35`/`#DC2626`/`#F59E0B`/`#9CA3AF`.
- `phoenix-portal/src/app/components/FeatureHint.tsx:55-65` — tooltip background `#1A1A1A`, border `#FF6B35/30`, text `#9CA3AF`, all literal.
- `phoenix-portal/src/app/components/analytics/BodyTab.tsx:213-230` — heatmap legend uses 5-stop ember scale all hardcoded.
- `phoenix-portal/src/app/components/CycleBuilder.tsx:774`, `cycle-builder/DayCard.tsx:89` — left-border on day cards.
- `phoenix-portal/src/app/components/Leaderboard.tsx:255, 429`, `RoutinesEnhanced.tsx:285`, `community/VoteButton.tsx:45`, `charts/ConsistencyWidget.tsx:96, 142, 166` — icon and stat colors.
- `phoenix-portal/src/app/components/InsightsFeed.tsx:33`, `FormAnalysis.tsx:253-265`, `analytics/RecommendationsPanel.tsx`, `analytics/SraRecoveryMatrix.tsx`, `analytics/VolumeLandmarks.tsx`, `MuscleHeatmap.tsx`, `LocalProfileFilter.tsx:14`, `ConsistencyCalendar.tsx:20`, `ui/skeleton.tsx`, `ui/tabs.tsx` — countless additional instances.
**Observation:** `theme.css` defines `--phoenix-ember`, `--phoenix-flame-red`, `--phoenix-gold`, `--primary`, etc., wired through `@theme inline`. The codebase pattern is clearly intended to be `text-primary`, `bg-primary`, `var(--primary)`. Hardcoded literals defeat that — the next theme tweak (e.g. lightening primary 5% for AA contrast on dark backgrounds) won't propagate.
**Why it hurts:** Future theme changes (or per-tier theming, or a light-mode pivot) require a 30-file find-replace. Already a parity concern — mobile uses `PhoenixOrangeDark #FF9149` per the charter, portal hardcodes `#FF6B35`. Anyone refreshing the brand palette has to chase down literals.
**Severity rationale:** HIGH because it's a maintenance bomb spread across the codebase, not a single bug. The drop-shadow keyframes are the most visible because they animate, and Framer Motion can't accept CSS variables in keyframe values without an extra hop. POLISH would be one stray hex; 30 files is HIGH.
**Proposed fix (design-spike, ≥1 day):**
1. Add a helper `getThemeColor('primary')` that reads `getComputedStyle(document.documentElement).getPropertyValue('--primary')` for places that need string hex (e.g. Framer Motion, Recharts).
2. Replace all `#FF6B35` literals with `var(--phoenix-ember)` in CSS, `text-primary`/`bg-primary` in className, and `PHOENIX.ember` (already exported from `lib/colors.ts`) for inline-style.
3. Add a Biome custom rule banning literal hex in `.tsx` outside of `lib/colors.ts` and `charts/shared/`.
**Parity flag:** YES — mobile orange is `#FF9149` per charter, portal is `#FF6B35`. Charter calls this out as already-known doc rot. Both surfaces should converge.

---

### F-007 [HIGH] FREE-tier user lands on "/dashboard" → sees `SubscribedRoute` blocking 80% of nav

**Surface:** Portal
**Category:** 2, 9, 10
**Location:** `phoenix-portal/src/app/routes/index.tsx:175-205` and `routes/SubscribedRoute.tsx:17-25` and `components/AppSidebar.tsx:63-90`
**Observation:** Auth callback sends every signed-in user to `/dashboard` (`AuthCallback.tsx:82`). But `/dashboard` is gated behind `<SubscribedRoute requiredTier="EMBER">`. A FREE user signing in lands on the `UpgradePrompt` (`SubscriptionGate` fallback), not a usable surface. The AppSidebar lists Dashboard, Workouts, Analytics, Routines, Cycles, Community, Challenges, Leaderboard — every single one of those is paywalled (EMBER or FLAME). Only Profile, Subscription, Pricing, and FAQ-via-public route are reachable.
**Why it hurts:** Brand-new FREE user finishes auth, sees a generic "Upgrade to Ember" upsell with no context for what they just signed up for, and most nav items are silently failing or showing the same upsell. There is no "what you can do for free" view — `OnboardingOverlay` runs once but immediately drops into the paywall. This is a textbook "dead-end first run."
**Severity rationale:** HIGH because it sabotages signup→activation. Not CRITICAL because the user *can* navigate to Profile and Pricing, but they have no reason to stay logged in past the first 5 seconds.
**Proposed fix (design-spike, 1 day):**
1. Add a FREE-tier dashboard at `/dashboard` (no SubscriptionGate) that surfaces what the FREE user *does* get: 1 goal, 30-day history (which `WorkoutHistory.tsx:168-181` already gates), basic profile, link to mobile app. Move the Upgrade to a banner inside that dashboard, not a wholesale page replacement.
2. Move SubscriptionGate enforcement *inside* each gated page (where some surface is allowed and some is locked) instead of at the route level. The current approach trips the gate before the user understands the page exists.
3. AppSidebar should show locked icons (greyed Lock overlay) for paywalled items so users learn the value map before clicking.
**Parity flag:** YES — mobile likely has a different first-run because it's the source of the workout data. Confirm with mobile audit.

---

### F-008 [HIGH] Inconsistent loading affordances across surfaces

**Surface:** Portal
**Category:** 1, 3
**Location:** Pattern across `Dashboard.tsx`, `WorkoutHistory.tsx`, `RoutinesEnhanced.tsx`, `Profile.tsx`, `Recovery.tsx`, `Analytics.tsx`, `RoutineBuilder.tsx`, `CycleBuilder.tsx`, `RoutineDetail.tsx`, `SessionDetail.tsx`, `PageLoading.tsx`
**Observation:** At least four distinct loading-state styles coexist:
1. **PageLoading flame**: animated Lucide flame in `PageLoading.tsx`, used by `Suspense` fallback in router.
2. **Custom flat spinner**: `Loader2` from lucide spinning, used in `RoutineBuilder.tsx:392-401`, `CycleBuilder.tsx:334-343`, `RoutineDetail.tsx:85-96`, `AuthCallback.tsx:117`.
3. **Skeleton-driven layouts**: Dashboard, Profile, RoutinesEnhanced, WorkoutHistory use `Skeleton` primitives.
4. **Animate-pulse blocks**: `Recovery.tsx:198-205` uses raw `animate-pulse` divs instead of the `Skeleton` component.
**Why it hurts:** Visually noisy. Users on slow connections see 3 different spinners on a single navigation. The flame animation in `PageLoading.tsx:8-32` is also on every route transition because of `Suspense` in `routes/index.tsx:157-220` — each `lazyWithReload` chunk gates on this. Then once mounted, individual skeletons appear. So the perceived flow is: route loads → flame → skeleton → data.
**Severity rationale:** HIGH because it compounds with F-004 (no error UI) and F-005 (no sync feedback) to make any non-instant load feel chaotic. MEDIUM if it were a single inconsistency; HIGH because of the layered effect.
**Proposed fix (design-spike, 1 day):**
- Standardize on Skeleton-based layout-preserving loaders. Reserve the flame animation for hard route splits (≥500ms cumulative). For everything in <500ms, show static dimmed skeletons. Replace ad-hoc `Loader2` spinners on full-page loads with skeletons that match the page layout.
- Create a `<LoadingFlame size="sm|md|lg" />` for in-button or inline use, deprecating the standalone `PageLoading.tsx` to a true blocking-interrupt only.
**Parity flag:** N/A (portal-internal)

---

### F-009 [HIGH] Reset-Password page brands as "Project Phoenix" — inconsistent with rest of app

**Surface:** Portal
**Category:** 1, 9
**Location:** `phoenix-portal/src/app/components/ResetPassword.tsx:54-58`
**Observation:** The brand wordmark in the reset-password card reads `Project Phoenix`. AppSidebar (`AppSidebar.tsx:191`) and AuthCallback (`AuthCallback.tsx:111`) both say `Phoenix Portal`. LandingPage uses `Phoenix Portal`. FAQ uses `Phoenix Portal` and `Project Phoenix` interchangeably as the umbrella project name vs the portal product.
**Why it hurts:** A user just reset their password and signs in — they think they ended up on a different product. Trust hit during a flow that's already anxiety-inducing.
**Severity rationale:** HIGH because reset-password is a security-adjacent flow where users actively look for brand consistency to avoid phishing. CRITICAL would be a credentials-eating phishing risk; this is reputational.
**Proposed fix (quick-win, ≤30 min):** Change `Project Phoenix` → `Phoenix Portal`. Search-and-fix for any other rogue brand strings (`Project Phoenix` likely appears as the umbrella project name in FAQ.tsx, that one is correct).
**Parity flag:** N/A

---

### F-010 [HIGH] Goals descriptions hardcode "kg" — ignores user's lbs preference

**Surface:** Portal
**Category:** 5, 8
**Location:** `phoenix-portal/src/app/components/Goals.tsx:155-160` and `:168-171`
**Observation:** `getGoalDescription()` and `getProgressText()` build labels like `"${goal.target_value.toLocaleString()} kg per week"` and `"${achieved.toLocaleString()}/${goal.target_value.toLocaleString()} kg this week"`. The user's `profile.weight_unit` (which the rest of the app respects via `formatVolume` / `formatWeight` in `lib/units.ts`) is never consulted.
**Why it hurts:** A US user with `weight_unit = "lbs"` types `5000` as their weekly volume target (intending pounds). The description says "5,000 kg per week" — that's 11,000 lbs, an absurd target. They edit, they re-type, they second-guess what they entered. The form input itself doesn't show the unit either, so the bug compounds.
**Severity rationale:** HIGH because it's a unit-handling bug in a form-heavy flow (charter category 5). Workout volume in lbs vs kg is the exact parity-critical surface called out in `CLAUDE.md` ("Per-cable weight convention"). Mobile is unit-aware; portal Goals isn't.
**Proposed fix (quick-win, ≤2 hr):** Pull `unit` from `profileOptions(user.id).weight_unit` and pipe through `getGoalDescription` / `getProgressText`. Use `formatVolume(goal.target_value, unit)`. Backfill the input form with `getUnitLabel(unit)` so users know what unit they're typing.
**Parity flag:** YES — mobile uses user-preferred units; portal Goals doesn't.

---

### F-011 [HIGH] PortalBanner dismissal is non-persistent; banner re-shows on every page

**Surface:** Portal
**Category:** 1, 9
**Location:** `phoenix-portal/src/app/components/PortalBanner.tsx:5-42` (used by `Dashboard.tsx:888`)
**Observation:** PortalBanner uses local `useState(false)` for `dismissed`. Click X → component remounts on next nav → banner reappears. Compare with `WhatsNewBanner` (persisted via `dismissWhatsNew.mutate()` on `useOnboarding` hook) and `Recovery.tsx:33` (`localStorage.getItem(DISCLAIMER_KEY)`).
**Why it hurts:** Users who already understand the portal-mobile relationship are re-told it on every dashboard visit. They learn that the X button doesn't work — banner-blindness sets in, and the actually-useful `WhatsNewBanner` (sibling component) gets ignored too.
**Severity rationale:** HIGH because dismissibility is a basic IA contract that this component breaks. Banner-blindness has downstream impact on real announcements.
**Proposed fix (quick-win, ≤1 hr):** Persist via `localStorage.setItem('phoenix-portal-banner-dismissed', '1')` (or a new column on the onboarding row, mirroring `dismissed_hints`). Or better, fold this banner into `OnboardingOverlay` content so it only shows during first-run.
**Parity flag:** N/A

---

### F-012 [HIGH] No error states on data-dense surfaces — "no data" masquerades as success

**Surface:** Portal
**Category:** 3, 6
**Location:** `phoenix-portal/src/app/components/Analytics.tsx:472-1000+` (8 queries, no isError); `Recovery.tsx:182-280`; `Profile.tsx:145-173`; `WorkoutHistory.tsx:151-200`; `Leaderboard.tsx:200+`; `Biomechanics.tsx:113-200`.
**Observation:** A representative pattern from `Analytics.tsx:492-516`:
```ts
const { data: volumeRaw, isPending: volumePending } = useQuery(volumeTrendOptions(...));
const { data: muscleGroupRaw, isPending: musclePending } = useQuery(muscleGroupOptions(...));
// ... 6 more queries, none read isError
```
Below, the chart renders `volumeRaw ?? []` and shows "No data yet" empty state when the query failed. Biomechanics is the only data-heavy page that has an `ErrorCard` retry component (`Biomechanics.tsx:73-97`), but it's only used for the workouts query, not for any of the telemetry/summary queries below it.
**Why it hurts:** Repeats F-004 specifically on surfaces where users come for data. They came to Analytics to see a chart; they see "No data yet" or a flat axis; they assume their workouts didn't track properly and panic.
**Severity rationale:** HIGH (repeats F-004 but specifically on data-dense surfaces). Critical-adjacent because this is *where users notice missing data*.
**Proposed fix (design-spike, 1 day):** Per F-004 fix, plus extract `Biomechanics.tsx:ErrorCard` into a shared `<ChartError onRetry />` and use it in every chart-section in Analytics, Recovery, ExerciseProgress.
**Parity flag:** YES — mobile audit will likely find similar; cross-check.

---

### F-013 [MEDIUM] Inconsistent destructive-action confirmation patterns

**Surface:** Portal
**Category:** 5
**Location:** `phoenix-portal/src/app/components/DeleteConfirmDialog.tsx:24-76` (used by RoutinesEnhanced, TrainingCycles); `Profile.tsx:113-137` (cancel-subscription with no separate confirm dialog — uses `setConfirmCancel` state); `Goals.tsx:471` (archive button — *no* confirmation at all).
**Observation:** Three different destructive-action patterns:
1. RoutinesEnhanced/TrainingCycles use `DeleteConfirmDialog` (good — clear preserve-history language).
2. Profile cancel-subscription uses `AlertDialog` inline (`Profile.tsx:25-34` import) with similar UX.
3. Goals archive button has *no* confirmation: `onClick={() => archiveGoal.mutate(goal.id)}` (`Goals.tsx:471`). Same with restore button (`:583-594`). One misclick = goal disappears.
**Why it hurts:** Inconsistent users learn to expect a confirm. A user dragging the cursor over the Goals card who accidentally hits the Archive icon sees their goal vanish. Archive is reversible but not obvious — there's a "Show Archived" toggle but only if the user knows to look.
**Severity rationale:** MEDIUM because Archive is reversible (Restore button exists), and the deletion happens via mutation that the user can probably re-trigger. Would be HIGH if it were destructive.
**Proposed fix (quick-win, ≤2 hr):** Add a confirmation toast or `AlertDialog` for goal archive. Or implement a 5-second "Archived. Undo." toast (sonner supports actions). Same for any single-click destructive elsewhere.
**Parity flag:** YES — mobile likely has different patterns; needs convergence.

---

### F-014 [MEDIUM] OnboardingOverlay drops user into a paywall for FREE accounts

**Surface:** Portal
**Category:** 9, 10
**Location:** `phoenix-portal/src/app/components/OnboardingOverlay.tsx:25-76` and `routes/AppLayout.tsx:61-65`
**Observation:** OnboardingOverlay is a Dialog modal with three slides describing portal features (Analytics, Community, Session Replay). Steps 1–3 are tier-agnostic. After "Go to Dashboard" is clicked, the user lands on a SubscriptionGate paywall (per F-007). The onboarding showcased features the FREE user can't access.
**Why it hurts:** Onboarding promises analytics, community, replay; reality delivers an upsell. Users feel bait-and-switched on first-run.
**Severity rationale:** MEDIUM because it's a copy/positioning issue, not a broken flow. HIGH would mean blocking activation entirely; here the user can find Pricing on their own.
**Proposed fix (design-spike, 1 day):** Branch onboarding by tier. FREE users see steps focused on what they actually get + a final upsell slide. Paid users see the feature tour as-is.
**Parity flag:** N/A

---

### F-015 [MEDIUM] Mobile bottom-nav hides 75% of nav under "More" — discoverability cliff

**Surface:** Portal
**Category:** 2
**Location:** `phoenix-portal/src/app/components/MobileBottomNav.tsx:29-59`
**Observation:** Primary mobile nav surfaces 4 items (Dashboard, Workouts, Analytics, Community). Hidden under "More" drawer: Routines, Cycles, Challenges, Leaderboard, Profile, Integrations, Subscription. Out of 11 destinations, 7 are buried.
**Why it hurts:** Routines and Cycles are arguably *primary* training surfaces (training-cycle workflow described in mobile CLAUDE.md is portal-primary for cycle building). Putting them under More forces an extra tap on every cycle-edit session. Active state for the More button correctly shows, but users who don't know about the drawer find Cycles only by going to Pricing first.
**Severity rationale:** MEDIUM because the user *can* reach everything; it's friction, not blockage.
**Proposed fix (design-spike, 1 day):** Reorder primary mobile items based on usage data (training surfaces are likely high-traffic — Routines/Cycles deserve primary slots over Community). Or use a 5+1 layout (5 primary + More). Reduce the More drawer to truly secondary items (Profile, Integrations, Subscription).
**Parity flag:** YES — confirm with mobile audit which surfaces are primary on the phone.

---

### F-016 [MEDIUM] PageShell horizontal padding doesn't match all callers; layout drift

**Surface:** Portal
**Category:** 1
**Location:** `phoenix-portal/src/app/components/PageShell.tsx:8-16` (`max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8`); compare with `Dashboard.tsx:483` (mobile welcome) `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16`; `WorkoutHistory.tsx:127`'s sticky header `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6`; `Goals.tsx:338,369` `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8`; `Recovery.tsx:108,211` `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8`.
**Observation:** Three different max-width systems (`max-w-7xl`, `max-w-5xl`, `max-w-4xl`) and two padding scales (`px-4 md:px-6` vs `px-4 sm:px-6 lg:px-8`) coexist. PageShell is used inconsistently — some pages use it, some bypass it for custom containers.
**Why it hurts:** Visual rhythm breaks when navigating Dashboard → History → Goals: content shifts horizontally. The 4xl/7xl split creates an inconsistent reading experience on wide monitors.
**Severity rationale:** MEDIUM because it's a polish/consistency issue, but pervasive enough to affect every page transition.
**Proposed fix (design-spike, 1 day):** Pick one scale per surface category (data-dense → 7xl, form/profile → 4xl, narrow forms → 2xl). Add variants to PageShell: `<PageShell variant="data" | "form" | "narrow">`. Migrate all surfaces.
**Parity flag:** N/A

---

### F-017 [MEDIUM] Dashboard streak progress math is misleading

**Surface:** Portal
**Category:** 6, 9
**Location:** `phoenix-portal/src/app/components/Dashboard.tsx:614-626`
**Observation:** Mobile streak card shows progress: `(streak / Math.max(Math.ceil(streak / 7) * 7, 7)) * 100`. So a 7-day streak shows "7/7 day goal", 100%. Day 8 shows "8/14 day goal", 57%. Day 14 shows "14/14 day goal", 100%.
**Why it hurts:** The "goal" auto-rounds up to the next 7-day boundary, so the progress always teases full at multiples of 7. Users learn that "100% goal" means nothing — there's no actual goal, just rounding. It also reads as a regression on day 8 (was 100%, now 57%).
**Severity rationale:** MEDIUM because it's a UX pattern issue, not a bug. The streak number itself is correct.
**Proposed fix (quick-win, ≤2 hr):** Either remove the goal bar entirely (just show streak number), or implement actual goal-setting (e.g. user picks a target streak length in profile, or use the longest historical streak as the goal). Tie to Goals system.
**Parity flag:** YES — mobile probably has a similar streak surface; align on goal semantics.

---

### F-018 [MEDIUM] FormAnalysis hardcodes status colors; bypass `signal-*` tokens

**Surface:** Portal
**Category:** 1, 6
**Location:** `phoenix-portal/src/app/components/FormAnalysis.tsx:23-27`
**Observation:** `getStatusColor()` returns `#10B981` / `#F59E0B` / `#EF4444` for good/warning/critical. theme.css defines `--signal-ok: #00e676`, `--signal-warn: #ffab00`, `--signal-danger: #ff5252` for exactly this purpose.
**Why it hurts:** A "form score 80" shows as green here but as a slightly different green (`#10B981`) than the success states elsewhere (`#00e676`). Users notice the inconsistency on a glance, even if they can't articulate it.
**Severity rationale:** MEDIUM (color drift in a high-stakes surface — form analysis suggests technique).
**Proposed fix (quick-win, ≤30 min):** Replace literals with `var(--signal-ok)`, `var(--signal-warn)`, `var(--signal-danger)`.
**Parity flag:** YES — mobile uses the same Signal palette per charter; converge.

---

### F-019 [POLISH] CookieConsentBanner can hide bottom CTAs on mobile

**Surface:** Portal
**Category:** 1
**Location:** `phoenix-portal/src/app/components/CookieConsentBanner.tsx:37` and `main.tsx:37`
**Observation:** Banner is `position: fixed bottom-0 left-0 right-0 z-50 p-4`. The `MobileBottomNav.tsx:99` is `fixed bottom-0 left-0 right-0 z-50`. They share `z-50`. The cookie banner mounts via `main.tsx`, outside the AppLayout. On mobile, the cookie banner can overlap the bottom nav (or vice-versa, depending on z-index resolution at the same level).
**Why it hurts:** First-time visitors hitting an authenticated app could see a stack of fixed bottom UI: cookie banner + mobile bottom nav. Possible tap-target collision.
**Severity rationale:** POLISH because most users hit consent on the public landing page (no MobileBottomNav), so this is a corner case.
**Proposed fix (quick-win, ≤30 min):** Bump banner to `z-[60]` and add `bottom-16 md:bottom-0` to clear the mobile nav when both are rendered. Or only render banner when not authenticated.
**Parity flag:** N/A

---

### F-020 [POLISH] AppSidebar collapsed state hides streak indicator with no tooltip

**Surface:** Portal
**Category:** 1, 9
**Location:** `phoenix-portal/src/app/components/AppSidebar.tsx:279-298`
**Observation:** When the sidebar is collapsed (auto at <1280px or user-toggled), the avatar dropdown's display name and streak flame are hidden via `group-data-[collapsible=icon]:hidden`. The avatar fallback initials remain. Hovering the avatar shows a dropdown menu but no tooltip with the streak number.
**Why it hurts:** Power users on smaller laptops (1280×800 etc.) auto-collapse and lose visibility of their streak — a key motivational signal that the streak hook is specifically built for.
**Severity rationale:** POLISH because the streak is still in the dashboard.
**Proposed fix (quick-win, ≤30 min):** When collapsed, replace the hidden DisplayName/streak with a small flame badge overlay on the avatar (similar to the dashboard streak indicator pattern in MobileBottomNav). Add a Tooltip wrapper showing display name + streak.
**Parity flag:** N/A

---

### F-021 [POLISH] WhatsNewBanner X button uses 44px min size — overdoes mobile target on desktop

**Surface:** Portal
**Category:** 7
**Location:** `phoenix-portal/src/app/components/WhatsNewBanner.tsx:64`
**Observation:** The dismiss button hardcodes `min-w-[44px] min-h-[44px]` even on desktop. theme.css already provides `@media (pointer: coarse) { button { min-height: 44px ... } }` (lines 547-565), so coarse pointers (touch) get 44px automatically; fine pointers (mouse) shouldn't need it. This makes the X button awkwardly large on desktop relative to its visual weight (a 16px icon).
**Why it hurts:** Visual asymmetry — the dismiss button looks oversized relative to the 5px sparkle icon next to it.
**Severity rationale:** POLISH (it's actually *more* accessible than necessary, just unbalanced visually).
**Proposed fix (quick-win, ≤15 min):** Remove the hardcoded `min-w-[44px] min-h-[44px]`; let theme.css's pointer:coarse media query handle it. Add `size="icon"` to `Button` for proper sizing.
**Parity flag:** N/A

---

### F-022 [MEDIUM] Subscription status not surfaced anywhere in main shell

**Surface:** Portal
**Category:** 2, 10
**Location:** `phoenix-portal/src/app/components/AppSidebar.tsx:284-285` (TierBadge in collapsed avatar footer); `Profile.tsx:391-410` (Subscription card)
**Observation:** TierBadge appears in the AppSidebar avatar footer, but only when sidebar is expanded. There's no persistent header bar showing tier/billing status. A user concerned about whether their subscription is active (post-cancellation, after a webhook delay, after upgrade) has to navigate to Profile to confirm.
**Why it hurts:** Billing trust requires constant ambient feedback. Currently only the TierBadge gives that, and it's hidden when the sidebar collapses (most users at <1280px).
**Severity rationale:** MEDIUM because the Profile page is one click away.
**Proposed fix (quick-win, ≤2 hr):** Add a small TierBadge to the mobile bottom nav (next to "More") and to the desktop top of `PageShell` (small line above the page header). For users with `cancelAtPeriodEnd`, show an amber dot near the badge.
**Parity flag:** N/A
