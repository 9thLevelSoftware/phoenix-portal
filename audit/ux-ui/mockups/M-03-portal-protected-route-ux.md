# M-03 — Portal Protected Route + 404 + FREE-Tier Onboarding UX

**Covers findings:** G-010 (CRITICAL), G-112 (HIGH), `02-F-014` (MEDIUM), `02-F-015` (MEDIUM)
**Surface:** Portal only
**Files affected:**
- `phoenix-portal/src/app/routes/index.tsx` (catch-all rewrite, route nesting refactor)
- `phoenix-portal/src/app/routes/ProtectedRoute.tsx` (render `AuthRequired` instead of `<Navigate>`; add `?next=` post-auth handler)
- `phoenix-portal/src/app/routes/SubscribedRoute.tsx` (render `TierLocked` instead of bare `SubscriptionGate`)
- `phoenix-portal/src/app/components/SubscriptionGate.tsx` (in-page mode option for non-blocking gates)
- `phoenix-portal/src/app/components/UpgradePrompt.tsx` (split into "preview" content + upsell module)
- `phoenix-portal/src/app/components/AppSidebar.tsx` (lock-icon overlays + tooltip)
- `phoenix-portal/src/app/components/Dashboard.tsx` (FREE-tier path)
- `phoenix-portal/src/app/components/NotFound.tsx` (becomes the *authenticated* 404; survives existing usage)
- **NEW:** `phoenix-portal/src/app/components/AnonymousNotFound.tsx`
- **NEW:** `phoenix-portal/src/app/components/AuthRequired.tsx`
- **NEW:** `phoenix-portal/src/app/components/TierLocked.tsx`
- **NEW:** `phoenix-portal/src/app/components/FreeTierDashboard.tsx`
- **NEW:** `phoenix-portal/src/lib/route-meta.ts` (single source of truth for known protected paths + their tier requirements + their preview copy)
- **NEW:** `phoenix-portal/src/lib/safeRedirect.ts` (`?next=` sanitizer)

**Effort:** ~1 dev day for routing + AuthRequired + AnonymousNotFound (G-010 fix); ~1 dev day for FREE-tier dashboard (G-112) + TierLocked refactor; ~½ day for sidebar lock affordances + tooltip (G-112). **Total: 2.5 dev days for mockup-grade implementation; tests + visual QA add ~½ day.**

---

## Problem statement

The portal currently treats four distinct user states as the same state — silently. A user mistypes a URL, follows a stale share-link, has an expired JWT, signs in as a FREE-tier user, or hits a tier-gated route — and in *every* case the result is the same: they end up on the marketing landing page, with the URL silently rewritten, with no signal explaining why. Five emotionally and functionally different situations are rendered as one. Users self-blame ("did I click the wrong link?"), blame the sender ("did they share a broken URL?"), or blame the product ("is the portal broken?"). None of those reactions converge on the actual problem, so the recovery path is non-obvious in every case.

The implementation cause is a single defensive escape hatch — `<Route path="*" element={<Navigate to="/" replace />} />` at `routes/index.tsx:218`, sitting *outside* the `ProtectedRoute` tree to avoid a redirect loop. Combined with `ProtectedRoute` returning `<Navigate to="/" replace />` (line 13) when unauthenticated, every problematic URL falls through to that public catch-all. The `NotFound` component on `routes/index.tsx:213` is mounted *inside* `ProtectedRoute > AppLayout`, which means only signed-in users — the population least likely to hit a 404 — can ever see it. The 13 byte-identical landing-page screenshots in `_audit/screenshots/portal/` are the empirical proof: every protected route renders `landing-desktop.png` for signed-out visitors.

Compounding the routing failure, the portal's first-paint experience for a successful FREE-tier signup is also a wall: `/dashboard` is wrapped in `<SubscribedRoute requiredTier="EMBER">`, so a brand-new user lands on a `UpgradePrompt` paywall page with no signal about what the FREE tier actually delivers. The `OnboardingOverlay` slides them through three "what you get" panels (Analytics, Community, Replay) — every one of which they cannot access. The result is bait-and-switch onboarding: the modal promises the product; the next click delivers a paywall. Mobile-bottom-nav reordering is a related but separate IA concern — Routines and Cycles are buried under "More" while Community is primary, despite Routines and Cycles being core training surfaces — and is briefly noted in §6 below for follow-up rather than designed here.

---

## Current-state evidence

