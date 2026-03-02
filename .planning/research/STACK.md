# Stack Research

**Domain:** Premium fitness analytics dashboard — visual overhaul (v1.2 milestone)
**Researched:** 2026-02-20
**Confidence:** MEDIUM-HIGH (CSS techniques HIGH from MDN/official docs; library versions MEDIUM from npm/GitHub; design patterns MEDIUM from multiple web sources)

---

## Context: What Already Exists (Do NOT Re-Research)

The app already ships on a validated, optimized stack:
- React 19, Vite 7, TypeScript strict, Biome 2.4
- Tailwind CSS v4 with @tailwindcss/vite
- shadcn/ui (50+ components including Sidebar, Collapsible)
- Recharts 3 (trend charts), visx (force curves)
- Framer Motion (`motion` package) for celebrations and page transitions
- Supabase, Stripe, Sentry v10, TanStack Query, Zustand, React Router v7
- **Production bundle: 95.69KB main entry chunk (34.46KB gzip). This is the hard constraint.**

This research answers ONLY: what to add or do differently for the v1.2 visual overhaul.

---

## Recommended Stack Additions

### New Library: Animated Number Counters

| Library | Version | Bundle (gzip) | Purpose | Why Recommended |
|---------|---------|---------------|---------|-----------------|
| `@number-flow/react` | 0.5.12 | ~6–7KB | Animated stat counters (streak, reps, PRs, scores) | Dependency-free, MIT license, uses CSS custom properties so it respects the Phoenix design tokens; Safari alignment fix shipped Feb 2026; no premium paywall unlike Motion's AnimateNumber |

**Install:**
```bash
npm install @number-flow/react
```

**Usage pattern for dark theme:**
```tsx
import NumberFlow from '@number-flow/react'

// Drop-in replacement for static numbers in stat cards
<NumberFlow value={streak} format={{ style: 'decimal' }} />
```

**Styling:** Uses `::part(suffix)` and CSS custom properties (`--number-flow-char-height`). Works with the existing Tailwind v4 CSS variable token system without friction.

**Why not Motion's AnimateNumber:** Requires Motion+ paid membership (one-time, but adds procurement friction). `@number-flow/react` is fully free, slightly smaller, and has shadcn community adoption.

**Why not react-countup:** No built-in formatting, no digit-slot animation (counts sequentially, not slot-machine style). NumberFlow animates individual digit slots independently, which reads as more premium.

---

### No Other New Libraries Required

The visual overhaul is achievable entirely through CSS techniques and existing Framer Motion capabilities. Adding libraries beyond `@number-flow/react` would bloat the bundle and duplicate functionality already present.

---

## CSS Techniques (Zero Bundle Cost)

These are pure CSS patterns implemented via Tailwind v4 utilities and/or custom CSS in `src/styles/theme.css`. No new dependencies.

### 1. Glassmorphism — Card Surface Hierarchy

**Confidence:** HIGH (verified via Tailwind CSS official docs + MDN)

Tailwind v4 ships `backdrop-blur-*` utilities natively. The glassmorphism pattern for dark backgrounds uses:

```css
/* In theme.css or as Tailwind utilities */
.glass-card {
  /* Semi-transparent dark tint so text stays legible */
  background: rgba(13, 13, 13, 0.6);       /* Phoenix #0D0D0D at 60% */
  backdrop-filter: blur(12px);              /* backdrop-blur-[12px] */
  -webkit-backdrop-filter: blur(12px);      /* Safari prefix required */
  border: 1px solid rgba(255, 107, 53, 0.12); /* Ember at 12% opacity */
  box-shadow: 0 4px 24px rgba(255, 107, 53, 0.08); /* brand-tinted shadow */
}
```

**Tailwind v4 class equivalent:**
```html
<div class="bg-black/60 backdrop-blur-[12px] border border-[#FF6B35]/12 shadow-[0_4px_24px_rgba(255,107,53,0.08)] rounded-2xl">
```

**Critical caveat:** Text legibility fails on pure blur without the semi-transparent tint. The `bg-black/60` is non-negotiable for readability — do not remove it to "make it more glassy."

**Elevation hierarchy for Phoenix Portal:**
- Base surface: `bg-[#0D0D0D]` (page background)
- Card level 1: `bg-white/[0.03]` (subtle lift, no blur needed)
- Card level 2: `bg-black/60 backdrop-blur-[12px]` (glass, for modal/highlight cards)
- Overlay: `bg-black/80 backdrop-blur-[20px]` (sidebars, drawers)

### 2. Noise/Grain Texture — Premium Surface Feel

**Confidence:** HIGH (SVG feTurbulence is a CSS standard, widely supported)

A grainy overlay eliminates the "flat plastic" look of pure gradients. Implementation is a single inline SVG data URI applied as `background-image`:

```css
/* In theme.css — add to card or global body */
.surface-grain::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0.035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-size: 128px 128px;
}
```

**Performance note:** SVG feTurbulence is CPU-rendered (not GPU). Use `opacity: 0.03–0.05` only — higher values trigger repaints on scroll. Apply to static elements (card backgrounds), NOT to animated or scrolling containers.

