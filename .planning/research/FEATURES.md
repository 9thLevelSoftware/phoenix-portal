# Feature Research — Visual UI Patterns

**Domain:** Premium fitness analytics dashboard (dark theme, visual overhaul)
**Researched:** 2026-02-20
**Confidence:** MEDIUM — WebSearch verified against multiple design references; no Context7 applicable (this is design pattern research, not library docs)

---

## Context

This is a SUBSEQUENT MILESTONE research document. The goal is NOT to add features —
it is to identify what visual UI patterns make an existing fitness dashboard feel premium.

Phoenix Portal v1.1 already has: Dashboard, Analytics, Biomechanics, Routine Builder,
Cycle Builder, Challenges, Community, Goals, Recovery, Comparison, Session Replay,
Integrations, Pricing, and full auth flows.

The question: What does "premium" look like, and how do we get there without adding
feature surface area?

Reference apps: Whoop, Strava, Peloton, TrainHeroic, Linear, Vercel, Notion (dark mode)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these makes the app feel "developer-built" rather than product-quality.

| Visual Pattern | Why Expected | Complexity | Notes |
|----------------|--------------|------------|-------|
| Collapsible sidebar navigation | Every premium analytics app (Whoop web, Linear, Vercel) uses left sidebar not horizontal nav; 13-item horizontal nav looks like a legacy admin panel | MEDIUM | shadcn/ui Sidebar component exists; spring-animate open/close; icon-only collapse state with tooltips |
| Inter as declared font with variable weights | Inter is the de facto standard for premium SaaS/fitness dashboards; "system-ui" fallback signals unfinished product | LOW | Already in stack; add `font-family: 'Inter Variable'` on body; use weights 450 (body) and 625 (subheadings) via variable font |
| Consistent page shell (max-width, padding) | Without a shared shell, pages look like disconnected screens not a product | LOW | Single `<PageShell>` component wrapping all pages with consistent max-width and padding rhythm |
| Card surface hierarchy (3 levels) | Users need visual depth to scan dashboards; flat cards at identical elevation look unpolished | MEDIUM | Level 1: `bg-[#141414]` base; Level 2: `bg-[#1A1A1A]` cards; Level 3: `bg-[#202020]` inset/hover states |
| Subtle 1px card borders | Premium dark UIs (Linear, Vercel Geist) use `border: 1px solid rgba(255,255,255,0.08)` to lift cards from background; invisible borders make cards look painted-on | LOW | Replace `border-0` or heavy borders with hairline rgba borders |
| Skeleton loading states (not spinners) | Spinners signal "we don't know what's coming"; skeleton screens signal "we know the layout, data is arriving" — Twitter popularized in 2012, now expected | MEDIUM | Match exact layout of loaded content; use shimmer gradient `from-transparent via-white/5 to-transparent` |
| Custom chart tooltips | Default Recharts tooltips look like dev tools, not product; Whoop/Strava use custom-styled, branded tooltips | MEDIUM | shadcn/ui-style card inside `<Tooltip content={<CustomTooltip />}>`; Phoenix brand colors, no default gray |
| Styled chart axes and gridlines | Raw D3/Recharts default axes are plain black lines; premium apps use `rgba(255,255,255,0.06)` gridlines and remove all axis borders | LOW | `<CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.06)" />` pattern |
| Active nav state with pill/indicator | Users need to know where they are; pill highlight or left-border indicator on active nav item | LOW | `bg-white/8` pill or `border-l-2 border-ember` indicator on active route |
| Consistent empty states with CTAs | Pages that show blank space on first use signal abandonment; Notion/Linear use icon + headline + action | LOW | Already partially deployed (v1.1); needs visual upgrade to brand-consistent illustration style |

### Differentiators (Competitive Visual Advantage)

Patterns that are not expected but immediately signal "this is a premium product."

