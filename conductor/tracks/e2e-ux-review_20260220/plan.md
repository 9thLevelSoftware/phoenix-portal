# Execution Plan — E2E UX/UI Review Fixes

**Track:** e2e-ux-review_20260220
**Total Findings:** 170 (52 Critical, 58 Major, 55 Minor, 5 Dead Code Files)
**Approach:** 4-phase sweep, parallel execution within each phase

---

## Phase 1: Critical Flow Fixes (Highest Impact)

### Wave 1A — Systemic Wiring (parallel)
- [ ] **T1** Wire streak hook to UI store (S3) — `useStreak` → `useUIStore.setStreak()`
- [ ] **T2** Wire celebration system to events (S1) — connect 5 celebration components to PR detection, streak milestones, challenge completion
- [ ] **T3** Fix landing page dead buttons (C6, C7, C8) — "View Features" CTA scroll, footer links, pricing tier persistence
- [ ] **T4** Fix `user?.id` passed as undefined (S9) — add guards in RoutinesEnhanced, TrainingCycles, WorkoutHistory, ComparisonSessionPicker

### Wave 1B — Dead Buttons & Handlers (parallel)
- [ ] **T5** Fix SessionDetail: wire "Save Notes" onClick (C25), load existing notes (C27), add Session Replay link (C28, S2)
- [ ] **T6** Fix Dashboard: make Recent Activity rows clickable (C13), remove permanent "Badges Earned" `--` (C14, C15)
- [ ] **T7** Fix RoutinesEnhanced: wire View button (C33), Duplicate action (C34), fix share dialog context (C36), persist favorites (C35)
- [ ] **T8** Fix TrainingCycles: wire Activate button (C39), fix share dialog context (C46)
- [ ] **T9** Fix CycleBuilder: edit-creates-duplicate → add useUpdateCycle (C40), post-save nav (C41), duration label (C42)
- [ ] **T10** Fix RoutineBuilder: post-save navigation (C37), per-set differentiation (C38)
- [ ] **T11** Fix RoutinePickerModal: wire search (C44), "Create New Routine" button (C45)

### Wave 1C — Remaining Critical (parallel)
- [ ] **T12** Fix PersonalRecords "Browse Routines" button (C32)
- [ ] **T13** Fix Analytics: muscle card onClick (C19), External tab link to Integrations (C20)
- [ ] **T14** Fix Navigation: notification bell onClick (C2), avatar from auth (C3), 4 unreachable routes (C1)
- [ ] **T15** Fix ResetPassword: token validation, "Back to Sign In" link (C9, C10)
- [ ] **T16** Fix PrivacyPolicy: back navigation, GitHub link (C11, C12)
- [ ] **T17** Fix Session Replay: view mode toggle (C29), currentSetIndex reset (C30), OOB guard (C31)
- [ ] **T18** Fix Mobile Dashboard: notification bell (C16), Recent Activity tappable (C18)
- [ ] **T19** Fix OnboardingOverlay: X-button behavior (C5)
- [ ] **T20** Fix OfflineBanner z-index overlap (C4)
- [ ] **T21** Fix Biomechanics rep selector (C23)
- [ ] **T22** Fix Calendar view date-range filter (C24)
- [ ] **T23** Fix Mobile Analytics: Body tab stub (C21), Trends tab duplication (C22)
- [ ] **T24** Fix Fitbit connect undefined client_id (C50), Garmin caveat (C51)
- [ ] **T25** Fix Profile Badges tab stub (C52)
- [ ] **T26** Fix Challenges "View Leaderboard" (C47)
- [ ] **T27** Fix Community: no share button (C48), "linked to original" (C49)

## Phase 2: Major Stub Completion

### Wave 2A — Feature Completion (parallel)
- [ ] **T28** Implement notification system or remove notification UI (S4, M1-M11 related)
- [ ] **T29** Fix routine delete action (M36), empty-routine save guard (M38), useUpdateRoutine transaction (M39)
- [ ] **T30** Fix CycleBuilder: description from existing (M42), Day 1 rest day (M44), week at a glance (C43)
- [ ] **T31** Fix Goals: ELITE unlimited cap (M24), type change (M25), exercise name validation (M26), archived goals UI (M27)
- [ ] **T32** Fix Analytics: change fields (M12), time period filter scope (M13), CSV export scope (M14)
- [ ] **T33** Fix mobile: exercise name truncation (M15), MuscleHeatmap back view (M16)
- [ ] **T34** Fix signOut to clear caches (M5), redirect to intended URL (M3)