**Routing failure (G-010):**
- `phoenix-portal/src/app/routes/index.tsx:217-218` — `<Route path="*" element={<Navigate to="/" replace />} />` is the public catch-all
- `phoenix-portal/src/app/routes/ProtectedRoute.tsx:12-14` — when `!user`, returns `<Navigate to="/" replace />`; the destination URL is lost in this redirect (no `state={{ from: location }}` capture)
- `_audit/screenshots/portal/_routes.json` — 13 routes verified `redirected: true` with `h1: "Your workouts, unlocked."`
- 13 PNGs in `_audit/screenshots/portal/` — `dashboard-desktop.png`, `analytics-desktop.png`, `biomechanics-desktop.png`, `routines-desktop.png`, `routine-editor-desktop.png`, `cycles-desktop.png`, `cycle-builder-desktop.png`, `calendar-desktop.png`, `goals-desktop.png`, `leaderboard-desktop.png`, `integrations-desktop.png`, `settings-desktop.png`, `history-desktop.png`, `pricing-desktop.png`, `route-404-desktop.png` — each is **1,105,574 bytes** (the file size of `landing-desktop.png`), confirming pixel-byte-identical landing renders. The router's `<Navigate to="/" replace />` is doing the work.
- The `NotFound` component (`phoenix-portal/src/app/components/NotFound.tsx`, 22 lines) exists and is well-styled but is mounted on `routes/index.tsx:213` *inside* `ProtectedRoute > AppLayout` — never reachable for anonymous users.

**FREE-tier first-paint dead-end (G-112):**
- `phoenix-portal/src/app/routes/index.tsx:175-181` — `/dashboard`, `/history`, `/history/:sessionId`, `/goals`, `/recovery` are all gated behind `<SubscribedRoute requiredTier="EMBER">`
- `phoenix-portal/src/app/routes/SubscribedRoute.tsx:21-24` — wraps children in a `SubscriptionGate` whose fallback is a full-bleed `UpgradePrompt`
- `phoenix-portal/src/app/components/AuthCallback.tsx:82` — every signed-in user is sent to `/dashboard` post-auth
- `phoenix-portal/src/app/components/AppSidebar.tsx:63-90` — 8 of 11 sidebar destinations (Dashboard, Workouts, Analytics, Routines, Cycles, Community, Challenges, Leaderboard) are paywalled; only Profile, Integrations (silently FLAME-gated), Subscription are reachable for FREE
- `phoenix-portal/src/app/components/OnboardingOverlay.tsx:25-76` — three slides describe Analytics, Community, Session Replay (per `02-F-014`); none of these are accessible to the user the overlay just shipped through

**Mobile bottom-nav misorder (`02-F-015`):**
- `phoenix-portal/src/app/components/MobileBottomNav.tsx:29-34` — primary: Dashboard, Workouts, Analytics, Community
- `phoenix-portal/src/app/components/MobileBottomNav.tsx:36-58` — under "More" drawer: Routines, Cycles, Challenges, Leaderboard, Profile, Integrations, Subscription. 7 of 11 destinations buried; Routines + Cycles in particular are core training surfaces (per the parent CLAUDE.md, the cycle-builder workflow is *portal-primary*).

---

## Proposed design

### Surface 1: AnonymousNotFound (path doesn't exist)

**Trigger:** Any unmatched path that does *not* match a known protected route name (registered in `lib/route-meta.ts`). Render at the requested path — **do not redirect**. URL is preserved.

```
                       [ DESKTOP — 1280×800, centered card ]

╭───────────────────────────────────────────────────────────────────────────╮
│  [Phoenix logo]  Phoenix Portal                              [ Sign In ]  │ ← simplified header
├───────────────────────────────────────────────────────────────────────────┤   (no Features/Pricing/
│                                                                           │   Support anchors —
│                  ╭────────────────────────────────╮                       │   they don't exist on
│                  │                                │                       │   this synthetic route)
│                  │   [orange flame, 48×48, .5α]   │                       │
│                  │                                │                       │
│                  │      404                       │ ← display-1, #FF6B35  │
│                  │                                │                       │
│                  │   That page doesn't exist      │ ← lg/medium, #fff     │
│                  │                                │                       │
│                  │   We couldn't find anything    │ ← sm, #A0A0AC         │
│                  │   at                           │                       │
│                  │                                │                       │
│                  │   /this-typo-here              │ ← mono, amber tint    │
│                  │                                │   truncate 32ch       │
│                  │   ┌─────────────────────┐      │                       │
│                  │   │   ← Back to home    │      │ ← variant="cta"       │
│                  │   └─────────────────────┘      │                       │
│                  │                                │                       │
│                  │   Already have an account?     │ ← muted                │
│                  │   Sign in                      │ ← text-link orange    │
│                  ╰────────────────────────────────╯                       │
│                                                                           │
│                  (lower 50% of viewport intentionally empty)              │
├───────────────────────────────────────────────────────────────────────────┤
│  © 2026 Phoenix Portal · Privacy · Terms · FAQ                            │ ← minimal footer
╰───────────────────────────────────────────────────────────────────────────╯
```

**Mobile delta (375×812):** card stretches to viewport width with 16px gutters; header collapses to `[logo] Phoenix Portal` left + `Sign In` right (no anchors); 404 numeral renders at ~64px; mono path truncates at 24ch; primary button is full-width inside the card; footer compresses to single line `Privacy · Terms · FAQ`.