| Visual Pattern | Value Proposition | Complexity | Notes |
|----------------|-------------------|------------|-------|
| Ambient background gradient (atmospheric effect) | The single highest-impact change: radial gradients in brand colors behind content create depth that glassmorphism cards need to feel alive; static flat black (#0D0D0D) makes glass invisible | LOW | Two or three `position: fixed` radial gradient orbs at 10-15% opacity in Ember (#FF6B35) and Gold (#F59E0B); z-index: 0; non-interactive |
| Glassmorphism on selected high-priority cards only | Used sparingly on the most important stat cards (Recovery score, streak, active challenge), glassmorphism signals "this data matters"; overuse kills the effect | MEDIUM | `backdrop-filter: blur(12px)` + `bg-white/8` + `border border-white/10`; limit to 2-3 cards per page; requires ambient gradient backdrop |
| Spring-physics hover states on cards | Linear-style hover: `scale(1.02)` + soft glow shadow on hover using Framer Motion spring config `{stiffness:400, damping:30}`; feels native not "webby" | LOW | `whileHover={{ scale: 1.02, boxShadow: "0 8px 32px rgba(255,107,53,0.15)" }}` on stat cards; NOT on data tables |
| Stat count-up animation on mount | Numbers counting up from 0 when the dashboard loads (streak count, total volume, PR numbers) creates moment of delight; Whoop uses this pattern | MEDIUM | Framer Motion `animate={{ opacity: 1 }}` + custom useCountUp hook with `requestAnimationFrame`; 800ms duration |
| Staggered card reveal on page load | Cards appearing sequentially (50ms delay per card) instead of all at once signals choreography and intent; Linear, Vercel dashboards use this | LOW | Framer Motion `staggerChildren: 0.05` in `variants` on page container |
| Page transition animations | Fade-in/slide-up on route change instead of hard cuts; signals a real product vs a website | LOW | Framer Motion `AnimatePresence` + `initial={{ opacity: 0, y: 8 }}` → `animate={{ opacity: 1, y: 0 }}`; 200ms ease-out |
| Brand-tinted box shadows | Default shadows are gray/black; premium fitness apps tint shadows with brand color at low opacity — creates visual identity even in shadows | LOW | `box-shadow: 0 0 24px rgba(255,107,53,0.12)` on primary action cards; `rgba(245,158,11,0.10)` on achievement cards |
| Custom chart gradient fills | Recharts area charts with gradient fills from brand color to transparent make data visualization feel premium vs flat-color fills | LOW | `<defs><linearGradient>` in SVG with stop at 40% opacity to 0% at bottom; standard pattern |
| Variable font weight hierarchy | Using Inter Variable at non-standard weights (450 for body, 625 for labels, 800 for hero stats) creates visible refinement vs 400/600/700 jumps | LOW | Set CSS `font-variation-settings: 'wght' 450` rather than font-weight integer; requires Inter Variable loaded |
| Letter-spacing on uppercase labels | Fitness apps (Whoop, Garmin Connect) use `letter-spacing: 0.1em` on small uppercase labels (`RECOVERY`, `STRAIN`, `7-DAY AVG`); adds polish | LOW | `tracking-widest text-xs uppercase text-white/50` Tailwind pattern |
| Micro-interaction on voting/reactions | When users upvote a routine, a tiny ember spark animation confirms the action; stronger than a toast | HIGH | Custom SVG animation; Framer Motion keyframes; only for community voting — NOT general |

### Anti-Features (Things That Reduce Premium Feel)

Patterns that seem desirable but actively make the product look cheaper or cause problems.

| Anti-Feature | Why Tempting | Why It Backfires | What to Do Instead |
|--------------|-------------|------------------|--------------------|
| Glassmorphism everywhere | Looks impressive in Dribbble mockups | Requires vivid background to be visible; on flat black it disappears and causes accessibility failures (text on blur); GPU-intensive on many elements simultaneously | Reserve for 2-3 priority cards per page; use surface hierarchy (bg elevation) for all other cards |
| Neumorphism on dark backgrounds | Trend-adjacent, looks 3D | Near-impossible to achieve adequate WCAG contrast on dark surfaces; embossed/debossed looks requires mid-tone backgrounds not #0D0D0D | Stick to glassmorphism + elevation for depth signaling |
| Neon glow everywhere | Cyberpunk aesthetic looks edgy | Looks like a gaming UI from 2018; Phoenix brand is Ember/Gold not neon; neon at high saturation reads as cheap | Single accent glow only on the most critical state indicator (recovery ring, streak flame); use brand colors not cyan/magenta |
| Heavy page transitions (slide full screen) | Feels like a "real app" | 300-500ms full-slide transitions make the app feel slow; users navigate frequently in dashboards | Use 150-200ms fade + 8px Y-translate only; never slide entire pages horizontally |
| Particle / Canvas background animations | Wow factor in demos | Significant CPU/GPU cost on continuous animation; causes battery drain on laptops; distracts from data | Use static radial gradient orbs; no moving particles |
| Custom scrollbars (thin colored) | Premium feel detail | Cross-browser inconsistent; Firefox ignores most scrollbar styling; custom scrollbars are a maintenance burden | Style only `-webkit-scrollbar` as a progressive enhancement; never rely on it for visual hierarchy |
| Dark glassmorphism on form inputs | Looks premium in screenshots | Blur behind inputs confuses users about what's interactive vs decorative; defeats accessibility affordances | Keep form inputs with solid background; glass only on informational cards |
| Animated gradient backgrounds (shifting hues) | Modern, dynamic | CSS hue-rotate animations cause motion sickness for some users; conflict with `prefers-reduced-motion`; expensive | Static gradient orbs with no animation; respect `prefers-reduced-motion` |
| Excessive stagger delays | Feels like choreography | If stagger > 80ms per element on a 10-card grid, users wait 800ms for the page to feel usable — worse than no animation | Max 50ms stagger, 200ms total animation window; all content visible within 400ms of navigation |
| Loading spinners in charts | Familiar | Signals the app doesn't know its own layout; breaks spatial memory | Always skeleton-match the chart's exact dimensions; use a subtle shimmer not a spinner |

---

## Feature Dependencies

```
Ambient gradient backdrop
    └──required by──> Glassmorphism cards (glass is invisible without it)
                          └──required by──> Brand-tinted shadows (shadow blends with gradient)

Inter Variable font loaded
    └──required by──> Variable weight hierarchy
                          └──required by──> Letter-spacing uppercase labels (needs declared font)

Collapsible sidebar
    └──required by──> Consistent page shell (shell width changes based on sidebar state)
                          └──required by──> Chart responsive sizing (charts need stable container width)

Spring hover states
    └──enhances──> Card surface hierarchy (hover reveals the elevation difference)

Page transition AnimatePresence
    └──conflicts with──> React Router v7 ViewTransition API (don't mix both; pick one)
```

### Dependency Notes

- **Ambient gradient required first:** Without the fixed radial gradients as a backdrop, glassmorphism is invisible and the whole depth system breaks. This must be the first visual change deployed.
- **Font before letter-spacing:** Inter Variable must be declared on `body` before any variable-weight or letter-spacing work; otherwise fallback system-ui gets those styles.
- **Sidebar before page shell:** The page shell's content area width depends on sidebar collapsed/expanded state; build sidebar first, then lock in content max-width.
- **Spring hover conflicts with glassmorphism glass cards:** `backdrop-filter` + `transform: scale()` together cause rendering artifacts in Chrome on some GPU configs. Use `will-change: transform` on the card to promote it to its own compositing layer before animating.

---

## MVP Recommendation for v1.2

This is a visual overhaul milestone, not a feature milestone. The "MVP" means the minimum
changes that shift the perceived quality from "dev tool" to "premium product."

### Highest Impact / Lowest Risk (Do First)

- [ ] Inter Variable declared on body — eliminates system-ui fallback immediately
- [ ] Ambient gradient orbs on background — enables everything else; single CSS change
- [ ] 1px card borders (`border-white/8`) — lifts all cards simultaneously
- [ ] Collapsible sidebar replacing horizontal nav — single biggest structural change
- [ ] Consistent `<PageShell>` max-width/padding — eliminates width inconsistencies
- [ ] Custom chart tooltips + styled axes/gridlines — affects every analytics page

### High Impact / Medium Risk (Do Second)

- [ ] Card surface hierarchy (3 elevation levels) — requires CSS token updates
- [ ] Skeleton loading states replacing spinners — requires per-component work
- [ ] Staggered card reveal animations — Framer Motion; low risk, needs testing across pages
- [ ] Brand-tinted box shadows on priority cards — polish pass
- [ ] Page transition animations (AnimatePresence) — test with all 26 routes

### Differentiating Polish (Do Last, If Time)

- [ ] Stat count-up animations on dashboard — delightful but not blocking
- [ ] Glassmorphism on top-3 priority cards per page — requires careful selection
- [ ] Variable font weight hierarchy refinement — fine-tuning pass
- [ ] Letter-spacing on uppercase labels — single Tailwind class pass
- [ ] Gradient fills in area charts — chart-by-chart pass

### Explicit Deferrals

- Custom micro-animation on vote button — HIGH complexity, LOW ROI for visual overhaul
- Neumorphism anything — avoid entirely
- Particle/canvas backgrounds — avoid entirely

---

## Competitor Feature Analysis

| Visual Pattern | Whoop | Strava | Linear | Phoenix Portal v1.1 | Phoenix Portal v1.2 Target |
|----------------|-------|--------|--------|---------------------|---------------------------|
| Navigation pattern | Bottom tabs (mobile) / sidebar (web) | Bottom tabs | Collapsible sidebar | 13-item horizontal nav | Collapsible sidebar |
| Background | Near-black (#0B0B0B), solid | White/light | Near-black with subtle gradient | #0D0D0D solid | #0D0D0D + radial gradient orbs |
| Card treatment | Slight elevation, hairline borders | White cards with shadows | Ghost borders, 2-level elevation | Mixed, some hardcoded colors | 3-level surface hierarchy |
| Typography | Custom/Inter, strong weight contrast | Neue Haas Grotesk | Inter + Inter Display for headings | system-ui fallback | Inter Variable, declared |
| Chart style | Custom dark, branded colors, minimal grid | Strava orange, clean | Minimal, data-first | Recharts defaults | Custom tooltips, rgba gridlines, gradient fills |
| Loading states | Skeleton screens | Skeleton screens | Skeleton screens | Spinner in some areas | Skeleton matching content layout |
| Hover states | Native-app-feel spring | Subtle | Spring physics, scale | CSS transition only | Framer Motion spring |
| Empty states | Branded, clear CTA | Simple, friendly | Monochrome illustration + CTA | Partially deployed | Brand-consistent, consistent pattern |
| Shadows | Brand-tinted (red glow) | Minimal | Minimal, neutral | Generic or none | Ember-tinted on priority cards |
| Font size/weight | Large hero stats, small labels uppercase | Clear hierarchy | Clear hierarchy, Inter | Inconsistent | Fixed scale from design system tokens |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Table stakes patterns | MEDIUM | Based on multiple WebSearch sources + LinearApp official redesign post |
| Glassmorphism specifics | MEDIUM | Official CSS specs verified (backdrop-filter); design opinion based on multiple sources |
| Competitor analysis (Whoop/Linear) | MEDIUM | Whoop official blog post + Linear official redesign post; TrainHeroic had no findable design docs |
| Animation values (spring configs) | MEDIUM | Framer Motion official docs confirmed spring physics; specific stiffness/damping values are community consensus |
| Typography (Inter weights) | HIGH | Inter Variable is documented; weight 450/625 pattern comes from documented real-world usage |
| Anti-features | MEDIUM | Based on design community consensus + accessibility standards; subjective in places |

---

## Sources

- [Whoop App Navigation Redesign](https://www.whoop.com/us/en/thelocker/app-update-navigation-bar/) — official Whoop blog, navigation pattern
- [Linear UI Redesign (Part II)](https://linear.app/now/how-we-redesigned-the-linear-ui) — official Linear engineering blog, color/typography/elevation system
- [Dark Glassmorphism Implementation Guide](https://playground.halfaccessible.com/blog/glassmorphism-design-trend-implementation-guide) — specific CSS values, performance notes
- [Muzli Dashboard Design Examples 2026](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026/) — dark theme analytics dashboard patterns
- [Glassmorphism Best Practices](https://uxpilot.ai/blogs/glassmorphism-ui) — 12 best practices + examples
- [Framer Motion Spring Physics](https://motion.dev/docs/react) — official Motion docs, spring animation parameters
- [shadcn/ui Charts](https://www.shadcn.io/charts) — dark mode chart CSS variable patterns
- [Sidebar Navigation Examples 2025](https://www.navbar.gallery/blog/best-side-bar-navigation-menu-design-examples) — premium sidebar design patterns
- [Inter Variable Font](https://medium.com/fleetx-engineering/choosing-the-right-font-for-saas-application-511a708d6e3d) — weight recommendations for SaaS dashboards
- [Micro-animations 2025](https://almaxagency.com/design-trends/the-psychology-of-micro-animations-how-tiny-movements-drive-user-engagement-in-2025/) — micro-interaction patterns and timing
- [React View Transitions (official)](https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more) — React's native view transition API status

---

*Feature research for: Phoenix Portal v1.2 Premium Visual Overhaul*
*Researched: 2026-02-20*


---

# === v1.3 Research (from main) ===

# Feature Research: RevenueCat Billing Migration

**Domain:** Subscription billing migration (Stripe to RevenueCat) for web companion app
**Researched:** 2026-02-28
**Confidence:** HIGH (existing codebase thoroughly audited, RevenueCat docs verified)

## Context

Phoenix Portal currently uses Stripe for web subscription billing (checkout, portal, webhooks). The mobile app uses RevenueCat. This migration makes the portal a **consumer** of subscription status managed by RevenueCat, not a billing originator. The portal will no longer initiate purchases -- users subscribe through the mobile app, and the portal reads that status.

**Existing Stripe surface area (6 source files + 3 Edge Functions + 1 SQL migration):**
- `src/lib/stripe.ts` -- `redirectToCheckout()`, `openCustomerPortal()`, `@stripe/stripe-js` import
- `src/app/components/PricingPlans.tsx` -- checkout flow with `PRICE_IDS`, `redirectToCheckout()` calls
- `src/app/components/Profile.tsx` -- imports `openCustomerPortal` for subscription management
- `src/lib/__tests__/stripe-webhook-handlers.test.ts` -- webhook handler tests
- `src/lib/database.types.ts` -- `subscriptions` table with `stripe_customer_id`, `stripe_subscription_id`
- `src/lib/export/data-export.ts` -- references subscription data for GDPR export
- `supabase/functions/stripe-checkout/` -- creates Stripe Checkout sessions
- `supabase/functions/stripe-portal/` -- creates Stripe Customer Portal sessions
- `supabase/functions/stripe-webhooks/` -- handles 5 Stripe webhook events, writes to `subscriptions` table
- `supabase/migrations/00001_create_subscriptions.sql` -- Stripe-oriented `subscriptions` table + `user_subscription_tier()` function
- 6 `VITE_STRIPE_*` environment variables in client config

**Pre-existing RevenueCat infrastructure (from mobile app, already in Supabase):**
- `user_subscriptions` table exists with columns: `revenuecat_customer_id`, `product_id`, `subscription_status`, `expires_at`, `last_verified_at`, `user_id`
- Table currently marked DEPRECATED in migration `20260228_rls_denormalization.sql` (must be un-deprecated)
- No `tier` column exists on `user_subscriptions` -- must be added or derived from `product_id`

---

## Feature Landscape

### Table Stakes: Core Migration (Must Ship Together)

Features that must deploy atomically. Missing any one = broken billing system.

| Feature | Why Required | Complexity | Existing Code Affected |
|---------|-------------|------------|----------------------|
| RevenueCat webhook Edge Function | Receives subscription lifecycle events (INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE, PRODUCT_CHANGE, UNCANCELLATION) and writes to `user_subscriptions` table. Replaces `stripe-webhooks` Edge Function. | MEDIUM | New Edge Function; replaces `supabase/functions/stripe-webhooks/` (203 lines) |
| Webhook authorization | Validate incoming webhook requests via Authorization header. RevenueCat does NOT support HMAC signature verification -- only a shared secret header. Simpler than Stripe's `constructEventAsync` but less secure. | LOW | Part of new Edge Function. Store secret as `REVENUECAT_WEBHOOK_SECRET` env var. |
| RevenueCat REST API verification call | After receiving webhook, call `GET /v1/subscribers/{app_user_id}` to get authoritative subscription state. RevenueCat best practice: never trust webhook payload alone -- always verify with API. | MEDIUM | Outbound HTTP call from Edge Function. Requires `REVENUECAT_API_KEY` env var (secret key). |
| Webhook idempotency | RevenueCat retries failed webhooks up to 5 times (delays: 5, 10, 20, 40, 80 minutes). Edge Function must handle duplicate events via upsert on `user_id`. | LOW | Same upsert pattern as existing `stripe-webhooks` handler. |
| Subscription table migration | Switch portal from `subscriptions` table (Stripe) to `user_subscriptions` table (RevenueCat). Un-deprecate `user_subscriptions`. Add `tier` column derived from `product_id` or RevenueCat entitlement. | MEDIUM | `useSubscription.ts` query target, `00001_create_subscriptions.sql` function body, RLS policies in comments and goals migrations |
| `user_subscription_tier()` SQL function update | Change function body from querying `subscriptions` table to querying `user_subscriptions` table. This SECURITY DEFINER function is called by RLS policies for community comments (PHOENIX+ only) and goal limit enforcement. | HIGH (risk) | Function used in `20260218_phase11_comments.sql` and `20260219_phase11_goals.sql`. Must be atomic -- no window where tier check returns wrong value. |
| `useSubscription` hook rewrite | Change query from `subscriptions` table to `user_subscriptions` table. Map RevenueCat fields (`subscription_status`, `product_id`, `expires_at`) to existing `SubscriptionTier` and `SubscriptionStatus` types. Return interface MUST stay identical. | MEDIUM | `src/hooks/useSubscription.ts` (105 lines). Consumed by 15+ components including SubscriptionGate, TierBadge, PricingPlans, Profile, Analytics, Biomechanics, Recovery, Goals, Integrations, SessionReplay, ComparisonView, CommentThread. |
| Realtime subscription listener update | Current `useSubscription` listens to `postgres_changes` on `subscriptions` table. Must switch channel to `user_subscriptions` table. | LOW | Channel target in `useSubscription.ts` changes from `subscriptions` to `user_subscriptions`. |
| Product-to-tier mapping | Map RevenueCat `product_id` values (e.g., `phoenix_monthly`, `elite_annual`) to FREE/PHOENIX/ELITE tiers. Replaces `getTierFromPriceId()` in webhook handler and `PRICE_IDS` in PricingPlans. | LOW | New constant in `src/lib/pricing.ts`. Centralizes mapping alongside existing `TIER_PRICING`. |
| Entitlement-to-tier mapping | RevenueCat uses entitlements (e.g., "phoenix_access", "elite_access") not tier names. Must map entitlement IDs from webhook `entitlement_ids` array and REST API response to FREE/PHOENIX/ELITE. | LOW | Additional mapping function in `src/lib/pricing.ts`. |
| PricingPlans page rewrite | Remove checkout buttons, Stripe price IDs, `redirectToCheckout()`. Replace with "Subscribe in the Phoenix App" CTAs pointing to app store or deep link. Keep tier comparison cards, feature lists, and monthly/annual toggle for price display. | MEDIUM | `src/app/components/PricingPlans.tsx` (321 lines). Remove `@stripe/stripe-js` import, `PRICE_IDS` constant, `handleSubscribe()`, `isPriceConfigured()`. Replace CTA buttons. |
| UpgradePrompt update | Current CTA button links to `/pricing` which shows checkout buttons. After migration, the prompt must say "Subscribe in the Phoenix App" or "Upgrade in the Phoenix App". | LOW | `src/app/components/UpgradePrompt.tsx` (114 lines). Change button text + optionally add app store links. |
| Profile subscription management update | Remove `openCustomerPortal()` import and "Manage Subscription" button that opens Stripe portal. Replace with subscription status display + "Manage in App" guidance. | LOW | `src/app/components/Profile.tsx` -- single import from `src/lib/stripe`, one button handler. |
| Remove Stripe client library | Delete `src/lib/stripe.ts` and uninstall `@stripe/stripe-js` package. Eliminates the lazy-loaded Stripe JS chunk (`stripe-CuNEbjmv.js`). | LOW | `src/lib/stripe.ts` (45 lines), `package.json` dependency, build artifact. |
| Delete Stripe Edge Functions | Remove `stripe-checkout`, `stripe-portal`, `stripe-webhooks` directories. | LOW | 3 directories, ~365 lines total. |
| Remove Stripe environment variables | Delete 6 `VITE_STRIPE_*` vars and 4 server-side `STRIPE_*` vars from `.env.example`, deployment configs, and Edge Function env. Add `REVENUECAT_WEBHOOK_SECRET` and `REVENUECAT_API_KEY`. | LOW | `.env.example`, deployment configuration. |
| Delete/replace Stripe webhook tests | Remove `src/lib/__tests__/stripe-webhook-handlers.test.ts`. Write equivalent tests for RevenueCat webhook handler. | MEDIUM | Test file replacement with new event type coverage. |

### Table Stakes: Identity Mapping (Portal-Side Requirement)

| Feature | Why Required | Complexity | Notes |
|---------|-------------|------------|-------|
| Supabase user ID as RevenueCat `app_user_id` | RevenueCat webhook payloads contain `app_user_id`. This must match Supabase `auth.uid()` so the webhook handler can write to the correct user's row. The mobile app must call `Purchases.logIn(supabaseUserId)` after authentication. | LOW (portal side) | Portal webhook handler extracts `event.app_user_id` from payload and uses it as `user_id` in `user_subscriptions` table. If mobile app sends `$RCAnonymousID` instead, matching fails. This is a mobile app requirement, not portal code. |

### Differentiators (Valuable but Not Blocking Migration)

Features that improve the migration UX but can ship after the core migration is verified working.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Grace period / billing issue UI | When BILLING_ISSUE event fires, show a warning banner ("Payment issue detected -- update your payment method in the app") but keep access active. RevenueCat keeps entitlements active during grace period (3-16 days depending on store). Only revoke on EXPIRATION. | MEDIUM | New status mapping in `useSubscription`: billing_issue status keeps `isPremium: true` but adds a `hasBillingIssue: boolean` flag. New banner component reads this flag. |
| Subscription status banner | Contextual banner for degraded states: billing issue, expiring soon (< 7 days), recently downgraded, subscription paused (Play Store only). More informative than the current simple TierBadge. | MEDIUM | New component. Reads `expires_at`, `subscription_status` from `user_subscriptions`. Conditionally renders warning/info banner. |
| Smart app store redirect | Detect user's platform (iOS/Android/desktop) and link directly to correct app store listing when showing "Subscribe in App" CTAs. | MEDIUM | User-Agent or `navigator.userAgentData` detection. Requires mobile app's App Store and Play Store URLs. Falls back to generic "open the Phoenix App" on desktop. |
| QR code for desktop subscribe | On desktop browsers, show a QR code on the pricing page that deep-links to the mobile app's subscription page. Bridges the gap when user is on a computer. | LOW | Small library like `qrcode.react` (~3KB). Points to app store URL or universal link. |
| Subscription sync health check | Background verification that subscription status in database matches RevenueCat's source of truth. Catches missed webhooks. Run via Edge Function on app load, cached for 5+ minutes. | HIGH | New Edge Function `verify-subscription` calling RevenueCat REST API v1 `GET /subscribers/{app_user_id}`. Compares with `user_subscriptions` row and updates if drifted. Triggered by TanStack Query with long `staleTime`. |
| Manage Subscription deep link | Instead of just text saying "manage in app", provide a deep link that opens the mobile app directly to its subscription management screen. | LOW | Requires mobile app to register a custom URL scheme (e.g., `phoenix://settings/subscription`). Portal renders it as `<a href>`. |
| Migration transition banner | For existing Stripe subscribers during the cutover window, show one-time banner explaining the billing change: "Your subscription is now managed through the Phoenix App." | LOW | Temporary component. Check if user has entry in old `subscriptions` table but not in `user_subscriptions`. Show dismissible banner. Remove component after migration window closes. |
| Offline-resilient entitlement cache | Persist last-known subscription tier in localStorage so gated features don't flash "upgrade" prompt during momentary network issues. | LOW | TanStack Query already caches, but localStorage provides persistence across page reloads. Write tier to localStorage on every successful fetch. Read from localStorage as initial data in `useQuery`. |

### Anti-Features (Do NOT Build)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Web checkout via RevenueCat Web Billing | "Keep web purchase option alongside mobile" | RevenueCat Web Billing uses Stripe under the hood (2.9% + 30c fees per transaction), adds complexity of two billing paths, creates entitlement conflict scenarios when same user has both web and mobile subscriptions, defeats the purpose of unifying billing through mobile. | Remove web checkout entirely. Single billing path through mobile app stores. |
| RevenueCat JS SDK in portal | "Use `@revenuecat/purchases-js` to check entitlements client-side" | Adds client-side dependency (~50KB), requires exposing a public API key, creates two sources of truth (SDK cache vs database), conflicts with portal's server-state-first architecture (TanStack Query + Supabase). | Read from `user_subscriptions` database table via Supabase. Server is the source of truth, populated by webhooks. |
| Stripe fallback / dual billing | "Keep Stripe as fallback during migration" | Two active billing systems = two webhook handlers, two subscription tables, reconciliation nightmares, users could have conflicting tiers between systems. | Hard cutover. Migrate all existing Stripe subscribers to RevenueCat first (outside portal scope, handled by mobile team), then deploy portal changes. |
| Client-side RevenueCat API calls | "Call RevenueCat REST API directly from browser" | Exposes secret API key in client bundle. RevenueCat secret keys grant read/write access to all customer data. Never put in frontend code. | All RevenueCat API calls happen in Edge Functions (server-side). Portal reads database only. |
| Automatic tier downgrade on CANCELLATION | "Immediately revoke access when cancellation webhook fires" | CANCELLATION means the user canceled, but they retain access until the end of their billing period. Grace periods can extend 60+ days during billing retry. Revoking on CANCELLATION = angry paying customers. | Only downgrade tier when EXPIRATION event fires. RevenueCat handles the timing -- trust `expires_at` date and `isActive` status from the API verification call. |
| In-portal subscription tier change | "Let users upgrade/downgrade tiers from the web" | App store billing rules (Apple, Google) require subscription modifications through the store that originated the purchase. A web portal cannot modify an App Store or Play Store subscription. | Show current tier + "Change plan in the Phoenix App" with link or deep link. |
| Custom billing retry / dunning emails | "Implement our own retry logic for failed payments" | RevenueCat + app stores handle billing retry automatically (Apple: up to 60 days, Google: up to 30 days). Custom retry interferes with platform behavior and can cause duplicate charges. | Let RevenueCat handle retry. Show user a "payment issue" banner on the portal. |
| Subscription analytics / MRR dashboard | "Show subscription revenue metrics in portal" | This is an admin/ops concern, not a user feature. RevenueCat Dashboard already provides this. Building it in the portal exposes sensitive business data to users. | Use RevenueCat Dashboard for subscription analytics. Defer admin dashboard to a future milestone. |

---

## Feature Dependencies

```
[RevenueCat Webhook Edge Function]
    |-- requires --> [Webhook Authorization]
    |-- requires --> [REST API Verification Call]
    |-- requires --> [Product-to-Tier Mapping]
    |-- requires --> [Entitlement-to-Tier Mapping]
    |-- writes to --> [user_subscriptions table]

[user_subscription_tier() SQL Update]
    |-- requires --> [user_subscriptions table un-deprecation + tier column]
    |-- blocks  --> [RLS Policy Correctness] (comments INSERT, goal limit trigger)

[useSubscription Hook Rewrite]
    |-- requires --> [user_subscriptions table schema finalized]
    |-- requires --> [Product/Entitlement-to-Tier Mapping]
    |-- blocks  --> [PricingPlans Rewrite] (needs hook to show current tier)
    |-- blocks  --> [Profile Subscription Management] (needs hook for status display)
    |-- blocks  --> [UpgradePrompt Update] (needs hook for current tier)
    |-- stable-interface --> [SubscriptionGate] (NO changes if hook interface stays same)
    |-- stable-interface --> [TierBadge] (NO changes if hook interface stays same)

[Realtime Listener Update]
    |-- requires --> [user_subscriptions table un-deprecation]

[Remove Stripe Client Library]
    |-- requires --> [PricingPlans Rewrite] (last consumer of redirectToCheckout)
    |-- requires --> [Profile Subscription Management] (last consumer of openCustomerPortal)

[Delete Stripe Edge Functions]
    |-- requires --> [RevenueCat Webhook Edge Function deployed and verified]

[Grace Period Handling]
    |-- enhances --> [useSubscription Hook] (new hasBillingIssue flag)
    |-- enhances --> [Subscription Status Banner]

[Smart App Store Redirect]
    |-- enhances --> [PricingPlans Rewrite]
    |-- enhances --> [UpgradePrompt Update]

[Subscription Sync Health Check]
    |-- requires --> [RevenueCat REST API verification infrastructure]
    |-- enhances --> [useSubscription Hook] (background validation)

[Migration Transition Banner]
    |-- requires --> [Both subscription tables readable]
    |-- temporary --> [Remove after cutover window closes]
```

### Dependency Notes

- **`user_subscription_tier()` is the critical path**: This SECURITY DEFINER function is called by RLS policies for comments (PHOENIX+ INSERT) and goals (limit enforcement trigger). If it queries the wrong table or the table schema doesn't match, all tier-gated database operations fail silently. The SQL migration must update this function atomically within a transaction.
- **`useSubscription` interface stability is the highest-leverage design decision**: 15+ components consume `useSubscription()` and depend on the `SubscriptionData` return type (`tier`, `status`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `isLoading`, `isPremium`, `isElite`). If this interface stays identical, `SubscriptionGate`, `TierBadge`, and all ~10 gated pages (`Analytics`, `Biomechanics`, `Recovery`, `Integrations`, `SessionReplay`, `ComparisonView`, `CommentThread`, `Goals`, etc.) need ZERO changes.
- **Stripe removal must be the final step**: Do not delete `src/lib/stripe.ts` or Edge Functions until every consumer is updated and verified. Dependency chain: update consumers -> verify builds -> delete infrastructure.
- **Mobile app `logIn(supabaseUserId)` is a hard prerequisite**: If the mobile app doesn't call `Purchases.logIn()` with the Supabase user ID, webhook payloads will contain `$RCAnonymousID` instead of the user's UUID, and the webhook handler cannot map events to users. This must be coordinated with the mobile team.
- **Smart App Store Redirect and QR code enhance but don't block**: The migration works with a simple "Subscribe in the Phoenix App" text. Platform-specific redirects are polish.

---

## MVP Definition

### Ship Together (Atomic Migration Release)

All of these must deploy in a single coordinated release. Partial deployment = broken billing.

- [ ] RevenueCat webhook Edge Function with authorization + REST API verification
- [ ] Un-deprecate `user_subscriptions` table, ensure `tier` column exists (or derive in hook)
- [ ] Update `user_subscription_tier()` SQL function to query `user_subscriptions`
- [ ] Rewrite `useSubscription` hook to read from `user_subscriptions` (same return interface)
- [ ] Update Realtime listener to watch `user_subscriptions` table
- [ ] Rewrite PricingPlans to "subscribe in app" pattern (remove all checkout logic)
- [ ] Update UpgradePrompt CTA text to "Subscribe in the Phoenix App"
- [ ] Update Profile page -- remove Stripe portal button, show subscription status
- [ ] Add product-to-tier and entitlement-to-tier mapping in `src/lib/pricing.ts`
- [ ] Remove `src/lib/stripe.ts` and uninstall `@stripe/stripe-js`
- [ ] Delete 3 Stripe Edge Functions
- [ ] Remove Stripe environment variables, add RevenueCat env vars
- [ ] Replace Stripe webhook tests with RevenueCat webhook tests

### Add After Verification (v1.3.1)

Ship within 1-2 weeks once core migration is confirmed working in production.

- [ ] Grace period / billing issue UI banner (trigger: first real BILLING_ISSUE event)
- [ ] Subscription status banner with contextual messaging
- [ ] Smart app store redirect with iOS/Android/desktop detection
- [ ] Manage Subscription deep link to mobile app

### Future Consideration (v1.3.x or later)

- [ ] QR code for desktop-to-mobile subscribe flow
- [ ] Subscription sync health check (background Edge Function verification)
- [ ] Offline-resilient entitlement cache in localStorage
- [ ] Migration transition banner (only during cutover window, then remove)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Risk |
|---------|------------|---------------------|----------|------|
| Webhook Edge Function | HIGH | MEDIUM | P1 | Core data pipeline. No subscription data flows without this. |
| Webhook authorization | HIGH | LOW | P1 | Security. Without this, anyone can POST fake subscription events. |
| REST API verification | MEDIUM | MEDIUM | P1 | Data integrity. Prevents acting on stale/incorrect webhook data. |
| `user_subscription_tier()` update | HIGH | HIGH (risk) | P1 | RLS policies break if this queries wrong table. Highest-risk change. |
| `useSubscription` rewrite | HIGH | MEDIUM | P1 | Every gated feature depends on this. Interface must stay stable. |
| PricingPlans rewrite | HIGH | MEDIUM | P1 | Old checkout buttons will error after Stripe removal. |
| UpgradePrompt update | HIGH | LOW | P1 | Broken CTA = confused users hitting dead checkout. |
| Profile management update | MEDIUM | LOW | P1 | `openCustomerPortal()` will error after Stripe removal. |
| Product/entitlement mapping | HIGH | LOW | P1 | Required by webhook handler and useSubscription. |
| Realtime listener update | MEDIUM | LOW | P1 | Without this, UI doesn't reflect subscription changes. |
| Stripe removal | MEDIUM | LOW | P1 | Dead code. But must be last step after all consumers updated. |
| Webhook tests | MEDIUM | MEDIUM | P1 | Regression safety for the most critical business logic. |
| Grace period handling | MEDIUM | MEDIUM | P2 | Users keep access by default. Banner is UX improvement. |
| Status banner | MEDIUM | MEDIUM | P2 | Better UX for degraded subscription states. |
| Smart app store redirect | MEDIUM | MEDIUM | P2 | Convenience. Plain text link works as fallback. |
| Deep link to mobile | LOW | LOW | P2 | Requires mobile app support for URL scheme. |
| QR code | LOW | LOW | P3 | Nice touch for desktop users. Not critical. |
| Sync health check | LOW | HIGH | P3 | Insurance against missed webhooks. Overkill for launch. |
| Entitlement cache | LOW | LOW | P3 | TanStack Query cache already handles most cases. |

**Priority key:**
- P1: Must ship in the migration release. Incomplete = broken product.
- P2: Should ship within 1-2 weeks post-migration. Improves reliability and UX.
- P3: Nice to have. Ship when convenient.

---

## Existing Code Impact Analysis

### Files That Change (8 files)

| File | Change Type | Complexity | Risk |
|------|------------|------------|------|
| `src/hooks/useSubscription.ts` | Rewrite query target + field mapping. Keep `SubscriptionData` interface identical. | MEDIUM | HIGH -- 15+ consumers depend on stable interface |
| `src/lib/pricing.ts` | Add `PRODUCT_TO_TIER` and `ENTITLEMENT_TO_TIER` mappings alongside existing `TIER_PRICING` | LOW | LOW -- purely additive |
| `src/app/components/PricingPlans.tsx` | Major rewrite. Remove checkout logic, add "subscribe in app" CTAs. Keep tier cards + feature lists. | MEDIUM | MEDIUM -- UI-only, no data flow risk |
| `src/app/components/UpgradePrompt.tsx` | Change CTA button text from "View Plans" to "Subscribe in the Phoenix App" + optional app store link | LOW | LOW -- cosmetic |
| `src/app/components/Profile.tsx` | Remove `openCustomerPortal` import + button. Add subscription status display with "Manage in App" text. | LOW | LOW -- removes one import, changes one button |
| `src/lib/export/data-export.ts` | May need to read from `user_subscriptions` instead of `subscriptions` for GDPR export | LOW | LOW -- if GDPR export hasn't shipped yet, no change needed |
| `.env.example` | Remove `VITE_STRIPE_*` vars, add `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY` | LOW | LOW |
| `package.json` | Remove `@stripe/stripe-js` dependency | LOW | LOW |

### Files Created (3 files)

| File | Purpose | Complexity |
|------|---------|------------|
| `supabase/functions/revenuecat-webhooks/index.ts` | New Edge Function handling RevenueCat webhook events | MEDIUM |
| `supabase/migrations/YYYYMMDD_revenuecat_migration.sql` | Update `user_subscription_tier()`, un-deprecate `user_subscriptions`, add `tier` column if needed, deprecate old `subscriptions` table | HIGH (risk) |
| `src/lib/__tests__/revenuecat-webhook-handlers.test.ts` | Tests for new webhook handler covering all event types | MEDIUM |

### Files Deleted (7 files)

| File | Lines | Reason |
|------|-------|--------|
| `src/lib/stripe.ts` | 45 | No more Stripe client needed |
| `src/lib/__tests__/stripe-webhook-handlers.test.ts` | ~100 | Replaced by RevenueCat tests |
| `supabase/functions/stripe-checkout/index.ts` | 89 | No more web checkout |
| `supabase/functions/stripe-portal/index.ts` | 72 | No more Stripe portal |
| `supabase/functions/stripe-webhooks/index.ts` | 203 | Replaced by `revenuecat-webhooks` |
| `dist/assets/stripe-CuNEbjmv.js` | (build) | Build artifact of removed Stripe JS |
| `dist/assets/stripe-CuNEbjmv.js.map` | (build) | Build artifact |

### Files That Do NOT Change (critical stability points)

| File | Why Stable |
|------|-----------|
| `src/app/components/SubscriptionGate.tsx` | Consumes `useSubscription()` -- interface stays identical |
| `src/app/components/TierBadge.tsx` | Consumes `useSubscription()` -- interface stays identical |
| All ~10 components using `SubscriptionGate` | Gate component is the abstraction layer; they never touch subscription data directly |
| `src/queries/keys.ts` | `subscription.byUser()` key shape unchanged |
| `src/stores/` (all Zustand stores) | No subscription state in Zustand stores |
| `src/providers/AuthProvider.tsx` | Auth is separate from billing |
| `src/app/components/LandingPage.tsx` | References pricing but doesn't import Stripe |
| `src/app/components/FAQ.tsx` | May need text updates but no code changes |

---

## Competitor Feature Analysis

| Pattern | Peloton | Strava | Whoop | Phoenix Portal (target) |
|---------|---------|--------|-------|------------------------|
| Billing origin | Web + mobile (both allowed) | Web + mobile (both allowed) | Mobile-first (app only) | Mobile-only (via RevenueCat) |
| Web subscribe button | Yes (own checkout) | Yes (Stripe) | No -- "Get Whoop" links to app store | No -- "Subscribe in Phoenix App" |
| Web manage subscription | Yes (account settings page) | Yes (settings with Stripe portal) | No -- "Manage in Whoop app" | No -- "Manage in Phoenix App" |
| Subscription status on web | Shows tier + next billing date | Shows "Premium" badge in nav | Shows membership tier | Shows TierBadge + expiry + status |
| Upgrade CTA on web | "Upgrade" button -> web checkout | "Go Premium" -> web checkout | "Subscribe in Whoop app" | "Subscribe in Phoenix App" -> app store link |
| Billing issue handling | Maintains access + email notification | Maintains access, degrades features after expiry | Maintains access during grace period | Maintain access + billing issue banner (P2) |

**Phoenix Portal's pattern most closely matches Whoop's model**: mobile-first billing where the web dashboard is a read-only consumer of subscription status. This is the correct architecture for a companion dashboard whose primary user experience is the mobile app.

---

## Sources

- [RevenueCat Webhooks Documentation](https://www.revenuecat.com/docs/integrations/webhooks) -- HIGH confidence
- [RevenueCat Webhook Event Types and Fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields) -- HIGH confidence
- [RevenueCat Entitlements](https://www.revenuecat.com/docs/getting-started/entitlements) -- HIGH confidence
- [RevenueCat Getting Customer Info / Subscription Status](https://www.revenuecat.com/docs/customers/customer-info) -- HIGH confidence
- [RevenueCat Billing Issues and Grace Periods](https://www.revenuecat.com/docs/subscription-guidance/how-grace-periods-work) -- HIGH confidence
- [RevenueCat Web Billing Overview](https://www.revenuecat.com/docs/web/web-billing/overview) -- HIGH confidence (evaluated and rejected as anti-feature)
- [RevenueCat REST API v1](https://www.revenuecat.com/docs/api-v1) -- MEDIUM confidence (page rendering issues during fetch)
- [RevenueCat Community: Webhook Security](https://community.revenuecat.com/general-questions-7/how-to-secure-revenuecat-webhooks-with-an-api-key-5705) -- MEDIUM confidence
- [RevenueCat Community: Authorization Header Validation](https://community.revenuecat.com/third-party-integrations-53/is-the-authorization-header-enough-for-validating-webhook-s-claims-5886) -- MEDIUM confidence
- [RevenueCat Community: Supabase User ID Mapping](https://community.revenuecat.com/general-questions-7/setting-up-revenuecat-with-and-without-authenticated-users-3513) -- MEDIUM confidence
- [RevenueCat Community: Supabase Webhook Handler](https://community.revenuecat.com/third-party-integrations-53/error-extracting-app-user-id-from-webhook-in-supabase-400-user-id-not-found-6557) -- MEDIUM confidence
- Codebase audit: direct file reads of `src/hooks/useSubscription.ts`, `src/lib/stripe.ts`, `src/app/components/PricingPlans.tsx`, `src/app/components/UpgradePrompt.tsx`, `src/app/components/SubscriptionGate.tsx`, `src/app/components/Profile.tsx`, `src/app/components/TierBadge.tsx`, `supabase/functions/stripe-*/`, `supabase/migrations/00001_create_subscriptions.sql`, `supabase/migrations/20260228_rls_denormalization.sql`, `src/lib/database.types.ts`, `src/lib/pricing.ts` -- HIGH confidence

---
*Feature research for: RevenueCat billing migration in Phoenix Portal (v1.3)*
*Researched: 2026-02-28*
