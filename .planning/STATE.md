# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-15)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 3 - Subscriptions & Payments

## Current Position

Phase: 3 of 7 (Subscriptions & Payments)
Plan: 4 of 4 in current phase
Status: In Progress
Last activity: 2026-02-15 -- 03-04 complete (Subscription UI integration)

Progress: [████░░░░░░] 41% (16/39 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 15
- Average duration: 3 min
- Total execution time: 0.75 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 00-stabilization | 3/3 | 13 min | 4 min |
| 01-auth-data-layer | 7/7 | 22 min | 3 min |
| 02-navigation-state | 3/3 | 8 min | 3 min |
| 03-subscriptions-payments | 3/4 | 6 min | 2 min |

**Recent Trend:**
- Last 5 plans: 02-02 (2 min), 02-03 (4 min), 03-01 (2 min), 03-02 (2 min), 03-04 (2 min)
- Trend: stable velocity

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phase 0 stabilization before any features (62+ bugs, 6 critical)
- [Roadmap]: Phases 4/5/7 can parallelize after Phase 3 completes
- [Roadmap]: EXP-01 through EXP-03 grouped with Phase 7 (integrations) not Phase 1 (data)
- [Roadmap]: Phase 6 (Session Replay) depends on Phase 4 (biomechanics visx foundation)
- [00-01]: Hardcoded theme="dark" in sonner.tsx instead of next-themes (app is dark-only)
- [00-01]: MobileBottomNav in App.tsx is canonical mobile nav; removed duplicate from Navigation.tsx
- [00-01]: useIsMobile hook is standard mobile detection pattern (replaces inline useState+resize)
- [00-03]: Used sharp for image conversion (dev dependency stays for future re-generation)
- [00-03]: WebP quality 85 balances file size and visual quality
- [00-03]: XL logo loads eagerly (landing hero), others lazy-load
- [00-03]: Original 1.8MB PNG kept as source, just removed imports
- [00-02]: Class-based IntersectionObserver mock required for framer-motion compatibility in tests
- [00-02]: Navigation/MobileBottomNav/Toaster kept as static imports (always visible layout shell)
- [00-02]: Each early-return path in App.tsx gets its own ErrorBoundary+Suspense wrapper
- [01-01]: Used plain @supabase/supabase-js (not @supabase/ssr) since this is a client-side SPA
- [01-01]: Stub types follow Supabase generated types structure (Row/Insert/Update per table)
- [01-01]: WEIGHT_MULTIPLIER pattern will be in Zod transforms (plan 01-03), not in types
- [01-01]: Environment validation happens at client creation time with clear error message
- [01-02]: Auth modal overlay on landing page instead of separate login route
- [01-02]: LandingPage calls supabase.auth directly (not via useAuth) -- state change triggers AuthProvider re-render
- [01-02]: AuthProvider wraps QueryProvider in main.tsx so queries can access auth context
- [01-02]: Zod validation for form inputs with react-hook-form integration
- [01-03]: staleTime 5min with retry 1 balances freshness and API load for development
- [01-03]: WEIGHT_MULTIPLIER=2 centralizes per-cable to total weight conversion in transforms.ts
- [01-03]: Zod inferred types will replace inline component interfaces for consistency
- [01-05]: Two-step query for muscle group analytics (session IDs then exercises by session_id)
- [01-05]: Volume data bucketed by ISO week for chart display
- [01-05]: Strength progress chart shows top 3 exercises by latest value
- [01-05]: Insights derived from real data counts (TODO for richer analysis)
- [01-05]: Routine favorites toggle uses local state overlay pending mutation API
- [01-04]: Dashboard derives weekly volume chart data client-side from raw query results
- [01-04]: Challenges/badges remain as TODO mock data for future phases (3 and 5)
- [01-04]: WorkoutHistory computes streak from actual workout dates instead of hardcoding
- [01-04]: DashboardMobile pull-to-refresh invalidates query cache
- [01-04]: Test utility with vi.hoisted pattern for auth mocking across all component tests
- [01-06]: Broadcast channel (not postgres_changes) for realtime sync -- matches mobile app architecture
- [01-06]: Invalidate all 5 query domains on sync_complete -- sync could affect any data
- [01-06]: Removed Performance Metrics from SessionDetail -- requires real sensor data (Phase 4)
- [01-07]: Logout button in Profile settings (Account card) -- accessible from both desktop and mobile
- [01-07]: Navigation bar gets icon-only logout button next to avatar
- [01-07]: No MobileBottomNav changes -- mobile users reach logout via Profile page
- [02-01]: BrowserRouter wraps AuthProvider (outermost) so useNavigate works everywhere
- [02-01]: Navigation/MobileBottomNav get hardcoded props until plan 02-02 migrates them
- [02-01]: Route wrapper components bridge old prop-based nav to URL params temporarily
- [02-01]: useRealtimeSync moved from App.tsx to AppLayout for authenticated-only execution
- [02-02]: NavLink render-prop children pattern for layoutId animation inside NavLink
- [02-02]: Mobile nav split: 4 primary (Home, History, Analytics, Profile) + 5 in More drawer
- [02-02]: More button highlights when any drawer page is active via useLocation check
- [02-03]: SessionDetail uses enabled flag on useQuery to avoid conditional hook call
- [02-03]: CycleBuilder migrated alongside plan components (needed for route cleanup)
- [02-03]: PrivacyPolicy uses navigate(-1) for browser-native back behavior
- [02-03]: LandingPage uses Link component for privacy nav (declarative over imperative)
- [02-03]: RoutineBuilder/CycleBuilder save handlers use console.log placeholder + navigate
- [03-01]: Profiles table created with IF NOT EXISTS for idempotent migration
- [03-01]: getTierFromPriceId reads env vars for price-to-tier mapping (not hardcoded)
- [03-01]: invoice.paid handler retrieves full subscription to update period dates accurately
- [03-01]: Webhook function validates Stripe-Signature header presence before body read
- [03-02]: useSubscription uses postgres_changes Realtime (not broadcast) for instant tier updates
- [03-02]: TIER_LEVEL map pattern (FREE=0, PHOENIX=1, ELITE=2) for numeric tier comparison
- [03-02]: SubscriptionGate default fallback is styled placeholder (full UpgradePrompt in 03-04)
- [03-02]: TierBadge returns null while loading for seamless appearance
- [03-04]: UpgradePrompt uses Link to /pricing (declarative navigation consistent with codebase)
- [03-04]: Checkout return useEffect runs on mount only to avoid re-triggering on tier changes
- [03-04]: Portal loading state uses local useState (component-scoped, not global)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Supabase schema not yet finalized on mobile side -- data model mapping may need revision
- [Phase 4]: VBT zone thresholds need sports science research during planning
- [Phase 7]: Hevy API access uncertain (may need CSV import fallback)

## Session Continuity

Last session: 2026-02-15
Stopped at: Completed 03-04-PLAN.md (Subscription UI integration)
Resume file: None