**Behavior contract:**
- HTTP 200 (SPA — cannot return 404 status from client without server-side rendering, but URL is preserved which is the IA-contract win).
- The requested path is shown verbatim in monospace, with opaque `dir="ltr"` and `overflow-wrap: anywhere` to defang malicious-looking unicode.
- Path is sanitized for display: stripped of query+hash before rendering, escaped via React's default text-content escaping (no `dangerouslySetInnerHTML`).
- Long paths truncate to 32 characters desktop / 24 mobile with ellipsis; a `title=` attr exposes the full path on hover for desktop users.
- "Back to home" is the primary action and uses `variant="cta"` (primary orange).
- "Sign in" is a secondary text link that opens the existing auth dialog with no `?next=` (since this is a true 404 — there's nowhere meaningful to send them after auth).
- Header carries only the brand and a Sign In button; **no anchor links** to Features/Pricing/Support, since the user is on a synthetic route and those anchors don't exist here.

### Surface 2: AuthRequired (path exists, requires auth)

**Trigger:** `ProtectedRoute` detects `!user` AND the path matches a known protected route registered in `lib/route-meta.ts`. Render `AuthRequired` *at the requested path* — **do not redirect**. URL preserved.

```
                       [ DESKTOP — 1280×800, centered card ]

╭───────────────────────────────────────────────────────────────────────────╮
│  [Phoenix logo]  Phoenix Portal                              [ Sign In ]  │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│              ╭────────────────────────────────────╮                       │
│              │   [lock, primary orange, 32×32]    │                       │
│              │                                    │                       │
│              │   Sign in to continue              │ ← display-3           │
│              │                                    │                       │
│              │   /dashboard requires you to be    │ ← body, #A0A0AC       │
│              │   signed in. We'll bring you back  │                       │
│              │   here right after.                │                       │
│              │                                    │                       │
│              │   ┌──────────────────────────────┐ │ ← variant="cta",      │
│              │   │ Sign in to Phoenix Portal    │ │   full-width on card  │
│              │   └──────────────────────────────┘ │                       │
│              │                                    │                       │
│              │   ┌──────────────────────────────┐ │ ← variant="ghost",    │
│              │   │   Sign up free               │ │   subdued border      │
│              │   └──────────────────────────────┘ │                       │
│              │                                    │                       │
│              │   Don't have an account?           │ ← caption, muted      │
│              │   Sign up takes 30 seconds         │                       │
│              ╰────────────────────────────────────╯                       │
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│  © 2026 Phoenix Portal · Privacy · Terms · FAQ                            │
╰───────────────────────────────────────────────────────────────────────────╯
```

**Mobile delta:** card stretches to viewport width with 16px gutters; lock icon 28×28; primary CTA wraps to 2 lines if needed (or shortens to "Sign in"); secondary "Sign up free" full-width below; no header anchors.

**`?next=` query-param mechanics:**

The Sign In and Sign up buttons each navigate to the auth dialog with a `?next=` parameter encoding the requested path. Two routes carry the parameter:

1. **Path-preserved approach** (chosen) — the auth dialog reads `useLocation().pathname + useLocation().search` from where it was opened. After successful auth, `ProtectedRoute` re-mounts with `user` defined, the gated route resolves, and the user lands exactly where they tried to go. **No `?next=` is needed in the URL** because the URL is *already* the destination; it never changed.

2. **Explicit `?next=` redirect approach** (alternative) — used only if the auth flow takes the user away from the route (e.g. `/auth/callback` for OAuth/magic-link). On callback, read `?next=`, sanitize, navigate.

Flow comparison:

```
Email/password (synchronous):
  /routines/abc123 (signed out)  →  AuthRequired (URL preserved)
  →  click Sign in  →  AuthDialog (modal)  →  submit
  →  ProtectedRoute re-renders w/ user  →  RoutineDetail mounts at /routines/abc123

OAuth / magic-link (asynchronous, requires explicit ?next=):
  /routines/abc123 (signed out)  →  AuthRequired
  →  click Sign in via email link  →  email contains
       /auth/callback?token=…&next=%2Froutines%2Fabc123
  →  AuthCallback exchanges token  →  sanitizeNextParam(?next=) → /routines/abc123
```

**`?next=` sanitization (CRITICAL — open-redirect class):**

```ts
// phoenix-portal/src/lib/safeRedirect.ts (new)
const KNOWN_PROTECTED_PATHS = [
  "/dashboard", "/history", "/goals", "/recovery", "/profile",
  "/pricing", "/challenges", "/analytics", "/community", "/leaderboard",
  "/routines", "/cycles", "/compare", "/integrations", "/biomechanics",
  "/replay", // each may have :id segments
];

export function sanitizeNextParam(raw: string | null | undefined): string {
  if (!raw) return "/dashboard";  // safe default
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return "/dashboard"; }

  // 1. Must be a same-origin path (no scheme, no protocol-relative)
  if (decoded.startsWith("//") || /^[a-z]+:/i.test(decoded)) return "/dashboard";

  // 2. Must start with a single slash
  if (!decoded.startsWith("/")) return "/dashboard";

  // 3. Must not contain CRLF or null bytes (header-injection class)
  if (/[\r\n\0]/.test(decoded)) return "/dashboard";

  // 4. Must match a known protected path prefix (defense in depth)
  const path = decoded.split("?")[0].split("#")[0];
  const matchesKnown = KNOWN_PROTECTED_PATHS.some(p => path === p || path.startsWith(p + "/"));
  if (!matchesKnown) return "/dashboard";

  return decoded;
}
```

This rejects:
- `https://attacker.example.com/...` — non-same-origin
- `//attacker.example.com/...` — protocol-relative
- `javascript:alert(1)` — scheme injection
- `/random-path-not-registered` — unknown path
- Strings containing CR/LF/NUL — header injection

**Auth dialog integration:**

The existing `AuthDialog` component already opens via the "Preview dashboard" landing CTA. AuthRequired's "Sign in" button reuses the same dialog. The dialog captures `useLocation()` at open-time so post-auth the user is already at the right URL. For magic-link/OAuth flows, the dialog adds a hidden `?next=` to the magic-link callback URL (encoded via `encodeURIComponent(location.pathname + location.search)`).

**Edge case — tier-gated route, unauthenticated:**

If the user hits `/community` (FLAME-tier) while signed out, the path matches a known protected route → AuthRequired renders. After successful sign-in, `ProtectedRoute` resolves, `SubscribedRoute requiredTier="FLAME"` evaluates, and if the user's tier is insufficient, **Surface 3 (TierLocked) renders next**. So the user sees: AuthRequired → sign in → TierLocked. Clear, sequential, never silently dropped.

### Surface 3: TierLocked (signed in, tier-insufficient)

**Trigger:** `SubscribedRoute` detects `user` is defined but `userTier < requiredTier`. Currently the fallback is a full-bleed `UpgradePrompt`; the proposal is to render a structured `TierLocked` component that combines (a) the page header (so context isn't lost), (b) a meaningful preview of *what the gated feature does*, and (c) the upsell card.

```
                          [ DESKTOP — content column inside AppLayout ]

╭───────────────────────────────────────────────────────╮
│  Routine Builder                          [🔒 FLAME]  │ ← page header retained;
│  ───────────────────────────────────────────────────  │   sidebar still mounted
│                                                       │   (see Surface 4b)
│  FEATURE PREVIEW                                      │ ← eyebrow
│                                                       │
│  ┌────────────────┐                                   │
│  │                │  Build custom routines.           │ ← lg, white
│  │ [static SVG —  │                                   │
│  │  superset      │  Link supersets, set AMRAP rep    │ ← body, muted
│  │  bracket,      │  caps, PR-scale weights, and      │
│  │  AMRAP pill,   │  share with the community.       │
│  │  weight curve] │                                   │
│  │   280×180      │                                   │
│  └────────────────┘                                   │
│                                                       │
│  ┌─ available on ─────────────────────────────────┐  │ ← signal-panel border
│  │  [FLAME]   $15/mo     [INFERNO]   $25/mo       │  │   no glow
│  │                                                 │  │
│  │  ┌──────────────────────┐    Compare plans →   │  │ ← variant="cta"
│  │  │ Upgrade to Flame     │                       │  │
│  │  └──────────────────────┘                       │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Don't need this feature yet?  Go to Dashboard →     │ ← subdued footer link
╰───────────────────────────────────────────────────────╯
```

**Mobile delta:** preview SVG resizes to ~280×160, fitting card width with 16px gutters; tier-comparison row stacks vertically (FLAME above INFERNO) instead of side-by-side; primary "Upgrade to Flame" CTA is full-width below the comparison; "Compare plans →" + "Go to Dashboard" stack as a single column of muted text-links at the bottom.

**Per-route content map** (`lib/route-meta.ts` — single source of truth). Each entry holds `{ path, pathPattern, label, requiredTier, preview: { title, body, illustration } }`. The full table:

| Path | Label | Tier | Preview title | Preview body |
|------|-------|------|---------------|--------------|
| `/dashboard` | Dashboard | FREE | Your training, at a glance. | Streak, recent workouts, and what's next. |
| `/history` | Workouts | EMBER | Every workout, every set. | Browse 30+ days of training. Filter by exercise, mode, and PR. Replay any session at 50Hz. |
| `/goals` | Goals | EMBER | Set targets that matter. | Weekly volume, frequency, or PR streaks. EMBER subscribers track up to 3 simultaneous goals. |
| `/recovery` | Recovery | EMBER | Train smarter, recover better. | Rest day tracker, soreness scoring, and recovery recommendations. |
| `/analytics` | Analytics | FLAME | See every rep as data. | Volume trends, force curves, asymmetry, fatigue, recommendations. Built on 50Hz cable telemetry. |
| `/community` | Community | FLAME | Train together. | Share routines, vote on technique tips, and discuss workout modes with other Vitruvian athletes. |
| `/leaderboard` | Leaderboard | FLAME | Climb the rankings. | Weekly volume, PR counts, streak length, and class-based standings. |
| `/challenges` | Challenges | FLAME | 30-day challenges, real progress. | Volume / streak / technique challenges. Earn badges, climb the boards. |
| `/routines` | Routines | FLAME | Build custom routines. | Link supersets, set AMRAP rep caps, PR-scale weights, and share with the community. |
| `/cycles` | Cycles | FLAME | Plan your training arc. | Multi-week training cycles with deload, RPE-based, and percentage-based blocks. |
| `/integrations` | Integrations | FLAME | Connect your other apps. | Strava, Fitbit, Garmin, Hevy, Liftosaur. Two-way sync where supported. |
| `/profile` | Profile | FREE | Your account. | Display name, units, theme, subscription status, account deletion. |
| `/pricing` | Subscription | FREE | Plans and pricing. | Compare FREE, Ember, Flame, and Inferno tiers. |

`pathPattern` is a regex that matches the path including any nested segments (e.g. `/^\/routines(\/.*)?$/` for `/routines`, `/routines/new`, `/routines/:id`, `/routines/:id/view`). Each row also references an illustration asset under `/assets/preview/<route>.svg` (out of design scope to render here; placeholder static images are sufficient for first ship).

**Routing path:** `SubscribedRoute` extracts the route meta for the current path, passes the `preview` block + `requiredTier` to `<TierLocked>` instead of rendering a bare `UpgradePrompt`. AppLayout (sidebar + page chrome) **stays mounted**, so the user sees the locked surface as one of their navigation destinations rather than a full-page interruption — preserving the breadcrumb of "I'm trying to view Routines, here's what Routines is."

### Surface 4: FREE-tier dashboard + AppSidebar lock indicators

**Two coordinated changes:**

#### 4a. Move `/dashboard` out of `SubscribedRoute requiredTier="EMBER"` and build a real FREE-tier dashboard

```
              [ DESKTOP — content column for FREE TIER, sidebar at 4b ]

╭───────────────────────────────────────────────────────╮
│  Welcome back, Devil                                  │
│  Today is May 1, 2026                                 │ ← caption
│                                                       │
│  ╭─ YOUR FREE GOAL ────────────────────────────────╮  │ ← goal widget
│  │  3 workouts/week  ▰▰▰▰▰▱▱   3 of 7  on track    │  │   (FREE = 1 goal)
│  │  Want 3 goals? Upgrade to Ember →                │  │   inline upsell
│  ╰──────────────────────────────────────────────────╯  │   (NOT full-page)
│                                                       │
│  ╭─ THIS MONTH ─────────────────────────────────────╮  │ ← FREE: 30-day
│  │   12          348 sets                           │  │   window matches
│  │   workouts    2,140 reps   in last 30 days      │  │   WorkoutHistory
│  │  ─────────────────────────────────────────────── │  │   :168-181 gating
│  │  · Bench Press · today                           │  │
│  │  · Squat       · 2d ago                          │  │
│  │  · Bench Press · 4d ago                          │  │
│  │  · Deadlift    · 6d ago                          │  │
│  │  See full history →                              │  │ ← /history is
│  ╰──────────────────────────────────────────────────╯  │   EMBER-gated;
│                                                       │   click renders
│  ╭─ CONNECT YOUR MACHINE ───────────────────────────╮  │   TierLocked
│  │  [Vitruvian device illustration]                 │  │
│  │  Phoenix syncs from your mobile app.             │  │ ← hero CTA card
│  │  Open the Phoenix mobile app to link your        │  │
│  │  machine.                                        │  │
│  │  [ Get the mobile app ]                          │  │
│  ╰──────────────────────────────────────────────────╯  │
│                                                       │
│  ──────────────────────────────────────────────────   │
│  UNLOCK MORE                                          │ ← eyebrow
│  ──────────────────────────────────────────────────   │
│                                                       │
│  ╭─ EMBER $5 ──────╮  ╭─ FLAME $15 ─────────────────╮  │ ← compact tier
│  │  Cloud history  │  │  Analytics + social +       │  │   cards; NOT
│  │  unlimited      │  │  routines + cycles          │  │   full-bleed
│  │  + 3 goals      │  │                             │  │   paywall
│  │  [ Upgrade ]    │  │  [ Upgrade ]                │  │
│  ╰─────────────────╯  ╰─────────────────────────────╯  │
│                                                       │
│  Compare all plans →                                  │
╰───────────────────────────────────────────────────────╯
```

**Routing change:**

```diff
- {/* EMBER tier — cloud backup, history, dashboard */}
- <Route element={<SubscribedRoute requiredTier="EMBER" />}>
-   <Route path="/dashboard" element={<Dashboard />} />
+ {/* Dashboard is FREE-tier; renders different content per tier */}
+ <Route path="/dashboard" element={<Dashboard />} />
+
+ {/* EMBER tier — cloud backup, history */}
+ <Route element={<SubscribedRoute requiredTier="EMBER" />}>
    <Route path="/history" element={<WorkoutHistory />} />
    <Route path="/history/:sessionId" element={<SessionDetail />} />
    <Route path="/goals" element={<Goals />} />
    <Route path="/recovery" element={<Recovery />} />
  </Route>
```

`Dashboard.tsx` itself reads `useSubscription().tier` and branches:
- `tier === "FREE"` → render new `<FreeTierDashboard />`
- `tier !== "FREE"` → render existing paid-tier dashboard (current Dashboard.tsx body)

The FREE dashboard:
- 1-goal widget (the system already supports `maxGoals=1` per `Goals.tsx:293`; the widget reads from the same query)
- 30-day workout history strip (uses the same gating as `WorkoutHistory.tsx:168-181`'s `isFree ? thirtyDaysAgo : null` filter)
- "Connect a machine" hero card with App Store / Play Store deep-links (already provided in landing footer copy)
- An "Unlock more" non-blocking compare-tier card at the bottom of the page (NOT a full-page replacement; user can scroll past)

#### 4b. AppSidebar lock-icon overlay + tooltip

```
                          [ SIDEBAR — FREE TIER, EXPANDED ]

╭───────────────────────────────────╮
│  🔥  Phoenix Portal       [▶◀]   │ ← collapse trigger
├───────────────────────────────────┤
│                                   │
│   [user avatar + initials]        │
│   Devil                           │
│   FREE  · 0d streak               │ ← TierBadge "FREE"
│                                   │
├───────────────────────────────────┤
│  TRAINING                         │ ← group label (eyebrow)
│   ╭─────────────────────────────╮ │
│   │ ◐ Dashboard           ●     │ │ ← active page (no lock,
│   ╰─────────────────────────────╯ │   FREE has dashboard)
│   ◇ Workouts            🔒        │ ← lock icon, 14×14
│   ◇ Analytics           🔒🔒       │ ← double-lock = FLAME tier
│   ◇ Routines            🔒🔒       │
│   ◇ Cycles              🔒🔒       │
│                                   │
│  ─────────────                    │
│  SOCIAL                           │
│   ◇ Community           🔒🔒       │
│   ◇ Challenges          🔒🔒       │
│   ◇ Leaderboard         🔒🔒       │
│                                   │
│  ─────────────                    │
│  ACCOUNT                          │
│   ◇ Profile                       │ ← ungated
│   ◇ Integrations        🔒🔒       │
│   ◇ Subscription                  │ ← ungated (this is /pricing)
│                                   │
├───────────────────────────────────┤
│   [avatar dropdown — collapsed]   │
│                                   │
╰───────────────────────────────────╯


**Collapsed sidebar (icon-only):** lock badge sits in the upper-right 8×8 corner of the nav icon. Lock-2 (FLAME) uses a slightly different glyph (`LockKeyhole`) so it remains distinguishable at small size. Tooltip-on-hover shows the full label + tier copy + preview body.
```

**Lock affordance encoding:**

- **Single lock icon** (`Lock` from lucide, 14×14 desktop, 12×12 collapsed): EMBER tier required
- **Double lock OR a different glyph** (proposal: `Lock` with a second `Lock` 2px stacked, OR `LockKeyhole` from lucide which is visually distinct): FLAME tier required
- Color: `text-muted-foreground/60` (subdued, ~50% opacity), so locks read as decorative metadata, not as visual interrupt
- Active route never shows a lock (the user is already on that page; if they're there, they have access — handled by route gating before render)
- For ungated routes (Profile, Subscription, Dashboard for FREE): no icon

**Tooltip behavior:** `SidebarMenuButton` already supports `tooltip` (used at `AppSidebar.tsx:231`). Extend to a 3-line block: route label (top, 13px medium); tier-availability copy ("Available on Ember and above", 11px muted); compact preview body from `route-meta.ts` (sm muted, ~2 lines). Same `preview.body` string powers both the tooltip and Surface 3 — single source of truth.

**Click behavior on locked items:**

- Clicking a locked item navigates to that route (preserving URL — same UX contract as 404/AuthRequired).
- `SubscribedRoute` evaluates the user's tier; if insufficient, **TierLocked (Surface 3) renders for that route** with full preview content + upsell.
- The user is *not* hard-failed or sent to `/pricing`. They see the preview of the gated feature *at the gated URL*, with a clear upgrade path.

This pattern means a FREE user clicking through the sidebar tour gets:
- Click "Routines" → URL becomes `/routines` → TierLocked renders showing routine-builder preview + Upgrade to Flame CTA
- Click back to Dashboard → URL becomes `/dashboard` → FreeTierDashboard renders
- The user can browse the full IA without being kicked back to landing or interrupted with a modal

---

## Implementation notes

### Route table refactor

Current (broken) catch-all on line 218:

```tsx
<Route path="*" element={<Navigate to="/" replace />} />
```

Replace with a public-aware catch-all that discriminates between "path is registered as a known protected route" and "path doesn't exist":

```tsx
import { isProtectedPath, getRouteMeta } from "@/lib/route-meta";

function PublicCatchAll() {
  const location = useLocation();
  if (isProtectedPath(location.pathname)) {
    // Path matches a known protected route — user just isn't signed in.
    // Render AuthRequired at the requested URL (no redirect).
    return <AuthRequired requestedPath={location.pathname} />;
  }
  // Path doesn't match anything we know — true 404.
  return <AnonymousNotFound requestedPath={location.pathname} />;
}

// In the Routes block:
<Route path="*" element={<PublicCatchAll />} />
```

`ProtectedRoute` no longer redirects; it renders `AuthRequired` directly:

```tsx
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading />;
  if (!user) return <AuthRequired requestedPath={location.pathname + location.search} />;
  return <Outlet />;
}
```

### Tier-check helper hook + `SubscribedRoute` rewrite

Add `useTierAccess(required)` to `phoenix-portal/src/hooks/` returning `{ tier, hasAccess, isLoading }` using the existing `TIER_LEVEL` mapping (FREE=0…INFERNO=3) from `SubscriptionGate.tsx:9`. `SubscribedRoute` then reads `useLocation().pathname`, calls `getRouteMeta(path)`, and renders `<TierLocked routeMeta={meta} requiredTier={…} currentTier={tier} />` when `!hasAccess` (instead of bare `SubscriptionGate`/`UpgradePrompt`). AppLayout chrome stays mounted; no full-page redirect.

### `SubscriptionGate` becomes opt-in for inline use

`SubscriptionGate.tsx` is no longer used at the route level by default. It remains for *inline* gating (e.g., Goals shows 1 FREE goal then gates the next 2). Add a `mode?: "route" | "inline"` prop. `mode="inline"` renders a 3-line compact upsell card, not a full-page `UpgradePrompt`. This is what the proposal calls for in §4a (FREE-tier dashboard surfaces inline upsells, not full-page paywalls).

### URL preservation contract

Three rules:
1. **Never redirect** to `/` for an unmatched or unauthorized path. Always render at the requested URL with the appropriate surface (AnonymousNotFound, AuthRequired, or TierLocked).
2. **Browser bookmark = first-class citizen.** A user bookmarking `/routines/new` and returning later, signed out, sees AuthRequired at `/routines/new`. Sign in → land at `/routines/new` → TierLocked (if FREE) or RoutineBuilder (if FLAME+).
3. **`?next=` is only used by `/auth/callback`** for OAuth/magic-link flows where the auth flow takes the user away from the route. Email/password sign-in via the dialog uses URL preservation, not `?next=`. This minimizes the open-redirect attack surface.

### Test plan

Vitest unit tests:
- `safeRedirect.test.ts` — rejects all 5 malicious inputs (https://, //attacker, javascript:, /not-registered, CRLF), accepts each KNOWN_PROTECTED_PATH
- `route-meta.test.ts` — every route in `routes/index.tsx` has a corresponding entry in `PROTECTED_ROUTES`
- `useTierAccess.test.ts` — FREE < EMBER < FLAME < INFERNO; isLoading state

Playwright E2E:
- visit `/this-doesnt-exist` while signed out → AnonymousNotFound renders, URL is preserved
- visit `/dashboard` while signed out → AuthRequired renders, URL is preserved
- sign in via dialog from AuthRequired → RoutineBuilder/Dashboard/etc. renders at the same URL
- as FREE user, visit `/dashboard` → FreeTierDashboard renders (1 goal, 30-day history, hero CTA, inline upsell)
- as FREE user, click "Routines" in sidebar → TierLocked at `/routines` with preview content
- as FREE user, click "Compare plans" link from TierLocked → `/pricing`
- sidebar lock icons present on Workouts/Analytics/Routines/etc.; absent on Profile/Pricing/Dashboard

---

## Acceptance criteria

- [ ] Visiting any unmatched path while signed out renders `AnonymousNotFound` at the requested URL — URL is **not** rewritten to `/`
- [ ] Visiting any registered protected path (per `PROTECTED_ROUTES`) while signed out renders `AuthRequired` at the requested URL — URL is **not** rewritten to `/`
- [ ] After successful sign-in from `AuthRequired`, the user lands at the requested URL with the appropriate surface (page itself if tier suffices; `TierLocked` if not)
- [ ] FREE tier user signing in lands on `/dashboard` and sees `FreeTierDashboard` — no full-page paywall, no `UpgradePrompt`-as-route
- [ ] `FreeTierDashboard` shows: 1 goal widget, 30-day workout history strip, "Connect machine" hero card, compact "Unlock more" tier-compare card at the bottom
- [ ] Clicking a tier-locked sidebar item navigates to that URL and renders `TierLocked` with the route's preview content + Upgrade CTA — never sends user back to landing
- [ ] AppSidebar shows lock icons on tier-gated items (single lock = EMBER, double lock or distinct glyph = FLAME); ungated items have no lock icon
- [ ] Sidebar item tooltips include both the route label and the tier-availability copy ("Available on Ember and above") plus the preview body
- [ ] `?next=` query param (used only on `/auth/callback`) is sanitized via `safeRedirect.ts`: rejects external URLs, scheme-injection, protocol-relative, CRLF, and unknown paths
- [ ] All 5 sanitization malicious-input tests pass
- [ ] `OnboardingOverlay` either re-tier-branches its slides or is dismissed before `FreeTierDashboard` renders (decision: re-tier-branch; FREE users see "Track 1 weekly goal", "Browse 30 days of history", "Upgrade for unlimited" — features that match what they actually have access to)
- [ ] Existing authenticated catch-all `routes/index.tsx:213 <Route path="*" element={<NotFound />} />` continues to work for signed-in users hitting an unknown path inside the app shell — `NotFound.tsx` is unchanged
- [ ] No `<Navigate to="/" replace />` remains in `routes/index.tsx` or `ProtectedRoute.tsx` for the not-found / unauthenticated paths

---

## What this does NOT change

- **Pricing logic, billing flows, Paddle integration** — entirely out of scope. The `useSubscription` hook, `TIER_PRICING` constants, Paddle webhook handling, and `/auth/callback` Paddle reconciliation are untouched. This is a UX-surfacing redesign, not a billing change.
- **Subscription tier definitions** — FREE/EMBER/FLAME/INFERNO retain their existing tier numbers and gating boundaries. No tier features are added, removed, or moved between tiers.
- **OAuth providers** — Magic-link, Google sign-in, etc. are unchanged. The `?next=` mechanic is additive: it's read by `/auth/callback` *if present*, not required.
- **Real-time sync (`useRealtimeSync`)** — out of scope. Sync invalidation continues to work as today.
- **Existing public pages** (Landing, Privacy, Terms, FAQ, ResetPassword) — unchanged. The catch-all rewrite only affects unmatched paths and protected routes.
- **Mobile bottom-nav reordering** (`02-F-015` / G-129) — explicitly *out of design scope* for this mockup. The audit recommends the IA workshop in REPORT.md §6.5 to decide whether to (a) promote Routines + Cycles to primary bottom-nav slots in place of Community + Analytics, (b) collapse to 4-tab matching mobile-app's tab structure (no Social/Community on mobile breakpoint), or (c) keep current 4-primary + More layout and just add lock affordances inside More. Defer pending IA workshop. **Note:** the lock-icon affordances designed in Surface 4b *do* extend automatically to the mobile More drawer (each item rendered there shares the same `lib/route-meta.ts` lookup), so the mobile drawer becomes self-documenting at no additional design cost — just a follow-up to apply the lock-icon overlay to `MobileBottomNav.tsx` lines 247-265.
- **Authenticated `NotFound.tsx`** (`phoenix-portal/src/app/components/NotFound.tsx`) — unchanged. Continues to render inside `AppLayout` for signed-in users hitting an unknown path within the app shell. Only the *public* catch-all is rewritten.
- **`OnboardingOverlay` slide content** — out of design scope for the *visual* mockup, but a rewrite of slide copy to tier-branch is a recommended follow-up (per `02-F-014` / G-113-equivalent). Mocked here only as a behavior change ("show different slides per tier"), not as a visual redesign.

---

## Open questions / decisions deferred

1. **Lock-icon glyph for FLAME** — single Lock at higher contrast vs. double-Lock vs. `LockKeyhole`. Recommend usability test with 5 users. Mockup currently shows double-lock for FLAME and single-lock for EMBER; final decision belongs to the IA workshop.
2. **`/integrations` should it be FREE or FLAME?** — Currently FLAME. The "Connect your other apps" preview is one of the most-asked-for FREE features per support tickets. Out of scope for this mockup; flag for product.
3. **Should `/profile` show a different shape for FREE vs paid?** — Current Profile renders `undefined` for FLAME (G-002). After the G-002 fix, the profile is functional for all tiers. No tier-branching needed. Profile is a `requiredTier: "FREE"` route in `lib/route-meta.ts`.
4. **`OnboardingOverlay` rewrite** — separate `02-F-014` follow-up. The acceptance criterion above only requires that the overlay *not contradict* the FREE dashboard ("don't promise Analytics on a slide and then show a paywall"). Whether the overlay is rewritten, removed, or branched is a product call.
5. **Telemetry on lock-click → upgrade** — when a FREE user clicks a locked sidebar item, should the click fire a `tier_locked_clicked` analytics event? Recommendation: yes, for funnel analysis. Out of scope for the visual mockup.