**Alternative for near-zero CPU cost:** Use a pre-generated PNG noise tile (256×256px, <4KB) as `background-image`. Generate at [fffuel.co/nnnoise](https://www.fffuel.co/nnnoise/). This avoids SVG filter re-rendering on every paint.

**Recommendation:** Use the PNG tile approach, not the inline SVG filter. Apply only to card backgrounds via `::after` pseudo-element.

### 3. Ambient Background Gradients — Depth Without Borders

**Confidence:** HIGH (native CSS radial-gradient, no library needed)

Large, low-opacity radial gradients at page-level create the "ember glow from below" effect seen in Whoop/premium fitness apps:

```css
/* In theme.css — on the root layout container */
.page-ambient {
  background-image:
    radial-gradient(ellipse 80% 50% at 20% 0%, rgba(255, 107, 53, 0.07) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 100%, rgba(220, 38, 38, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse 50% 60% at 50% 50%, rgba(245, 158, 11, 0.03) 0%, transparent 70%);
}
```

**Tailwind v4 approach:** Define in `@theme` block as CSS custom properties, or use arbitrary values:
```html
<div class="bg-[radial-gradient(ellipse_80%_50%_at_20%_0%,rgba(255,107,53,0.07)_0%,transparent_60%)]">
```

**Note:** This goes on the fixed background container, NOT individual cards — it's a single layer behind all content.

### 4. Scroll-Driven Animations — Section Reveal on Scroll

**Confidence:** MEDIUM (CSS scroll-driven animations officially available in Chrome/Edge; Firefox and Safari still catching up as of Feb 2026)

**Browser support as of Feb 2026:** Chromium-based browsers (Chrome 115+, Edge 115+) = ~70% of users. Safari 26 beta adds support. Firefox: not yet. For a fitness dashboard, the audience skews tech-savvy — higher Chrome penetration expected.

**Recommendation: Use Framer Motion's `whileInView` + `useScroll` instead of native CSS scroll-driven animations.**

Reason: Framer Motion is already in the bundle. Its `whileInView` approach works across ALL browsers and provides richer spring physics. Native CSS scroll-driven animations require a progressive enhancement strategy (JS fallback) that doubles the implementation effort for no visual gain.

```tsx
// Framer Motion whileInView pattern — use this, not CSS scroll-timeline
import { motion } from 'motion/react'

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } }
}

<motion.div
  variants={cardVariants}
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, amount: 0.2 }}
>
```

**For scroll-progress indicators only** (e.g., reading progress bar): CSS `animation-timeline: scroll()` with a Chromium-only `@supports` guard is acceptable:

```css
@supports (animation-timeline: scroll()) {
  .scroll-progress {
    animation: progress linear;
    animation-timeline: scroll();
  }
}
```

### 5. Spring Physics — Hover and Interaction States

**Confidence:** HIGH (Framer Motion official docs verified)

Framer Motion's spring transitions are the right tool. Already in the bundle. No addition needed.

**Pattern for card hover lifts (the most common premium dashboard interaction):**

```tsx
<motion.div
  whileHover={{
    y: -4,
    boxShadow: '0 20px 40px rgba(255, 107, 53, 0.15)',
  }}
  transition={{
    type: 'spring',
    stiffness: 400,
    damping: 25,
  }}
>
```

**Pattern for stagger on list/card grids (enter viewport):**

```tsx
const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
}
const item = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 350, damping: 28 } }
}

<motion.ul variants={container} initial="hidden" whileInView="visible" viewport={{ once: true }}>
  {items.map(i => <motion.li key={i.id} variants={item} />)}
</motion.ul>
```

### 6. Page Transitions — Framer Motion AnimatePresence

**Confidence:** HIGH (already used in the app for celebration animations; same pattern extends to page routing)

```tsx
// Wrap React Router outlet in AnimatePresence + motion.div
<AnimatePresence mode="wait">
  <motion.div
    key={location.pathname}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
  >
    <Outlet />
  </motion.div>
</AnimatePresence>
```

---

## Existing Library Usage — Enhanced Patterns (No New Dependencies)

### Recharts — Premium Chart Styling

**Confidence:** MEDIUM (Recharts official docs + multiple community sources)

No new library needed. Recharts has full custom tooltip and axis support.

**Custom tooltip pattern:**
```tsx
const PhoenixTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-black/80 backdrop-blur-[8px] border border-[#FF6B35]/20 rounded-xl px-4 py-3 shadow-lg">
      <p className="text-xs text-white/50 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.value} {p.name}
        </p>
      ))}
    </div>
  )
}
<Tooltip content={<PhoenixTooltip />} cursor={{ stroke: '#FF6B35', strokeWidth: 1, strokeDasharray: '4 2' }} />
```

**Styled axes:**
```tsx
<XAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
<YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
```

**Chart entrance animation:** Recharts has built-in `isAnimationActive` on all series components — it's enabled by default. Control duration: `animationDuration={800}`. Set `animationEasing="ease-out"`.

### shadcn/ui Sidebar — Collapsible Navigation

**Confidence:** HIGH (verified via official shadcn/ui docs)

The `Sidebar` component is already in the shadcn/ui registry (installed via `npx shadcn@latest add sidebar`). It supports three collapse modes:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `"icon"` | Collapses to icon-only rail (48px wide) | Desktop: collapsed state showing nav icons |
| `"offcanvas"` | Slides fully off-screen | Mobile drawer pattern |
| `"none"` | Always visible, never collapses | Locked sidebars |

**For Phoenix Portal's collapsible sidebar (replacing the 13-item horizontal nav):**
- Use `collapsible="icon"` for desktop (icon rail on collapse)
- Use `collapsible="offcanvas"` for mobile
- `useSidebar()` hook exposes `state`, `open`, `toggleSidebar()` for controlled behavior
- `SidebarRail` provides the drag-to-resize handle
- State persists via cookie/localStorage out of the box

```bash
npx shadcn@latest add sidebar
```

**Bundle impact:** shadcn/ui components are copied into the project (no runtime package). The Sidebar adds ~3KB to the compiled output, well within budget.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| GSAP | 60KB gzip — triple the app's main bundle. Cannot justify for a polish milestone | Framer Motion (already installed) |
| react-spring | 45KB gzip, overlaps completely with Framer Motion's spring system. Two spring libraries = confusion + bloat | `motion` package (already installed) |
| Lottie / react-lottie | JSON animation files are heavy; the app already has celebration animations via Framer Motion + Canvas | Keep existing pattern |
| three.js / @react-three/fiber | 3D is not needed; ambient gradients achieve depth at ~0KB | CSS radial-gradient |
| CSS scroll-driven animations (as primary approach) | Firefox has no support; Safari only in 26 beta (~5% installed base). Requires JS fallback anyway | Framer Motion `whileInView` |
| tailwindcss-animated plugin | v4-incompatible as of research date; Tailwind v4 uses `@theme` for custom keyframes directly | Define keyframes in `theme.css` via `@keyframes` in `@theme` block |
| react-countup | Counts linearly (0→100), not slot-machine style. Reads as cheap rather than premium | `@number-flow/react` |
| Motion's AnimateNumber | Requires paid Motion+ membership | `@number-flow/react` |

---

## Tailwind v4 Specific Patterns

**Confidence:** HIGH (Tailwind v4 official docs verified)

### Custom Keyframes in v4

In Tailwind v4, all custom animations are defined in CSS (not `tailwind.config.js`):

```css
/* src/styles/theme.css */
@theme {
  --animate-ember-pulse: ember-pulse 2s ease-in-out infinite;
  --animate-stat-enter: stat-enter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;

  @keyframes ember-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(255, 107, 53, 0.3); }
    50% { box-shadow: 0 0 24px rgba(255, 107, 53, 0.6); }
  }

  @keyframes stat-enter {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
}
```

Then use: `<div class="animate-stat-enter">` or arbitrary: `<div class="animate-[ember-pulse_2s_ease-in-out_infinite]">`.

### CSS Variable Token Integration

The existing dual-token pattern (CSS vars + hex constants for SVG/motion) remains correct. For glassmorphism, reference the existing Phoenix palette tokens:

```css
/* Already defined in theme.css — reference these, don't hardcode */
var(--color-primary)    /* #FF6B35 ember */
var(--color-flame)      /* #DC2626 */
var(--color-gold)       /* #F59E0B */
var(--color-forge)      /* #10B981 */
```

---

## Bundle Impact Assessment

| Addition | Gzip Cost | Cumulative Total | Verdict |
|----------|-----------|-----------------|---------|
| Baseline (95.69KB / 34.46KB gzip) | — | 34.46KB | — |
| `@number-flow/react` | ~6.8KB | 41.26KB | Acceptable |
| shadcn Sidebar component | ~3KB (project-local copy) | 44.26KB | Acceptable |
| CSS techniques (all) | 0KB (pure CSS) | 44.26KB | Free |
| Framer Motion `whileInView` / spring patterns | 0KB (already bundled) | 44.26KB | Free |
| Recharts custom tooltips | 0KB (already bundled) | 44.26KB | Free |

**Estimated final gzip after overhaul: ~41–45KB.** Well within budget. The original 500KB target set in v1.0 planning leaves ample headroom.

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `@number-flow/react` | 0.5.12 | React 19, Tailwind v4 | Dependency-free; CSS custom properties only; Feb 2026 Safari fix included |
| shadcn Sidebar | latest (via CLI) | React 19, Tailwind v4, Radix | Copied into project, no package version lock |
| Framer Motion (`motion`) | current in project | React 19 | Already installed; `whileInView`, `stagger`, `AnimatePresence`, `useScroll` all available |
| Recharts 3 | current in project | React 19 | `isAnimationActive`, `animationDuration`, custom `content` prop on Tooltip — all available |

---

## Installation Summary

```bash
# Only one new package needed for the entire visual overhaul
npm install @number-flow/react

# shadcn Sidebar (copies into src/app/components/ui/ — not a package dep)
npx shadcn@latest add sidebar
```

All other improvements are achieved through:
1. CSS patterns added to `src/styles/theme.css`
2. Enhanced usage of already-installed Framer Motion
3. Custom tooltip/axis components in Recharts (no new package)

---

## Sources

- [Tailwind CSS backdrop-blur docs](https://tailwindcss.com/docs/backdrop-filter-blur) — glassmorphism utilities, arbitrary value support (HIGH confidence)
- [MDN CSS scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations) — browser support status (HIGH confidence)
- [Scroll-driven animations and Tailwind - Gabor Juhasz](https://juhg.hu/scroll-driven-animations) — Tailwind v4 arbitrary value approach, Chromium-only caveat (MEDIUM confidence)
- [number-flow GitHub releases](https://github.com/barvian/number-flow/releases) — v0.5.12, Feb 2026 Safari fix (HIGH confidence)
- [number-flow npm](https://www.npmjs.com/package/@number-flow/react) — latest version 0.5.12 (HIGH confidence)
- [shadcn/ui Sidebar docs](https://ui.shadcn.com/docs/components/sidebar) — collapsible modes, useSidebar hook (HIGH confidence)
- [Motion docs - React scroll animations](https://motion.dev/docs/react-scroll-animations) — useScroll, whileInView, useSpring hooks (HIGH confidence)
- [Motion docs - reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size) — LazyMotion, ~4.6KB minimum (HIGH confidence)
- [CSS Tricks - Grainy Gradients](https://css-tricks.com/grainy-gradients/) — SVG feTurbulence noise texture technique (HIGH confidence)
- [fffuel.co noise generator](https://www.fffuel.co/nnnoise/) — PNG noise tile alternative (MEDIUM confidence)
- [Motion changelog](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md) — v12 features including scroll-linked timelines (MEDIUM confidence)
- [LogRocket - best React animation libraries 2026](https://blog.logrocket.com/best-react-animation-libraries/) — bundle size benchmarks: Motion ~85KB uncompressed, React Spring ~45KB (MEDIUM confidence, single source)

---

*Stack research for: Phoenix Portal v1.2 Premium Visual Overhaul*
*Researched: 2026-02-20*


---

# === v1.3 Research (from main) ===

# Technology Stack: RevenueCat Billing Migration

**Project:** Phoenix Portal v1.3
**Researched:** 2026-02-28
**Focus:** Stack additions/changes for replacing Stripe with RevenueCat

## Context

The portal currently uses Stripe for subscription billing via 3 Edge Functions
(`stripe-checkout`, `stripe-portal`, `stripe-webhooks`), a `subscriptions` table
with Stripe-specific columns, the `@stripe/stripe-js` client SDK (v8.7.0), and
6 Stripe-related environment variables on the client side plus 6 more on the
Edge Function side.

The mobile app already uses RevenueCat and has a `user_subscriptions` table in
the same Supabase database with RevenueCat fields (`revenuecat_customer_id`,
`product_id`, `subscription_status`, `expires_at`, `last_verified_at`). This
table is currently marked as `DEPRECATED` in the database (see migration
`20260228_rls_denormalization.sql`), but it is the canonical subscription data
source for RevenueCat.

The migration goal: the portal becomes a **consumer** of subscription status
managed by the mobile app via RevenueCat, not a billing initiator. No web
checkout -- users subscribe in the mobile app only.

---

## Recommended Stack

### Core: What to ADD

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| *Nothing on the client side* | -- | -- | Portal does not initiate purchases; it only reads subscription status from Supabase |

**Zero new npm packages.** This is the key finding. Since the portal is
becoming a read-only consumer of subscription status (no web checkout), the
`@revenuecat/purchases-js` SDK (v1.26.2 as of today) is NOT needed. That SDK
exists for web billing -- it embeds Stripe Elements to initiate purchases on
the web. Phoenix Portal will instead:

1. Receive RevenueCat webhooks via a new Supabase Edge Function
2. Write subscription status to the existing `user_subscriptions` table
3. Read it via the existing `useSubscription` hook (modified to query the new table)

### What to REMOVE

| Technology | Current Version | Component | Why Remove |
|------------|----------------|-----------|------------|
| `@stripe/stripe-js` | ^8.7.0 | npm package | No web checkout; subscriptions managed in mobile app |
| `src/lib/stripe.ts` | -- | Client module (`redirectToCheckout`, `openCustomerPortal`) | No Stripe checkout/portal flows |
| `supabase/functions/stripe-checkout/` | -- | Edge Function | Replaced by mobile-app-managed subscriptions |
| `supabase/functions/stripe-portal/` | -- | Edge Function | Users manage subscriptions in mobile app |
| `supabase/functions/stripe-webhooks/` | -- | Edge Function | Replaced by `revenuecat-webhooks` Edge Function |
| `src/lib/__tests__/stripe-webhook-handlers.test.ts` | -- | Test file | Tests Stripe webhook logic being removed |
| `VITE_STRIPE_PUBLISHABLE_KEY` | -- | Client env var | No longer needed |
| `VITE_STRIPE_PHOENIX_MONTHLY_PRICE_ID` | -- | Client env var | No longer needed |
| `VITE_STRIPE_PHOENIX_ANNUAL_PRICE_ID` | -- | Client env var | No longer needed |
| `VITE_STRIPE_ELITE_MONTHLY_PRICE_ID` | -- | Client env var | No longer needed |
| `VITE_STRIPE_ELITE_ANNUAL_PRICE_ID` | -- | Client env var | No longer needed |
| `STRIPE_SECRET_KEY` | -- | Edge Function secret | No longer needed |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | -- | Edge Function secret | Replaced by `REVENUECAT_WEBHOOK_AUTH_KEY` |
| `STRIPE_PHOENIX_MONTHLY_PRICE_ID` | -- | Edge Function secret | Replaced by entitlement-based mapping |
| `STRIPE_PHOENIX_ANNUAL_PRICE_ID` | -- | Edge Function secret | Replaced by entitlement-based mapping |
| `STRIPE_ELITE_MONTHLY_PRICE_ID` | -- | Edge Function secret | Replaced by entitlement-based mapping |
| `STRIPE_ELITE_ANNUAL_PRICE_ID` | -- | Edge Function secret | Replaced by entitlement-based mapping |
| `stripe_customer_id` column on `profiles` | -- | Database column | No longer needed |

### What to MODIFY (no new dependencies)

| Component | Change | Rationale |
|-----------|--------|-----------|
| New Edge Function: `revenuecat-webhooks` | Create in Deno (same runtime as existing 13 Edge Functions) | Receives RevenueCat webhook POST, writes to `user_subscriptions` table |
| `user_subscription_tier()` SQL function | Repoint from `subscriptions` table to `user_subscriptions` table | Central RLS function used by comments, goals, and tier gating |
| `subscriptions` table | Drop after migration (replaced by `user_subscriptions`) | Eliminates dual-table confusion flagged in migration 20260228 |
| `user_subscriptions` table | Add `tier`, `entitlement_ids`, `cancel_reason` columns | Portal needs tier for gating; existing columns are insufficient |
| `src/hooks/useSubscription.ts` | Query `user_subscriptions` instead of `subscriptions`; map fields | Same hook interface, different data source |
| `src/lib/pricing.ts` | Keep tier display data; keep features list | Tiers stay the same; checkout UX changes to "subscribe in app" |
| `src/app/components/PricingPlans.tsx` | Replace "Subscribe" buttons with "Subscribe in App" CTAs | No web checkout flow |
| `src/app/components/UpgradePrompt.tsx` | Update CTA messaging to direct to mobile app | Already links to `/pricing`; just update copy |
| `src/app/components/Profile.tsx` | Remove "Manage Subscription" (Stripe portal) button; show subscription info only | Users manage in mobile app |
| `src/queries/keys.ts` | `subscription` key namespace unchanged | Query key structure stays the same |
| `.env.example` | Remove Stripe vars, add comment about server-side-only RevenueCat vars | Document the change |
| CSP `connect-src` in `index.html` | Remove `https://api.stripe.com` | No longer connecting to Stripe |
| CSP `frame-src` in `index.html` | Remove `https://js.stripe.com https://hooks.stripe.com` | No Stripe iframes |

---

## New Edge Function: `revenuecat-webhooks`

### Runtime

Supabase Edge Functions (Deno), consistent with the existing 13 Edge Functions.
No additional infrastructure required.

### Dependencies (Deno imports only)

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";
```

No RevenueCat SDK needed server-side. The webhook is a plain HTTP POST with
a JSON body. Verification is a static authorization header comparison.

### Required Environment Variables

| Variable | Purpose | Where Configured |
|----------|---------|-----------------|
| `REVENUECAT_WEBHOOK_AUTH_KEY` | Static bearer token set in RevenueCat dashboard for webhook auth | Supabase Edge Function secrets + RevenueCat Dashboard > Integrations > Webhooks |
| `REVENUECAT_API_KEY` | Secret API key (`sk_...`) for optional REST API v1 subscriber verification | Supabase Edge Function secrets |
| `SUPABASE_URL` | Supabase project URL | Already configured |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS for webhook writes | Already configured |

### Webhook Verification

**RevenueCat does NOT use HMAC signature verification like Stripe.** It uses a
static authorization header configured in the RevenueCat dashboard. The Edge
Function verifies:

```typescript
const authHeader = req.headers.get("Authorization");
const expectedKey = Deno.env.get("REVENUECAT_WEBHOOK_AUTH_KEY");
if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
  });
}
```

This is simpler than Stripe's `constructEventAsync` pattern but less secure.
For additional verification, follow RevenueCat's recommended "belt and
suspenders" approach: after receiving a webhook, call the REST API v1
`GET /v1/subscribers/{app_user_id}` to confirm the subscription state.

Confidence: HIGH -- verified via official docs and multiple community threads
confirming no `x-revenuecat-signature` header exists.

### Webhook Event Types to Handle

From 17 available RevenueCat event types, the portal needs these 8:

| Event | Action | Replaces Stripe Event |
|-------|--------|-----------------------|
| `INITIAL_PURCHASE` | Upsert `user_subscriptions` with tier + active status | `checkout.session.completed` |
| `RENEWAL` | Update status to active, extend expiration | `invoice.paid` |
| `CANCELLATION` | Set status to canceled, record `cancel_reason` | `customer.subscription.deleted` |
| `UNCANCELLATION` | Restore active status | No Stripe equivalent |
| `EXPIRATION` | Set status to expired | Implicit via Stripe period end |
| `BILLING_ISSUE` | Set status to billing_issue | `invoice.payment_failed` |
| `PRODUCT_CHANGE` | Update tier (e.g., PHOENIX to ELITE upgrade) | `customer.subscription.updated` |
| `SUBSCRIPTION_EXTENDED` | Update expiration date | No Stripe equivalent |

**Events to ignore:** `TEST` (dashboard testing), `NON_RENEWING_PURCHASE` (one-time,
not applicable), `SUBSCRIPTION_PAUSED` (not supported in our tier model),
`TRANSFER` (user account merging), `TEMPORARY_ENTITLEMENT_GRANT` (store
validation issues), `REFUND_REVERSED`, `INVOICE_ISSUANCE` (Web Billing only),
`VIRTUAL_CURRENCY_TRANSACTION`, `EXPERIMENT_ENROLLMENT`.

### Webhook Payload Structure

```json
{
  "api_version": "1.0",
  "event": {
    "type": "RENEWAL",
    "id": "UniqueEventId-for-idempotency",
    "app_id": "app_id",
    "event_timestamp_ms": 1591121855319,
    "app_user_id": "<supabase-auth-user-uuid>",
    "original_app_user_id": "...",
    "aliases": [],
    "product_id": "phoenix_monthly",
    "entitlement_ids": ["phoenix_access"],
    "period_type": "NORMAL",
    "purchased_at_ms": 1591121855319,
    "expiration_at_ms": 1593713855319,
    "store": "APP_STORE",
    "environment": "PRODUCTION",
    "price": 14.99,
    "currency": "USD",
    "cancel_reason": null
  }
}
```

**Critical assumption:** The mobile app uses the Supabase auth user ID (UUID)
as the RevenueCat `appUserId`. This is the standard pattern confirmed by
RevenueCat + Supabase community. The `app_user_id` in the webhook payload maps
directly to `auth.users.id` and `user_subscriptions.user_id`. If the mobile app
uses a different identifier, an additional mapping table would be needed.

### Idempotency

RevenueCat sends an `event.id` field with each webhook. The Edge Function should
track processed event IDs to prevent duplicate processing. Options:

1. **Simple:** Store last-processed event timestamp; skip events older than last
2. **Robust:** Add `processed_webhook_events` table or use upsert semantics
   (the current Stripe handler uses upsert on `user_id`, which is inherently
   idempotent for single-row-per-user)

The upsert approach is sufficient since we have a `UNIQUE(user_id)` constraint.

### Retry Behavior

RevenueCat retries failed webhooks (non-200 response) up to 5 times at
5, 10, 20, 40, and 80-minute intervals. The Edge Function must respond
within 60 seconds. The handler should respond immediately with 200 and
process asynchronously if needed (though for a simple upsert, synchronous
processing is fine).

---

## Entitlement-to-Tier Mapping

RevenueCat uses **entitlements** (what the user unlocks) mapped to **products**
(what they buy). The portal maps entitlements to its existing tier system:

| RevenueCat Entitlement | Portal Tier | Products That Grant It |
|------------------------|-------------|----------------------|
| `elite_access` | ELITE | `elite_monthly`, `elite_annual` |
| `phoenix_access` | PHOENIX | `phoenix_monthly`, `phoenix_annual` |
| *(none active)* | FREE | *(no purchase or expired)* |

The webhook handler derives tier from `entitlement_ids`:

```typescript
function getTierFromEntitlements(entitlementIds: string[]): string {
  if (entitlementIds.includes("elite_access")) return "ELITE";
  if (entitlementIds.includes("phoenix_access")) return "PHOENIX";
  return "FREE";
}
```

This is more robust than the current Stripe approach (mapping price IDs to
tiers via environment variables) because entitlements are RevenueCat's canonical
concept for "what does the user have access to" and are configured once in the
dashboard rather than duplicated in environment variables.

**LOW confidence on entitlement names:** The actual entitlement identifiers
(`phoenix_access`, `elite_access`) depend on what the mobile team configured in
the RevenueCat dashboard. These must be confirmed before implementation.

---

## Database Schema Changes

### Reuse `user_subscriptions` Table

The mobile app already created this table (visible in `database.types.ts`):

```
user_subscriptions:
  id              UUID PRIMARY KEY
  user_id         UUID (references auth.users)
  revenuecat_customer_id  TEXT
  product_id      TEXT
  subscription_status     TEXT
  expires_at      TIMESTAMPTZ
  last_verified_at        TIMESTAMPTZ
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
```

### Required Additions (New Migration)

```sql
-- Migration: Extend user_subscriptions for portal tier gating
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS tier TEXT
    CHECK (tier IN ('FREE', 'PHOENIX', 'ELITE'))
    DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS entitlement_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS store TEXT,
  ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'PRODUCTION';

-- Unique constraint on user_id (portal expects one subscription row per user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_user_id
  ON user_subscriptions(user_id);

-- RLS: users can read their own subscription
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own subscription"
  ON user_subscriptions FOR SELECT
  USING ((select auth.uid()) = user_id);

-- Enable Realtime (portal listens for subscription changes)
ALTER PUBLICATION supabase_realtime ADD TABLE user_subscriptions;
```

### Update `user_subscription_tier()` Function

```sql
CREATE OR REPLACE FUNCTION public.user_subscription_tier()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT tier FROM public.user_subscriptions
     WHERE user_id = (select auth.uid())
     AND subscription_status IN ('active', 'trialing')
     AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1),
    'FREE'
  );
$$;
```

This is backward-compatible: all existing RLS policies calling
`user_subscription_tier()` (community_comments INSERT, goals limit check)
continue to work without modification. The function signature and return
type are unchanged.

### Deprecate `subscriptions` Table

```sql
-- Drop the Stripe subscriptions table (after confirming no other consumers)
DROP TABLE IF EXISTS public.subscriptions;
```

The `profiles.stripe_customer_id` column can be dropped in the same migration:

```sql
ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_customer_id;
```

---

## REST API v1 Verification (Optional Enhancement)

For additional reliability, the webhook handler can verify subscription status
by calling RevenueCat's REST API v1 after receiving key events:

```
GET https://api.revenuecat.com/v1/subscribers/{app_user_id}
Authorization: Bearer {REVENUECAT_API_KEY}
```

**When to call:** Only on `INITIAL_PURCHASE` and `CANCELLATION` events (the
highest-impact state transitions). Do not call on every webhook to avoid
hitting the ~1 req/sec rate limit.

**What it returns:** Full subscriber object with active entitlements,
subscription dates, and status. Use this to confirm what the webhook reported.

**Rate limits:** V1 endpoints recommend ~1 request/second. Variable rate
limiting, more generous than v2. Returns 429 on exceeded limits.

The v1 API is explicitly stable: RevenueCat states it "won't be deprecated
for a very long time (if ever), because so many apps rely on it."

---

## What NOT to Add

| Technology | Why Skip |
|------------|----------|
| `@revenuecat/purchases-js` (v1.26.2) | Web Billing SDK. Uses Stripe Elements under the hood to enable web checkout. The portal does NOT initiate purchases. Adding this would be 100% dead code. |
| `@revenuecat/purchases-ui-js` | Paywall UI rendering for web. Same reason -- no web checkout. |
| Any Stripe alternative (Paddle, LemonSqueezy) | RevenueCat IS the billing layer. It wraps App Store, Play Store, and Stripe (for web, if ever needed). |
| `stripe` npm package (server-side) | Never used client-side. Edge Functions used `esm.sh/stripe@14`. Removing all 3 Stripe Edge Functions removes this. |
| Database migration tools (Prisma, Drizzle, etc.) | Supabase migrations via raw SQL are the established pattern (14 migration files). No ORM needed. |
| RevenueCat Node.js/Deno SDK | Does not exist for server-side. RevenueCat provides mobile SDKs + REST API v1/v2. The REST API is a simple HTTP call requiring no SDK. |
| Webhook signature verification library | RevenueCat uses static auth header, not HMAC. No verification library needed. |

---

## Supporting Libraries

No new supporting libraries. The migration uses only:

| Library | Version | Purpose | Already Installed |
|---------|---------|---------|-------------------|
| `@supabase/supabase-js` | ^2.95.3 | Client-side Supabase queries | Yes |
| `@tanstack/react-query` | ^5.x | Query caching for subscription data | Yes |
| `zod` | ^4.x | Schema validation for webhook payloads (Edge Function) | Yes (Deno: use `npm:zod`) |

---

## Installation Changes

### Remove

```bash
npm uninstall @stripe/stripe-js
```

### Add

```bash
# Nothing. Zero new npm dependencies.
```

### Environment Variable Changes

**Remove from `.env.local`:**
```
VITE_STRIPE_PUBLISHABLE_KEY
VITE_STRIPE_PHOENIX_MONTHLY_PRICE_ID
VITE_STRIPE_PHOENIX_ANNUAL_PRICE_ID
VITE_STRIPE_ELITE_MONTHLY_PRICE_ID
VITE_STRIPE_ELITE_ANNUAL_PRICE_ID
```

**Remove from Supabase Edge Function secrets:**
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SIGNING_SECRET
STRIPE_PHOENIX_MONTHLY_PRICE_ID
STRIPE_PHOENIX_ANNUAL_PRICE_ID
STRIPE_ELITE_MONTHLY_PRICE_ID
STRIPE_ELITE_ANNUAL_PRICE_ID
```

**Add to Supabase Edge Function secrets:**
```
REVENUECAT_WEBHOOK_AUTH_KEY    # Static token for webhook authorization header
REVENUECAT_API_KEY             # Secret key (sk_...) for REST API v1 verification
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Subscription data sync | RevenueCat webhooks to Supabase Edge Function | RevenueCat Web SDK (`purchases-js`) polling `getCustomerInfo()` | Web SDK is designed for web billing (checkout), not read-only status. Polling wastes bandwidth and adds latency. Webhooks are push-based and near-realtime (5-60s). |
| Subscription data sync | Webhooks + REST API v1 verification | REST API v1 polling only (no webhooks) | Polling at ~1 req/sec rate limit cannot serve concurrent users. Webhooks are the primary mechanism; REST API is for verification only. |
| Webhook verification | Static auth header | HMAC signature verification | RevenueCat does not support HMAC. The static auth header is the only option. Supplement with REST API v1 verification for critical events. |
| Tier derivation | Entitlement-based (`entitlement_ids`) | Product-based (`product_id` mapping) | Entitlements are RevenueCat's canonical "access" concept. Product IDs can change (pricing experiments); entitlements represent what the user unlocked. |
| Database approach | Extend existing `user_subscriptions` table | Create new table | The mobile app already writes to `user_subscriptions`. Adding columns is simpler than creating a third subscription table. |
| CSP changes | Remove Stripe domains from CSP | Keep Stripe domains | Dead directives in CSP are harmless but confusing. Clean removal prevents future debugging confusion. |

---

## RevenueCat Plan Requirements

Webhooks require RevenueCat's **Pro plan**. Pricing:
- Free under $2,500 monthly tracked revenue (MTR)
- 1% of MTR above $2,500/month

For a fitness app with $14.99-$24.99/month subscriptions, this is likely free
until ~167 subscribers (167 x $14.99 = $2,503 MTR). This aligns well with
the community's expected early growth trajectory.

The Pro plan also includes Charts, Experiments, custom customer lists, and
scheduled data exports -- useful for future analytics.

---

## Confidence Assessment

| Finding | Confidence | Source |
|---------|------------|--------|
| No client SDK needed (read-only portal) | HIGH | RevenueCat docs confirm purchases-js is for web billing |
| Webhook auth is static header, not HMAC | HIGH | Official docs + community threads |
| REST API v1 is stable and long-lived | HIGH | RevenueCat explicitly says "won't be deprecated" |
| Webhook event types and payload structure | HIGH | Official docs at revenuecat.com/docs/integrations/webhooks/event-types-and-fields |
| `user_subscriptions` table exists in DB | HIGH | Verified in database.types.ts |
| Supabase user ID as RevenueCat app_user_id | MEDIUM | Standard pattern per community; requires mobile app confirmation |
| Entitlement names (phoenix_access, elite_access) | LOW | Assumed; actual names depend on RevenueCat dashboard config |
| Webhook retry schedule (5 attempts) | HIGH | Official docs |
| Pro plan pricing ($0 under $2.5k MTR) | MEDIUM | Pricing page; may change |

---

## Sources

- [RevenueCat Web SDK docs](https://www.revenuecat.com/docs/getting-started/installation/web-sdk) -- confirms SDK is for web billing
- [RevenueCat Webhooks overview](https://www.revenuecat.com/docs/integrations/webhooks) -- setup, retry, timeout
- [RevenueCat Event Types and Fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields) -- all 17 event types, payload structure
- [RevenueCat REST API v1](https://www.revenuecat.com/docs/api-v1) -- subscriber endpoint, auth format
- [RevenueCat Getting Subscription Status](https://www.revenuecat.com/docs/customers/customer-info) -- CustomerInfo, entitlements
- [RevenueCat Entitlements](https://www.revenuecat.com/docs/getting-started/entitlements) -- entitlement-to-product mapping
- [RevenueCat API Authentication](https://www.revenuecat.com/docs/projects/authentication) -- Bearer token format
- [RevenueCat Pricing](https://www.revenuecat.com/pricing/) -- Pro plan requirements for webhooks
- [RevenueCat webhook security discussion](https://community.revenuecat.com/dashboard-tools-52/is-x-revenuecat-signature-removed-and-where-is-webhook-secret-key-7110) -- no HMAC support
- [RevenueCat webhook auth header discussion](https://community.revenuecat.com/third-party-integrations-53/is-the-authorization-header-enough-for-validating-webhook-s-claims-5886) -- auth header as only verification
- [RevenueCat + Supabase user ID mapping](https://community.revenuecat.com/third-party-integrations-53/error-extracting-app-user-id-from-webhook-in-supabase-400-user-id-not-found-6557) -- app_user_id = Supabase user ID
- [RevenueCat REST API rate limits](https://community.revenuecat.com/general-questions-7/what-are-the-current-rate-limits-on-the-rest-api-4946) -- ~1 req/sec for v1
- [@revenuecat/purchases-js on npm](https://www.npmjs.com/package/@revenuecat/purchases-js) -- v1.26.2 latest
- [RevenueCat tiered entitlements discussion](https://community.revenuecat.com/general-questions-7/confused-about-entitlements-products-and-offerings-for-tiered-feature-sets-4488) -- multi-tier entitlement patterns

---
*Stack research for: v1.3 RevenueCat Billing Migration*
*Researched: 2026-02-28*
*Key finding: Zero new npm packages. Remove @stripe/stripe-js. Replace 3 Stripe Edge Functions with 1 RevenueCat webhook handler. Reuse existing user_subscriptions table.*
