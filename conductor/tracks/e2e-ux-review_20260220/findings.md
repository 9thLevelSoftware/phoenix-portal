# Phoenix Portal — Comprehensive E2E UX/UI Review

**Date:** 2026-02-20
**Scope:** All 25 routes, 80+ components, every button/link/flow
**Mobile App Context:** Portal is the premium web companion for [Project Phoenix MP](https://github.com/9thLevelSoftware/Project-Phoenix-MP), a community rescue app for Vitruvian Trainer machines. The mobile app (v0.5.0) is currently local-first with no cloud sync — meaning the portal's entire data layer is waiting for sync infrastructure that doesn't exist yet on the mobile side.

---

## Summary

| Severity | Count |
|----------|-------|
| **Critical** (dead ends, broken flows) | 52 |
| **Major** (stubs, incomplete features) | 58 |
| **Minor** (UI polish, UX improvements) | 55 |
| **Dead Code Files** | 5 |
| **Total Findings** | 170 |

---

## SYSTEMIC ISSUES (Cross-Cutting)

These affect the entire application and should be addressed first.

### S1. Celebration System is Entirely Orphaned
**All 5 celebration components** (`BadgeEarned`, `PRCelebration`, `StreakMilestone`, `WorkoutComplete`, `ChallengeWon`) are fully built with polished animations but **none are triggered by any event in the application**. The `/celebrations` demo route exists but is not in any nav menu. The entire celebration system is disconnected.

### S2. Session Replay is Unreachable
`/replay/:sessionId` has a full implementation but **no component in the app links to it**. Not from SessionDetail, not from WorkoutHistory, not from PersonalRecords, not from Dashboard. The only access is typing the URL manually.

### S3. Streak is Permanently Zero
`useUIStore`'s `streak` is initialized to `0` and `setStreak()` is never called anywhere. The `useStreak` hook exists and works but is never connected to the store. Navigation shows "0 day streak" permanently. `MobileBottomNav` hides the streak flame because `streak > 0` is always false.

### S4. Notifications are Permanently Zero
`notifications.challenges` and `notifications.community` are both `0` by default and `setNotifications` is never called. The notification bell in desktop nav has no `onClick` handler. The mobile nav's red dot always pulses despite zero notifications.

### S5. Five Dead Code Files
| File | Status |
|------|--------|
| `Routines.tsx` | Legacy, replaced by `RoutinesEnhanced.tsx`, all buttons dead |
| `RoutineBuilderEnhanced.tsx` | Never routed, exercise picker never renders |
| `CycleBuilderMain.tsx` | Never routed, uses `alert()` and `window.confirm()` |
| `SupersetComponents.tsx` | Orphaned, references nonexistent `transitionTime` field |
| `StravaConnect.tsx` | Never imported, replaced by `ProviderCard` |

### S6. `duration_seconds` Naming Inconsistency
The Zod transform converts `duration_seconds` to minutes (`Math.round(s / 60)`) but the field retains the name `duration_seconds`. Every component renders it with an "m" or "min" suffix. The value is correct but the field name is deeply misleading and will cause future bugs.

### S7. Privacy Policy is Factually Inaccurate
Claims "We do not collect any personal information," "No Cloud Sync," "No Account Required," and "No External Servers." The web app uses Supabase for auth, stores user accounts with email, and syncs workout data to the cloud. This is a legal/trust liability.

### S8. Premium Features Silently Disappear for Free Users
`GoalDashboardWidget`, `RecoveryDashboardWidget`, and several other premium-gated components return `null` for free users with no teaser, no upgrade prompt, and no explanation. Free users see gaps in the layout.

### S9. `user?.id` Passed as Potentially Undefined to Queries
Multiple components pass `user?.id` to query options that expect `string`. Found in: `RoutinesEnhanced`, `TrainingCycles`, `WorkoutHistory`, `ComparisonSessionPicker`. Can cause Supabase queries with `.eq("user_id", undefined)`.

### S10. `useSearchParams.get` as Effect Dependency
Both `Integrations.tsx` and `Profile.tsx` use `searchParams.get` (a method reference) in effect dependency arrays, causing effects to run on every render.

---

## CRITICAL FINDINGS — Dead Ends & Broken Flows

### Navigation & Routing

| # | Finding | Location |
|---|---------|----------|
| C1 | **4 routes unreachable from any nav**: `/compare`, `/pricing`, `/celebrations`, `/replay/:sessionId` have no nav entry on desktop or mobile | `routes/index.tsx` |
| C2 | **Notification bell has no onClick handler** — renders animated red dot but clicking does nothing | `Navigation.tsx:95-103` |
| C3 | **Avatar hardcoded to "JD"** for all users regardless of identity | `Navigation.tsx:118-119` |
| C4 | **OfflineBanner overlaps Navigation** — both use `fixed/sticky top-0`, banner at z-100 covers nav with no layout shift | `OfflineBanner.tsx:30`, `AppLayout.tsx` |
| C5 | **OnboardingOverlay X-button permanently marks onboarding complete** — accidental dismiss writes to DB, user never sees it again | `OnboardingOverlay.tsx:104` |

### Landing Page & Auth

| # | Finding | Location |
|---|---------|----------|
| C6 | **"View Features" hero button has no onClick** — primary CTA does nothing | `LandingPage.tsx:595-601` |
| C7 | **8 footer links are dead** — Features, Pricing, Integrations, Roadmap, About, Blog, Careers, Contact all have `cursor-pointer` but no `href` or `onClick` | `LandingPage.tsx:787-816` |
| C8 | **Pricing tier selection not persisted** — clicking "Rise Now" or "Forge Ahead" opens generic auth dialog, tier choice is lost | `LandingPage.tsx:723-731` |
| C9 | **ResetPassword has no token validation** — renders password form without checking for valid recovery session, no "link expired" state | `ResetPassword.tsx` (entire file) |
| C10 | **ResetPassword has no "Back to Sign In" link** — expired token shows error with no escape route | `ResetPassword.tsx` |
| C11 | **Privacy Policy "Back" uses `navigate(-1)`** — direct URL visitors leave the app entirely | `PrivacyPolicy.tsx:24, 353` |
| C12 | **Privacy Policy GitHub link is absent** — "Open an issue on our GitHub repository" has no URL | `PrivacyPolicy.tsx:329-332` |

### Dashboard

| # | Finding | Location |
|---|---------|----------|
| C13 | **Recent Activity rows not clickable** despite `cursor-pointer` styling — no onClick, no Link wrapper | `Dashboard.tsx:424` |
| C14 | **"Badges Earned" stat shows permanent `--`** — no badge system exists | `Dashboard.tsx:503` |
| C15 | **"Recent Badges" card is permanent empty state** — dead UI on every dashboard visit | `Dashboard.tsx:631-643` |
| C16 | **Mobile notification bell fires toast** "Notifications coming in a future update" with permanently pulsing red dot | `DashboardMobile.tsx:203-210` |
| C17 | **Mobile pull-to-refresh defined but never wired** — `_handleRefresh` exists but no gesture listener calls it | `DashboardMobile.tsx:83-87` |
| C18 | **Mobile Recent Activity cards not tappable** despite `active:scale-[0.98]` touch feedback | `DashboardMobile.tsx:534-553` |

### Analytics & Biomechanics

| # | Finding | Location |
|---|---------|----------|
| C19 | **Body Part Analysis muscle cards are dead** — `cursor-pointer hover:scale-105` but no onClick | `Analytics.tsx:810-824` |
| C20 | **External tab empty state doesn't link to Integrations** — says "Connect fitness services in the Integrations page" with no link | `Analytics.tsx:963-969` |
| C21 | **Mobile "Body" tab is a hard stub** — renders static placeholder text, completely unimplemented | `AnalyticsMobile.tsx:574-589` |
| C22 | **Mobile "Trends" tab duplicates "Overview"** — identical chart with different gradient ID | `AnalyticsMobile.tsx:501-571` |
| C23 | **Biomechanics rep selector not exposed** — `selectedRep` hardcoded to 1, no UI to change | `Biomechanics.tsx:201` |

### Workout History & Session Detail

| # | Finding | Location |
|---|---------|----------|
| C24 | **Calendar view ignores date-range filter** — filter only applies in list view, calendar always shows all time | `WorkoutHistory.tsx:64-89, 318-427` |
| C25 | **"Save Notes" button has no onClick handler** — textarea is wired but Save is dead | `SessionDetail.tsx:514-519` |
| C26 | **"Share Summary" fires stub toast** "Session sharing coming in a future update" | `SessionDetail.tsx:477` |
| C27 | **Notes not loaded from database** — always initializes empty regardless of existing saved notes | `SessionDetail.tsx:43` |
| C28 | **No link to Session Replay from SessionDetail** — the natural navigation path is severed | `SessionDetail.tsx` (entire file) |

### Session Replay

| # | Finding | Location |
|---|---------|----------|
| C29 | **"Session" view mode toggle does nothing** — changes store value but no visual change | `SessionReplay.tsx:34-41` |
| C30 | **`currentSetIndex` not reset between sessions** — navigating between sessions lands on wrong/OOB set | `useReplayStore.ts:54` |
| C31 | **No navigation guard for OOB set index** — `nextSet()` increments without max bound check | `useReplayStore.ts:46` |

### Personal Records

| # | Finding | Location |
|---|---------|----------|
| C32 | **"Browse Routines" button in plateau alert has no onClick** — dead action in prominent warning card | `PersonalRecords.tsx:441-448` |

### Routines

| # | Finding | Location |
|---|---------|----------|
| C33 | **"View" button on routine cards has no onClick** — `Eye` icon button does nothing | `RoutinesEnhanced.tsx:317-324` |
| C34 | **"Duplicate" menu item is a stub** — no action, no handler | `RoutinesEnhanced.tsx:257-260` |
| C35 | **Favorite toggle not persisted** — resets on page reload, comment acknowledges this | `RoutinesEnhanced.tsx:46-58` |
| C36 | **Share dialog shares wrong routine** — all cards call same `setShareDialogOpen(true)` with no context | `RoutinesEnhanced.tsx:161-163` |
| C37 | **No post-save navigation in RoutineBuilder** — user stuck on builder after successful save | `RoutineBuilder.tsx:117-134` |
| C38 | **All sets share same reps/weight/rest** — no per-set differentiation in ExerciseDetailPanel | `RoutineBuilder.tsx:506-535` |

### Training Cycles

| # | Finding | Location |
|---|---------|----------|
| C39 | **"Activate" button has no onClick** — non-active cycles show button that does nothing | `TrainingCycles.tsx:331-338` |
| C40 | **Edit creates duplicate** — `useSaveCycle` is insert-only, no `useUpdateCycle` exists | `CycleBuilder.tsx:166-209`, `mutations/cycles.ts` |
| C41 | **No post-save navigation in CycleBuilder** — same as RoutineBuilder | `CycleBuilder.tsx:203-208` |
| C42 | **Duration label says "Days" but stores "Weeks"** — fundamental labeling mismatch | `CycleBuilder.tsx:385` |
| C43 | **Week at a Glance assumes 7 days** — cycles longer than 7 days silently truncated | `CycleBuilder.tsx:597-630` |
| C44 | **RoutinePickerModal search does nothing** — uncontrolled input with no value/onChange/state | `RoutinePickerModal.tsx:62-66` |
| C45 | **RoutinePickerModal "Create New Routine" has no onClick** — dead button | `RoutinePickerModal.tsx:147-151` |
| C46 | **Share dialog shares random cycle** — same issue as routines | `TrainingCycles.tsx:348-356` |

### Challenges

| # | Finding | Location |
|---|---------|----------|
| C47 | **"View Leaderboard" fires stub toast** — "Leaderboard coming in a future update" | `Challenges.tsx:395` |

### Community

| # | Finding | Location |
|---|---------|----------|
| C48 | **No "Share to Community" button in Community hub** — ShareContentDialog exists but is never rendered in the feed | `Community.tsx` |
| C49 | **"Linked to original" indicator in detail drawer** — not actionable, no deep link, no explanation | `CommunityDetailDrawer.tsx:177-182` |

### Integrations

| # | Finding | Location |
|---|---------|----------|
| C50 | **Fitbit connect silently fails** if `VITE_FITBIT_CLIENT_ID` is undefined — produces `client_id=undefined` in OAuth URL | `fitbit.ts:81` |
| C51 | **Garmin marked "untested, pending approval"** but Connect button is fully visible to ELITE users with no caveat | `garmin.ts:95-96` |

### Profile

| # | Finding | Location |
|---|---------|----------|
| C52 | **"Badges" tab is a complete empty stub** — shown to all users, no data, no backend, no timeline | `Profile.tsx:447-462` |

---

## MAJOR FINDINGS — Stubs & Incomplete Features

### Navigation & Shell

| # | Finding | Location |
|---|---------|----------|
| M1 | `CelebrationDemo` dev route exposed in production | `routes/index.tsx:147` |
| M2 | `showHints` returned from `useOnboarding` but never consumed — feature hints wired in hook but dead at UI layer | `AppLayout.tsx:31` |
| M3 | No redirect-back-to-intended-URL after login — always lands on `/dashboard` | `ProtectedRoute.tsx:13` |
| M4 | 13 nav items overflow on medium screens (768-1100px) — no collapse/scroll | `Navigation.tsx:29-43` |
| M5 | `signOut()` does not clear TanStack Query cache or Zustand stores — stale data persists across accounts | `AuthProvider.tsx:47-49` |
| M6 | `PortalBanner` is exported but never imported/used anywhere — dead component | `PortalBanner.tsx` |
| M7 | OnboardingOverlay Step 3 has empty features list — no guidance, no deep links | `OnboardingOverlay.tsx:72-75` |
| M8 | OnboardingOverlay has no "Back" button between steps | `OnboardingOverlay.tsx:188-197` |
| M9 | WhatsNewBanner features are plain text with no links to actual features | `WhatsNewBanner.tsx:11-15` |
| M10 | `ErrorFallback` exposes raw `error.message` to users — technical Supabase strings | `ErrorFallback.tsx:15` |
| M11 | Mobile safe-area classes `pb-safe` and `h-safe-area-inset-bottom` are non-standard — not defined in Tailwind v4 or theme.css | `MobileBottomNav.tsx:61, 251` |

### Dashboard & Analytics

| # | Finding | Location |
|---|---------|----------|
| M12 | Analytics `change` fields all empty strings — no period-over-period trends shown | `Analytics.tsx:430-454` |
| M13 | Time period filter doesn't apply to Strength or Muscle Group queries — only affects volume chart | `Analytics.tsx:292-296` |
| M14 | Export CSV exports only volume data despite button appearing on full Analytics page | `Analytics.tsx:401-415` |
| M15 | Mobile exercise names truncated to 8 chars without ellipsis ("Flat Ben") | `AnalyticsMobile.tsx:185` |
| M16 | MuscleHeatmap shows front-view only — no back view for pulling muscles (critical for Vitruvian) | `MuscleHeatmap.tsx:17-95` |
| M17 | MuscleHeatmap muscle group names must exactly match DB keys — mismatch = no data silently | `MuscleHeatmap.tsx:142` |
| M18 | Biomechanics has no mobile layout — desktop cards stack into unusable layout | `Biomechanics.tsx` |
| M19 | All 8 Biomechanics section icons are the same `Activity` icon — copy-paste placeholder | `Biomechanics.tsx:424-496` |
| M20 | Recovery "Chronic Average" bar hardcoded at 50% fill regardless of actual data | `Recovery.tsx:399` |
| M21 | Recovery has no mobile layout | `Recovery.tsx` |
| M22 | Recovery gating can show negative "days remaining" | `Recovery.tsx:294-299` |
| M23 | ForceCurve rep isolation feature fully implemented but no UI entry point | `charts/ForceCurve.tsx` + `Biomechanics.tsx:201` |

### Goals

| # | Finding | Location |
|---|---------|----------|
| M24 | ELITE users get same 3-goal cap as PHOENIX despite marketing saying "unlimited" | `Goals.tsx:186` |
| M25 | Goal type cannot be changed after creation despite edit dialog showing type tabs | `Goals.tsx:485-492` |
| M26 | Exercise name in PR goals is free-text — typos silently produce 0% progress | `Goals.tsx:728-735` |
| M27 | Archived goals are a hidden third state — no UI to view them | `Goals.tsx:374` |

### Workout & Sessions

| # | Finding | Location |
|---|---------|----------|
| M28 | Compare mode hidden from free users with no upgrade prompt or teaser | `WorkoutHistory.tsx:247-268` |
| M29 | 50-session hard limit with no "load more" — older workouts silently absent | `workouts.ts:27` |
| M30 | `print-only` CSS class likely not defined — print report header always visible or never visible | `SessionDetail.tsx:176, 524` |
| M31 | PersonalRecords "Browse Routines" plateau button is dead (see C32) | `PersonalRecords.tsx:441-448` |
| M32 | Timeline view shows only 3 most recent PRs + milestones — no "see all" | `PersonalRecords.tsx:635-711` |
| M33 | PR progression bar chart has no value labels, no tooltips, no interactivity | `PersonalRecords.tsx:535-563` |
| M34 | Muscle group filters hardcoded — custom exercises invisible under filters | `PersonalRecords.tsx:48, 363-376` |
| M35 | Session Replay `deriveRepBoundaries` is rough estimation, not actual data | `SessionReplay.tsx:274-292` |

### Routines & Cycles

| # | Finding | Location |
|---|---------|----------|
| M36 | No delete action for routines in RoutinesEnhanced | `RoutinesEnhanced.tsx` |
| M37 | Training mode description always says "Traditional resistance training" regardless of selection | `RoutineBuilder.tsx:578-580` |
| M38 | No empty-routine save guard — 0 exercises can be persisted | `RoutineBuilder.tsx` |
| M39 | `useUpdateRoutine` does delete-and-reinsert without transaction — can lose exercises | `mutations/routines.ts` |
| M40 | Cycle progress always shows same value — `current_week` hardcoded to 1 on insert | `TrainingCycles.tsx:168-173` |
| M41 | `last_used_at` never set — sorting by it produces wrong order | `mutations/cycles.ts` |
| M42 | CycleBuilder description field not populated from existing cycle on edit | `CycleBuilder.tsx:72` |
| M43 | Progression settings key format mismatch between builders (dashes vs underscores) | `CycleBuilder.tsx` vs `CycleBuilderMain.tsx` |
| M44 | Day 1 cannot be set to rest day — no remove button, no clear option | `CycleBuilder.tsx:754` |

### Community & Social

| # | Finding | Location |
|---|---------|----------|
| M45 | No "Share to Community" from Community hub — only from builder pages | `Community.tsx` |
| M46 | Desktop Community resets all filters on every mount | `Community.tsx:67` |
| M47 | No follow/unfollow in CreatorProfile — view-only | `CreatorProfile.tsx` |
| M48 | CommentThread edit window enforced client-side only — clock manipulation bypasses | `CommentThread.tsx:35` |
| M49 | ShareContentDialog raw `<input>` instead of shadcn `Input` — styling mismatch | `ShareContentDialog.tsx:243-249` |
| M50 | CommunityFilterPanel Sheet close discards filter selections — only "Apply" works | `CommunityFilterPanel.tsx` |

### Integrations

| # | Finding | Location |
|---|---------|----------|
| M51 | Entire Integrations page requires ELITE — Hevy CSV import paywalled behind top tier | `Integrations.tsx:66` |
| M52 | OAuth callback `useEffect` dependency array bug — runs on every render | `Integrations.tsx:47` |
| M53 | No disconnect confirmation dialog — immediate mutation with no warning | `Integrations.tsx` |
| M54 | HevyConnect CSV import embedded in UI component — business logic not separated | `HevyConnect.tsx:181-183` |

### Profile & Pricing

| # | Finding | Location |
|---|---------|----------|
| M55 | Profile header hardcodes "Phoenix Member" for all tiers | `Profile.tsx:241-244` |
| M56 | Notification settings toggles stored but no delivery mechanism exists | `Profile.tsx` |
| M57 | No avatar upload — AvatarImage shown but no edit/upload UI | `Profile.tsx:213-218` |
| M58 | Missing Stripe price IDs cause silent error toast — no "coming soon" fallback | `PricingPlans.tsx:129-131` |

---

## MINOR FINDINGS — UI Polish & UX Improvements

<details>
<summary>Click to expand 55 minor findings</summary>

### Navigation & Shell
1. No 404 feedback — wrong URLs silently redirect to `/dashboard` (`routes/index.tsx:149`)
2. Logout button has no loading state (`Navigation.tsx:124-134`)
3. `TierBadge` returns null during loading causing layout shift (`TierBadge.tsx:23`)
4. Mobile "More" drawer doesn't close on browser back (`MobileBottomNav.tsx`)
5. OnboardingOverlay progress dots not clickable (`OnboardingOverlay.tsx:173-185`)
6. OnboardingOverlay uses hardcoded hex colors instead of CSS variables (`OnboardingOverlay.tsx:105, 134, 146`)
7. WhatsNewBanner dismiss button below 44x44px minimum touch target (`WhatsNewBanner.tsx:63`)
8. ErrorFallback "Try Again" button is raw `<button>` not shadcn `Button` (`ErrorFallback.tsx:17`)
9. PageLoading spinner off-center with `min-h-[50vh]` (`PageLoading.tsx:3-9`)

### Dashboard & Analytics
10. Username shows email prefix like "john.doe+test" (`Dashboard.tsx:213`)
11. Streak progress bar caps at 10 days (`DashboardMobile.tsx:265`)
12. Mobile weekly chart has ambiguous "T" and "S" day labels (`DashboardMobile.tsx:413`)
13. Muscle distribution pie labels overlap on small screens (`Analytics.tsx:667`)
14. `SummaryReport` consistency score uses hardcoded 5-day target (`SummaryReport.tsx:26`)
15. SummaryReport `dailyWorkouts` shows binary trained/not-trained as if it shows volume (`SummaryReport.tsx:132-134`)
16. First-ever PRs never shown in SummaryReport (`SummaryReport.tsx:98-121`)
17. ConsistencyCalendar tooltip clips in scrolled overflow container (`ConsistencyCalendar.tsx:242-265`)
18. Calendar heat-map 5000kg normalization constant hardcoded (`WorkoutHistory.tsx:136`)
19. VelocityProfile zone abbreviations unreadable without legend on mobile (`VelocityProfile.tsx:163-165`)
20. RomTrend Y-axis collapses when all reps have same ROM (`RomTrend.tsx:80-82`)
21. ExerciseProgress makes direct Supabase call outside shared query pattern (`ExerciseProgress.tsx:51-65`)

### Workout & Sessions
22. Calendar can navigate into future indefinitely (`WorkoutHistory.tsx:344-348`)
23. No "load more" indicator for truncated history (`WorkoutHistory.tsx`)
24. First exercise auto-expands and cannot be fully collapsed (`SessionDetail.tsx:168-171`)
25. Session Replay canvas width doesn't respond to resize (`SessionReplay.tsx:123`)
26. ReplayCanvas has no aria-label or role for accessibility (`ReplayCanvas.tsx:53`)
27. No keyboard shortcut for play/pause in replay (`PlaybackControls.tsx`)
28. QualityBadge factors show percentages without explaining if higher is better (`QualityBadge.tsx:51, 83`)
29. PersonalRecords timeline milestones sorted by count, not chronologically (`PersonalRecords.tsx:31-36`)
30. PR progression bar chart shows newest-first (right-to-left reading) (`PersonalRecords.tsx:535`)
31. ComparisonView has no "swap sessions" button (`ComparisonView.tsx`)

### Routines & Cycles
32. No success feedback after routine save + navigation back to list (`RoutinesEnhanced.tsx`)
33. Favorites heart icon has no tooltip or aria-label (`RoutinesEnhanced.tsx:168`)
34. RoutineBuilder "Cancel" label confusing for edit flow (`RoutineBuilder.tsx:174`)
35. RoutineBuilder name input clips long names at `w-64` (`RoutineBuilder.tsx:192`)
36. Exercise ID collision risk with `Date.now().toString()` (`RoutineBuilder.tsx:296`)
37. Weight hardcoded in kg — no unit preference system (`RoutineBuilder.tsx:363`)
38. SelectionModeBar invisible with 0-1 selections — no feedback user is in selection mode (`SelectionModeBar.tsx:19`)
39. CycleBuilder duplicate name inputs in top bar and details card (`CycleBuilder.tsx:307-315, 369`)
40. CycleBuilder start date allows past dates (`CycleBuilder.tsx:439-449`)
41. Cycle "Custom" duration button jumps to 14 days arbitrarily (`CycleOverview.tsx:88-91`)

### Community & Social
42. Mobile swipe-to-leave challenge has no confirmation (`ChallengesMobile.tsx:313-314`)
43. Mobile "View" swipe action does nothing — expanded state never rendered (`ChallengesMobile.tsx:313`)
44. Community infinite scroll sentinel has no visible loading affordance (`Community.tsx`)
45. Desktop Community error state has no retry button (`Community.tsx:219-224`)
46. CommentThread character counter has no visual indicator near limit (`CommentThread.tsx`)
47. Comment avatars are initial-only circles — no actual avatar images (`CommentThread.tsx:83-84`)
48. FeaturedCreators horizontal scroll has no arrow/fade affordance (`FeaturedCreators.tsx`)
49. ShareContentDialog setTimeout can fire on unmounted component (`ShareContentDialog.tsx:133-136`)

### Integrations & Profile
50. SyncStatus polls every 15s unconditionally even when nothing pending (`SyncStatus.tsx:36`)
51. MobileOnlyProvider references mobile app settings that may not exist yet (`MobileOnlyProvider.tsx:71-83`)
52. Weight Unit preference stored but never applied app-wide (`Profile.tsx`)
53. "Profile visibility" and "Leaderboard participation" toggles have no effect — no public profile, no leaderboard (`Profile.tsx`)
54. PWA install prompt not iOS Safari-compatible (`PWAInstallPrompt.tsx`)
55. UpgradePrompt lists "Priority support" but no support infrastructure exists (`UpgradePrompt.tsx`)

</details>

---

## DEAD CODE INVENTORY

| File | Lines | Why Dead |
|------|-------|----------|
| `src/app/components/Routines.tsx` | ~430 | Replaced by `RoutinesEnhanced.tsx`, not in router |
| `src/app/components/RoutineBuilderEnhanced.tsx` | ~360 | Not in router, exercise picker never renders |
| `src/app/components/CycleBuilderMain.tsx` | ~400+ | Not in router, uses `alert()`, `window.confirm()` |
| `src/app/components/routine-builder/SupersetComponents.tsx` | ~270 | Orphaned, references nonexistent fields |
| `src/app/components/integrations/StravaConnect.tsx` | ~100 | Never imported, replaced by ProviderCard |
| `src/app/components/PortalBanner.tsx` | ~50 | Exported but never imported/used |

**Estimated dead code: ~1,600 lines**

---

## RECOMMENDED PRIORITY ORDER

### Phase 1: Critical Flow Fixes (Highest Impact)
1. Wire celebration system to actual events (PR detection, streak milestones, challenge completion)
2. Add Session Replay link to SessionDetail page
3. Fix CycleBuilder edit-creates-duplicate (add `useUpdateCycle` mutation)
4. Add post-save navigation to RoutineBuilder and CycleBuilder
5. Fix RoutinePickerModal search (wire value/onChange/state)
6. Wire streak hook to UI store
7. Fix "Save Notes" button in SessionDetail
8. Fix landing page dead buttons (View Features hero CTA, footer links)

### Phase 2: Stub Completion
9. Add notification system or remove notification UI
10. Implement "Activate" cycle action
11. Implement routine View, Duplicate, and Delete actions
12. Fix Share dialog to pass correct item context
13. Wire avatar from auth profile instead of hardcoded "JD"
14. Add "Share to Community" from Community hub
15. Fix privacy policy to reflect actual data practices

### Phase 3: UX Polish
16. Add upgrade teasers for free users instead of silent `null` returns
17. Add mobile layouts for Biomechanics and Recovery
18. Fix time period filter to apply to all Analytics queries
19. Add back navigation support (redirect to intended URL after login)
20. Remove dead code files (~1,600 lines)

### Phase 4: Data Infrastructure
21. Build mobile app → Supabase sync bridge (the mobile app has no cloud sync yet)
22. Replace remaining mock/hardcoded data with real Supabase queries
23. Add proper empty states with guidance for all data-dependent views