### Wave 2B — Integration & Community (parallel)
- [ ] **T35** Fix OAuth callback useEffect dependency (M52, S10), disconnect confirmation (M53)
- [ ] **T36** Fix Community: filter reset on mount (M46), follow/unfollow (M47), filter discard (M50)
- [ ] **T37** Fix Profile: header tier label (M55), avatar upload placeholder (M57)
- [ ] **T38** Fix Recovery: chronic average hardcode (M20), negative days (M22), mobile layout (M21)
- [ ] **T39** Fix Biomechanics: mobile layout (M18), section icons (M19), ForceCurve entry (M23)
- [ ] **T40** Fix CycleBuilder: cycle progress (M40), last_used_at (M41), progression key format (M43)
- [ ] **T41** Fix WhatsNewBanner feature links (M9), OnboardingOverlay Step 3 (M7), back button (M8)
- [ ] **T42** Fix ErrorFallback sanitized messages (M10), mobile safe-area classes (M11)
- [ ] **T43** Fix WorkoutHistory 50-session limit (M29), compare mode upgrade prompt (M28)
- [ ] **T44** Fix SessionDetail print CSS (M30), PR timeline (M32), PR bar chart (M33)
- [ ] **T45** Fix CelebrationDemo dev route (M1), showHints (M2), PortalBanner dead component (M6)
- [ ] **T46** Fix ShareContentDialog raw input (M49), CommentThread edit window (M48)
- [ ] **T47** Fix Training mode description (M37), PersonalRecords muscle filters (M34)
- [ ] **T48** Fix Pricing missing Stripe IDs (M58), HevyConnect separation (M54)
- [ ] **T49** Fix session replay: deriveRepBoundaries (M35)

## Phase 3: UX Polish (55 Minor Findings)

- [ ] **T50** Fix navigation minor issues: 404 feedback, logout loading, TierBadge shift, mobile back (minor 1-4)
- [ ] **T51** Fix onboarding/shell: progress dots, hardcoded colors, touch targets, ErrorFallback button, PageLoading (minor 5-9)
- [ ] **T52** Fix dashboard/analytics minor: email prefix, streak cap, day labels, pie overlap, SummaryReport (minor 10-16)
- [ ] **T53** Fix charts/calendar minor: tooltip clip, heatmap constant, velocity labels, ROM collapse, ExerciseProgress (minor 17-21)
- [ ] **T54** Fix workout/session minor: future calendar, load more, auto-expand, replay resize, a11y, keyboard (minor 22-27)
- [ ] **T55** Fix records/comparison minor: QualityBadge, timeline sort, bar direction, swap button (minor 28-31)
- [ ] **T56** Fix routines/cycles minor: success feedback, favorites tooltip, cancel label, name clip, ID collision, weight units (minor 32-37)
- [ ] **T57** Fix routines/cycles minor: SelectionModeBar, duplicate names, past dates, Custom duration (minor 38-41)
- [ ] **T58** Fix community minor: swipe confirm, swipe view, infinite scroll, error retry, char counter, avatars, creators, setTimeout (minor 42-49)
- [ ] **T59** Fix integration/profile minor: SyncStatus polling, MobileOnlyProvider, weight unit, profile toggles, PWA, UpgradePrompt (minor 50-55)

## Phase 4: Cleanup & Infrastructure

- [ ] **T60** Remove dead code files: Routines.tsx, RoutineBuilderEnhanced.tsx, CycleBuilderMain.tsx, SupersetComponents.tsx, StravaConnect.tsx, PortalBanner.tsx (~1,600 lines)
- [ ] **T61** Fix `duration_seconds` naming inconsistency (S6)
- [ ] **T62** Fix Privacy Policy to reflect actual data practices (S7)
- [ ] **T63** Add premium feature upgrade teasers instead of silent null (S8)
- [ ] **T64** Fix `useSearchParams.get` effect dependencies (S10)

---

## Execution Strategy

- Phases execute sequentially (1 → 2 → 3 → 4)
- Within each wave, tasks execute in parallel via agent swarm
- Each task produces atomic commits with conventional commit messages
- Build verification after each wave
