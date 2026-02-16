# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-15)

**Core value:** Premium subscribers see data and insights about their training that they cannot get anywhere else -- force curves, velocity trends, muscle balance analysis, and community-driven workout programming -- making the subscription feel indispensable.
**Current focus:** Phase 6 - Session Replay + Advanced VBT

## Current Position

Phase: 6 of 7 (Session Replay + Advanced VBT)
Plan: 4 of 4 in current phase
Status: Phase Complete
Last activity: 2026-02-16 -- 06-04 complete (Playback Controls + Session Replay Integration)

Progress: [████████░░] 79% (31/39 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 31
- Average duration: 3 min
- Total execution time: 1.17 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 00-stabilization | 3/3 | 13 min | 4 min |
| 01-auth-data-layer | 7/7 | 22 min | 3 min |
| 02-navigation-state | 3/3 | 8 min | 3 min |
| 03-subscriptions-payments | 4/4 | 8 min | 2 min |
| 04-premium-analytics | 6/6 | 18 min | 3 min |

**Recent Trend:**
- Last 5 plans: 05-05 (3 min), 06-01 (2 min), 06-02 (2 min), 06-03 (2 min), 06-04 (3 min)
- Trend: stable velocity

*Updated after each plan completion*
| Phase 04 P01 | 3 min | 2 tasks | 10 files |
| Phase 04 P02 | 3 min | 2 tasks | 3 files |
| Phase 04 P03 | 2 min | 2 tasks | 2 files |
| Phase 04 P04 | 3 min | 2 tasks | 2 files |
| Phase 04 P06 | 3 min | 2 tasks | 2 files |
| Phase 04 P05 | 4 min | 2 tasks | 5 files |
| Phase 05 P01 | 2 min | 2 tasks | 7 files |
| Phase 05 P03 | 3 min | 2 tasks | 4 files |
| Phase 05 P04 | 4 min | 2 tasks | 8 files |
| Phase 05 P05 | 3 min | 2 tasks | 4 files |
| Phase 06 P01 | 2 min | 2 tasks | 3 files |
| Phase 06 P02 | 2 min | 2 tasks | 2 files |
| Phase 06 P03 | 2 min | 2 tasks | 4 files |
| Phase 06 P04 | 3 min | 4 tasks | 7 files |

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
- [Phase 03-03]: Annual billing shows per-month equivalent with annual total below
- [Phase 03-03]: TierBadge in desktop nav only; mobile gets it via Profile page
- [Phase 03-03]: Loading state on clicked CTA only, other buttons disabled during checkout redirect
- [04-01]: Used downsample library's createLTTB for typed LTTB (proven algorithm, typed accessors)
- [04-01]: Independent WEIGHT_MULTIPLIER in telemetry schemas for module independence
- [04-01]: Two-step query pattern for biomechanics consistent with analytics.ts approach
- [04-01]: Client-side aggregation for weekly summary consistent with volume bucketing pattern
- [04-02]: Inline styles for visx tooltip (absolute positioning breaks Tailwind)
- [04-02]: bisector nearest-point search across all reps for unified tooltip
- [04-02]: shapeRendering=optimizeSpeed on path elements for large dataset performance
- [04-03]: Zone label abbreviations (initials) above bars instead of full text to avoid overlap
- [04-03]: Client-side calculatePower fallback when power_watts is null/zero from server
- [04-03]: Peak velocity shown as lighter opacity bar behind mean velocity bar for visual hierarchy
- [04-04]: Diverging horizontal bar chart for per-rep asymmetry (better than circular gauge for multi-rep comparison)
- [04-04]: RomTrend uses shared ChartTheme constants for consistent styling across all premium charts
- [04-06]: Used Recharts AreaChart (not visx) for trend charts -- consistent with Analytics.tsx patterns
- [04-06]: Client-side time range filtering avoids multiple queries per range
- [04-06]: SVG circle stroke-dasharray for consistency ring (no extra dependency)
- [04-06]: Period comparison splits data at midpoint for vs-last-period stats
- [04-05]: Custom SVG body outline for MuscleHeatmap (no third-party library, keeps bundle small)
- [04-05]: Telemetry fetched on-demand per selected set (avoids loading all session data upfront)
- [04-05]: Session/exercise/set cascade selectors auto-select first available item
- [05-01]: Added display_name and avatar_url to profiles table stub for community author display
- [05-01]: Profiles field optional in Zod schemas (present when joined, absent in raw queries)
- [05-01]: 300ms default debounce for search input, 2500ms for realtime vote invalidation
- [05-01]: Muted parameter on realtime hook to skip invalidation during optimistic votes
- [05-03]: voteMutedRef as module-level ref for cross-hook coordination between mutations and realtime
- [05-03]: 3-second mute window prevents realtime invalidation from overwriting optimistic vote updates
- [05-03]: onSettled intentionally omitted from useVote -- realtime handles eventual consistency
- [05-03]: useSaveItem creates linked FK reference (not data copy) per user decision
- [05-03]: ShareContentDialog uses Tabs for content type toggle and Badge click for tag selection
- [05-02]: IntersectionObserver on sentinel div for infinite scroll (no third-party library)
- [05-02]: Detail view uses Drawer (vaul) on mobile, Dialog (Radix) on desktop via useIsMobile
- [05-02]: Feed state resets on mount via store.resetAll() in useEffect with empty deps
- [05-02]: Vote handler placeholder pending 05-03 optimistic vote mutations
- [05-04]: userId filter added to existing communityFeedOptions (avoids separate query function)
- [05-04]: CreatorProfile fetches both routines and cycles tabs for complete creator content
- [05-04]: Save toggle state derived from savedItemsOptions query via useMemo (not local state)
- [05-05]: ShareContentDialog supports controlled (open/onOpenChange) and uncontrolled modes via optional props
- [05-05]: DialogTrigger conditionally rendered only in uncontrolled mode to avoid orphan buttons
- [06-01]: Set viewMode defaults to 'set' per user decision in roadmap
- [06-01]: nextSet does NOT clamp to max (parent handles boundary)
- [06-01]: Canvas high-DPI handling via devicePixelRatio scaling pattern
- [06-02]: Motion's useAnimationFrame delta is in seconds - multiply by 1000 * speed for ms advancement
- [06-02]: Velocity rendering uses continuous line (like force curve) instead of bars for 50Hz telemetry data
- [06-02]: Auto-pause at maxTimeMs prevents playback overrun
- [06-03]: Velocity consistency derived from peak/mean ratio (ideal 1.2-1.5)
- [06-03]: Asymmetry penalty: 5 points per percentage of imbalance
- [06-03]: Fatigue severity thresholds: moderate (20-30%), high (>30%)
- [06-04]: Tabs component used for speed and view mode toggles (consistent with app patterns)
- [06-04]: 48px play button for mobile touch targets
- [06-04]: Fatigue region overlay uses severity-based colors (red for high, amber for moderate)
- [06-04]: Rep boundaries derived from cumulative TUT with 500ms inter-rep gap estimate
- [06-04]: Paused stats overlay shows rep number, timestamp, and quality score

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Supabase schema not yet finalized on mobile side -- data model mapping may need revision
- [Phase 4]: VBT zone thresholds implemented using Dr. Bryan Mann's research (resolved in 04-01)
- [Phase 7]: Hevy API access uncertain (may need CSV import fallback)

## Session Continuity

Last session: 2026-02-16
Stopped at: Completed 06-04-PLAN.md (Playback Controls + Session Replay Integration) - Phase 06 Complete
Resume file: None
