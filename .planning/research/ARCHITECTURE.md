# Architecture Patterns

**Domain:** Launch-readiness hardening for existing React 19 + Supabase production app
**Researched:** 2026-02-27
**Focus:** How security, CI/CD, accessibility, and compliance features integrate with current architecture
**Supersedes:** v1.1 architecture research from 2026-02-16

---

## Current Architecture Snapshot

```
Browser (SPA)
  index.html
    BrowserRouter > AuthProvider > QueryProvider > App > AppRoutes
      26 routes (3 public, 23+ protected via ProtectedRoute)
      15+ lazy-loaded pages via React.lazy/Suspense
      Navigation (13 flat items) / MobileBottomNav
      55 components importing motion/react
      3 Zustand stores (auth, subscription, UI)
      TanStack Query + Zod transform pipeline
      Supabase client (auth, realtime, DB)

Supabase Backend
  Auth (email/password, Google, Apple)
  PostgreSQL with RLS on all tables
  11 Edge Functions (Deno Deploy)
    stripe-checkout, stripe-portal, stripe-webhooks
    strava-oauth, strava-sync, fitbit-oauth, fitbit-sync
    garmin-oauth, garmin-webhook, hevy-sync
    process-sync-queue
  Realtime (broadcast channel for sync)
  _shared/cors.ts: Access-Control-Allow-Origin: *

External
  Stripe (checkout, portal, webhooks)
  Strava / Fitbit / Garmin / Hevy APIs
  Sentry v10 (error monitoring)
  Google Fonts (preconnect)
```

---

## Integration Architecture: New Capabilities

Each v1.2 capability maps to specific integration points in the existing architecture. This section identifies what is NEW vs what MODIFIES existing code, and specifies the data flow for each.

---

### 1. CSP Headers Integration

**Board requirement:** CSO P1 -- Add Content Security Policy headers (currently zero CSP anywhere)

**Architecture decision: Deploy-time headers file, not Vite build-time meta tag.**

Rationale: The app is an SPA deployed as static files. Vite's `html.cspNonce` generates a single nonce at build time which is identical for every request -- useless for security. Per [Vite issue #20531](https://github.com/vitejs/vite/issues/20531), the docs explicitly clarify that `html.cspNonce` is not suitable for static SPA deployments. CSP must come from the hosting layer via HTTP headers.

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `public/_headers` (Netlify) or `vercel.json` | NEW file | CSP header definition |
| `index.html` | NO CHANGE | No inline scripts exist (module src only) |
| Vite config | MODIFY | Set `build.sourcemap: 'hidden'` (uploads to Sentry, not served publicly) |
| Supabase Edge Functions | NO CHANGE | Edge Functions run server-side; CSP is browser-enforced on the SPA |

**CSP policy structure for Phoenix Portal:**

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob:;
  connect-src 'self'
    https://*.supabase.co
    https://*.supabase.in
    https://*.sentry.io
    https://api.stripe.com;
  frame-src https://js.stripe.com https://checkout.stripe.com;
  worker-src 'self';
  manifest-src 'self';
```

**Why `unsafe-inline` for styles:** Tailwind CSS v4 and shadcn/ui inject inline styles via CSSOM. Eliminating `unsafe-inline` for `style-src` would require a nonce-based approach with SSR, which is out of scope for a static SPA. This is an accepted industry tradeoff -- `unsafe-inline` for `style-src` is common in Tailwind SPAs. The critical protection is `script-src 'self'` which blocks XSS script injection.

**Source maps migration:**

Current `vite.config.ts` has `sourcemap: true` (line 82) which deploys `.map` files publicly alongside JS bundles. Change to:

```typescript
build: {
  sourcemap: 'hidden',  // generates maps but doesn't reference them in bundles
}
```

The `sentryVitePlugin` (already configured, lines 64-72) will upload maps to Sentry during CI builds where `SENTRY_AUTH_TOKEN` is available. Maps are generated for Sentry but never served to browsers.

**Confidence:** HIGH -- standard pattern for static SPA deployment with Tailwind. Verified against Vite docs.

---

### 2. CORS Restriction on Edge Functions

**Board requirement:** CSO P0 -- Restrict CORS to deployment domain (currently `Access-Control-Allow-Origin: *` on ALL Edge Functions including payment handlers)

**Architecture decision: Replace `_shared/cors.ts` with origin-checking helper.**

The current `_shared/cors.ts` (confirmed by inspection) is a single object:
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

This is imported by every Edge Function. The fix is centralized.

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `supabase/functions/_shared/cors.ts` | MODIFY | Replace wildcard with origin whitelist function |
| 8 browser-facing Edge Functions | MODIFY (minimal) | Change from `corsHeaders` object to `getCorsHeaders(req)` function call |
| 3 server-to-server functions | MODIFY | Remove CORS headers entirely (stripe-webhooks, garmin-webhook, process-sync-queue) |
| `supabase/config.toml` | MODIFY | Add `garmin-webhook` with `verify_jwt = false` |

**New `_shared/cors.ts` pattern:**

```typescript
const ALLOWED_ORIGINS = [
  Deno.env.get('APP_URL') ?? 'http://localhost:5173',
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
}

// Backward compat export for gradual migration
export const corsHeaders = getCorsHeaders(new Request('http://localhost'));
```

**Exception: Webhook endpoints.** `stripe-webhooks` (line 45 -- already has no CORS import), `garmin-webhook`, and `process-sync-queue` receive requests from external services or scheduled triggers, not browsers. They should NOT include CORS headers. Remove the `corsHeaders` import from `garmin-webhook/index.ts` (currently imported on line 2).

**Data flow change:**
```
Before: Browser -> Edge Function -> corsHeaders (wildcard) -> Response
After:  Browser -> Edge Function -> getCorsHeaders(req) -> Validated origin -> Response
        Stripe -> stripe-webhooks -> No CORS headers (server-to-server)
        Garmin -> garmin-webhook -> No CORS headers (server-to-server)
```

**Confidence:** HIGH -- straightforward pattern, documented in [Supabase CORS guide](https://supabase.com/docs/guides/functions/cors).

---

### 3. OAuth Token Storage Migration

**Board requirement:** CSO P0 CRITICAL -- OAuth tokens (access_token, refresh_token) readable from browser via RLS SELECT on `user_integrations`

**Architecture decision: Create a server-only `integration_tokens` table; strip tokens from `user_integrations`.**

The current problem (confirmed by inspecting `supabase/migrations/20260216_integrations.sql`): `user_integrations` has columns `access_token TEXT`, `refresh_token TEXT`, `api_key TEXT` and a permissive SELECT policy (`auth.uid() = user_id`) that returns ALL columns. Any JavaScript running in the browser can read these OAuth tokens.

**Two-table split approach:**

| Table | Purpose | RLS | Accessed By |
|-------|---------|-----|-------------|
| `user_integrations` | Connection status, provider, last_sync_at (display data) | SELECT for owner | Browser client |
| `integration_tokens` | access_token, refresh_token, api_key, token_expires_at | NO SELECT policy (service role only) | Edge Functions only |

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| New migration | NEW | Create `integration_tokens` table, migrate data, drop token columns from `user_integrations` |
| `user_integrations` RLS | NO CHANGE | SELECT policy remains but now only returns safe columns (tokens removed from table) |
| 6 OAuth/sync Edge Functions | MODIFY | Read tokens from `integration_tokens` via join |
| `src/mutations/integrations.ts` | MODIFY | `useDisconnectIntegration` no longer nulls tokens (line 23-24) -- handled by cascade |
| `src/queries/integrations.ts` | NO CHANGE | Already only displays status/provider/last_sync -- tokens were never shown in UI |
| `src/lib/database.types.ts` | REGENERATE | Run `gen:types` after migration |

**Migration SQL:**

```sql
-- 1. New server-only table
CREATE TABLE integration_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES user_integrations(id) ON DELETE CASCADE NOT NULL UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  api_key TEXT,
  token_expires_at TIMESTAMPTZ
);
ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;
-- NO policies = no client access, only service_role can read/write

-- 2. Migrate existing tokens
INSERT INTO integration_tokens (integration_id, access_token, refresh_token, api_key, token_expires_at)
SELECT id, access_token, refresh_token, api_key, token_expires_at
FROM user_integrations
WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR api_key IS NOT NULL;

-- 3. Drop token columns from user_integrations
ALTER TABLE user_integrations
  DROP COLUMN access_token,
  DROP COLUMN refresh_token,
  DROP COLUMN api_key,
  DROP COLUMN token_expires_at;
```

**Edge Function token read pattern (all 6 integration functions):**

```typescript
// Before (e.g., strava-oauth/index.ts line 87):
const { data } = await supabase.from('user_integrations').upsert({
  access_token: accessToken, refresh_token: refreshToken, ...
});

// After:
// Step 1: Upsert integration (display data only)
const { data: integration } = await supabase.from('user_integrations').upsert({
  user_id: userId, provider: 'strava', provider_user_id: providerUserId,
  status: 'connected', connected_at: new Date().toISOString(),
}, { onConflict: 'user_id,provider' }).select('id').single();

// Step 2: Store tokens in server-only table
await supabase.from('integration_tokens').upsert({
  integration_id: integration.id,
  access_token: accessToken,
  refresh_token: refreshToken,
  token_expires_at: tokenExpiresAt,
}, { onConflict: 'integration_id' });
```

**Confidence:** HIGH -- PostgreSQL RLS with no policies means zero client access even with the anon key. Standard secure token isolation pattern.

---

### 4. OAuth State Parameter CSRF Fix

**Board requirement:** CSO P0 CRITICAL -- OAuth state parameter is raw `user_id`, enabling account linking forgery

**Current vulnerability (confirmed in `strava-oauth/index.ts`):**
- Line 28: `const state = url.searchParams.get('state'); // user_id`
- Line 40: `const userId = state;`

An attacker who knows a victim's user_id can craft an OAuth callback URL that links the attacker's Strava account to the victim's Phoenix account.

**Architecture decision: Generate cryptographic state token, store in `oauth_states` table with expiry, validate on callback.**

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| New migration | NEW | `oauth_states` table |
| New Edge Function | NEW | `oauth-init` -- generates state token, returns redirect URL |
| `strava-oauth/index.ts` | MODIFY | Validate state token instead of using as user_id |
| `fitbit-oauth/index.ts` | MODIFY | Same pattern |
| `garmin-oauth/index.ts` | MODIFY | Same pattern |
| Client integration code | MODIFY | Call `oauth-init` instead of building redirect URL client-side |
| `supabase/config.toml` | NO CHANGE | oauth-init requires JWT (default) |

**Flow change:**

```
Before:
  Browser builds URL: https://strava.com/oauth?state={user_id}&redirect_uri=...
  Strava redirects to: /strava-oauth?code=xxx&state={user_id}
  Edge Function trusts state as user_id  <-- VULNERABLE

After:
  Browser calls: supabase.functions.invoke('oauth-init', { body: { provider: 'strava' } })
  oauth-init Edge Function:
    1. Extracts user_id from JWT (authenticated)
    2. Generates crypto.randomUUID() as state_token
    3. Stores {state_token, user_id, provider, expires_at: now+10min} in oauth_states
    4. Returns redirect URL with state=state_token
  Browser redirects to: https://strava.com/oauth?state={crypto_token}&redirect_uri=...
  Strava redirects to: /strava-oauth?code=xxx&state={crypto_token}
  strava-oauth Edge Function:
    1. Looks up oauth_states WHERE state_token = state AND expires_at > now()
    2. Gets real user_id from the row
    3. Deletes the state row (single use)
    4. Proceeds with token exchange
```

**`oauth_states` table:**

```sql
CREATE TABLE oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes')
);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role access from Edge Functions

-- Cleanup cron: expired states (optional, they expire naturally)
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
```

**Confidence:** HIGH -- standard OAuth CSRF mitigation. The 10-minute expiry and single-use deletion prevent replay attacks.

---

### 5. Garmin Webhook Authentication

**Board requirement:** CSO HIGH -- Garmin webhook accepts any POST without signature verification

**Architecture decision: Add shared secret validation.**

Confirmed by inspecting `garmin-webhook/index.ts`: the function accepts any POST to its URL, parses JSON body, and processes activities. No authentication whatsoever (lines 99-208). The only current protection is that the URL contains the Supabase project reference, which is not secret.

Garmin Connect webhooks do not use HMAC signatures like Stripe. Their webhook registration requires API approval, and the webhook URL itself is configured during registration. The primary defense options:

1. **Shared secret as query parameter or header** -- add a `?secret=xxx` to the webhook URL registered with Garmin, validate in function
2. **IP allowlisting** -- not practical on Supabase Edge Functions (no static IPs)

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `garmin-webhook/index.ts` | MODIFY | Add secret validation at top of POST handler |
| `supabase/config.toml` | MODIFY | Add `verify_jwt = false` for garmin-webhook |
| Environment variables | ADD | `GARMIN_WEBHOOK_SECRET` |

**Implementation:**

```typescript
// At top of POST handler:
const webhookSecret = Deno.env.get('GARMIN_WEBHOOK_SECRET');
const providedSecret = new URL(req.url).searchParams.get('secret');
if (!webhookSecret || providedSecret !== webhookSecret) {
  return new Response('Unauthorized', { status: 401 });
}
```

Register webhook URL as: `https://<project>.supabase.co/functions/v1/garmin-webhook?secret=<GARMIN_WEBHOOK_SECRET>`

**Confidence:** MEDIUM -- Garmin's webhook security model is less documented than Stripe's. The shared secret approach is the pragmatic mitigation available.

---

### 6. Hevy Sync Authentication Fix

**Board requirement:** CSO HIGH -- Hevy sync Edge Function accepts arbitrary `user_id` without authentication

**Architecture decision: Require Supabase JWT auth (same pattern as `stripe-checkout`).**

Confirmed by inspecting `hevy-sync/index.ts` (line 43): `const { user_id, api_key, sync_type } = await req.json();` -- any caller can specify any `user_id` and sync data for any user.

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `hevy-sync/index.ts` | MODIFY | Add JWT user extraction, ignore body user_id |
| `supabase/config.toml` | NO CHANGE | `verify_jwt` defaults to `true` (already correct) |
| `src/mutations/integrations.ts` | MODIFY | Remove `user_id` from invoke body (extracted from JWT server-side) |

**Fix pattern (matches stripe-checkout lines 17-31):**

```typescript
// Extract authenticated user from JWT
const authHeader = req.headers.get('Authorization')!;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: authHeader } } }
);
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  return new Response('Unauthorized', { status: 401, headers: corsHeaders });
}
const userId = user.id;  // Ignore body.user_id
```

**Confidence:** HIGH -- pattern already exists in stripe-checkout. Direct copy.

---

### 7. Stripe Checkout Origin Validation

**Board requirement:** CSO -- `stripe-checkout` and `stripe-portal` use `req.headers.get('origin')` for redirect URLs (open redirect risk)

**Confirmed in `stripe-checkout/index.ts` lines 69-70:**
```typescript
success_url: `${req.headers.get('origin')}/profile?checkout=success`,
cancel_url: `${req.headers.get('origin')}/profile?checkout=cancel`,
```

An attacker can set the `Origin` header to any URL, causing Stripe to redirect the user to a malicious site after checkout.

**Fix: Validate origin against allowlist (reuse from CORS fix).**

```typescript
import { ALLOWED_ORIGINS } from '../_shared/cors.ts';

const origin = req.headers.get('origin') ?? '';
const safeOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

success_url: `${safeOrigin}/profile?checkout=success`,
cancel_url: `${safeOrigin}/profile?checkout=cancel`,
```

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `stripe-checkout/index.ts` | MODIFY | Validate origin against allowlist |
| `stripe-portal/index.ts` | MODIFY | Same pattern |
| `_shared/cors.ts` | REUSE | Export `ALLOWED_ORIGINS` array |

**Confidence:** HIGH -- trivial fix using the same origin allowlist from CORS.

---

### 8. GitHub Actions CI/CD Pipeline

**Board requirement:** COO P1 -- Zero CI/CD pipeline; every deploy is unvalidated and manually irreversible

**Architecture decision: Two workflow files -- `ci.yml` for quality gates and `deploy-functions.yml` for Edge Function deployment.**

**Confirmed:** No `.github/` directory exists. No deployment config files (no `vercel.json`, `netlify.toml`, or `_headers`).

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `.github/workflows/ci.yml` | NEW | Build, test, deploy pipeline |
| `.github/workflows/deploy-functions.yml` | NEW | Supabase Edge Function deployment |
| `package.json` scripts | MODIFY | Add `lint` and `typecheck` scripts |
| Playwright config | NO CHANGE | Already has CI-specific settings (retries: 2, workers: 1) |
| Vitest config | NO CHANGE | Already configured in `vite.config.ts` test block |

**CI pipeline architecture (`ci.yml`):**

```
push to main / pull_request
  |
  +-- Job: quality-gate (parallel steps)
  |     +-- biome check src/ (lint + format)
  |     +-- tsc --noEmit (typecheck)
  |     +-- vitest run (12 unit test files)
  |
  +-- Job: build (depends on quality-gate)
  |     +-- vite build (with SENTRY_AUTH_TOKEN for source map upload)
  |     +-- Upload dist/ as artifact
  |
  +-- Job: e2e (depends on build)
  |     +-- Download dist/ artifact
  |     +-- npx playwright install --with-deps chromium
  |     +-- Start preview server (vite preview)
  |     +-- playwright test (public pages + auth'd pages if creds available)
  |     +-- Upload playwright-report/ as artifact on failure
  |
  +-- Job: deploy-frontend (depends on e2e, only on push to main)
        +-- Deploy dist/ to hosting platform
```

**Edge Function deployment (`deploy-functions.yml`):**

```yaml
name: Deploy Edge Functions
on:
  push:
    branches: [main]
    paths: ['supabase/functions/**']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase functions deploy --project-ref ${{ secrets.SUPABASE_PROJECT_ID }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

Per [Supabase GitHub Actions docs](https://supabase.com/docs/guides/functions/examples/github-actions), since CLI v1.62.0 a single `supabase functions deploy` deploys all functions. The `config.toml` handles per-function settings (like `verify_jwt = false`).

**New `package.json` scripts:**

```json
{
  "lint": "biome check src/",
  "typecheck": "tsc --noEmit"
}
```

**Required GitHub Secrets:**

| Secret | Purpose |
|--------|---------|
| `SUPABASE_ACCESS_TOKEN` | CLI auth for Edge Function deploy |
| `SUPABASE_PROJECT_ID` | Target project for deploy |
| `SENTRY_AUTH_TOKEN` | Source map upload during build |
| `SENTRY_ORG` | Sentry organization |
| `SENTRY_PROJECT` | Sentry project |
| `VITE_SUPABASE_URL` | Build-time env var |
| `VITE_SUPABASE_ANON_KEY` | Build-time env var |
| `SUPABASE_TEST_EMAIL` | (optional) E2E test account |
| `SUPABASE_TEST_PASSWORD` | (optional) E2E test account |

**E2E test strategy in CI:** The existing `smoke.spec.ts` and `a11y.spec.ts` already handle missing auth creds gracefully (`authedTest.skip(skip, "No test credentials")`). Public page tests always run. Authenticated tests run only when secrets are configured.

**Confidence:** HIGH -- patterns well-documented by [Playwright CI docs](https://playwright.dev/docs/ci-intro) and [Supabase deploy docs](https://supabase.com/docs/guides/functions/deploy).

---

### 9. Desktop Navigation Restructure

**Board requirement:** CXO P2 -- 13 flat navigation items violate Hick's Law

**Architecture decision: Group into 4 categories using dropdown menus.**

Confirmed current state in `Navigation.tsx`: 13 items in a flat `navItems` array (lines 29-43), rendered as inline NavLinks (line 66-89). On a standard 1440px display, 13 items with icons barely fit.

**Proposed grouping (4 groups + 1 standalone):**

```
Dashboard (standalone)
  |
  Training          Insights          Social
    History           Analytics         Community
    Records           Biomechanics      Challenges
    Routines          Recovery
    Cycles            Goals
                      Compare
  |
  Profile (standalone, right side)
    Profile
    Integrations
```

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `src/app/components/Navigation.tsx` | MAJOR MODIFY | Replace flat list with grouped dropdowns |
| `src/app/components/MobileBottomNav.tsx` | REVIEW | Already uses "More" drawer -- validate grouping alignment |
| Routes | NO CHANGE | URL paths unchanged |
| Framer Motion `layoutId="activeTab"` | MODIFY | Active indicator logic needs group-awareness |

**Component approach:** Use `@radix-ui/react-navigation-menu` (already in `package.json` as a dependency, line 37). This provides accessible dropdown menus with keyboard navigation, hover triggers, and ARIA attributes out of the box.

```typescript
const navGroups: NavGroup[] = [
  {
    label: "Training",
    icon: Dumbbell,
    items: [
      { path: "/history", label: "History", icon: History },
      { path: "/records", label: "Records", icon: Award },
      { path: "/routines", label: "Routines", icon: Dumbbell },
      { path: "/cycles", label: "Cycles", icon: Repeat },
    ],
  },
  {
    label: "Insights",
    icon: BarChart3,
    items: [
      { path: "/analytics", label: "Analytics", icon: BarChart3 },
      { path: "/biomechanics", label: "Biomechanics", icon: Activity },
      { path: "/recovery", label: "Recovery", icon: HeartPulse },
      { path: "/goals", label: "Goals", icon: Target },
      { path: "/compare", label: "Compare", icon: Flame },
    ],
  },
  {
    label: "Social",
    icon: Users,
    items: [
      { path: "/community", label: "Community", icon: Users },
      { path: "/challenges", label: "Challenges", icon: Trophy },
    ],
  },
];
```

**Confidence:** HIGH -- Radix NavigationMenu is already a dependency. This is a UI restructure, not an architectural change.

---

### 10. prefers-reduced-motion Integration with Framer Motion

**Board requirement:** CXO P2 -- Zero `prefers-reduced-motion` support despite 55 files importing `motion/react` (WCAG 2.1 AA failure)

**Confirmed:** Zero files match `prefers-reduced-motion` in the entire `src/` directory. No `MotionConfig` or `LazyMotion` wrapper exists anywhere.

**Architecture decision: Wrap app in `<MotionConfig reducedMotion="user">` at the provider level. Single insertion point.**

Per the [Motion accessibility guide](https://motion.dev/docs/react-accessibility) and [MotionConfig docs](https://motion.dev/docs/react-motion-config), `MotionConfig` accepts a `reducedMotion` prop with three values:
- `"user"` -- Respect the user's OS `prefers-reduced-motion` setting (recommended)
- `"always"` -- Force reduced motion (debugging)
- `"never"` -- Ignore reduced motion preference

When `reducedMotion="user"` is set and the user has reduced motion enabled:
- Transform animations (x, y, scale, rotate) **instantly complete** (no visible motion)
- Opacity and color animations **still play** (non-vestibular, safe)
- Layout animations are **disabled**
- This applies to ALL `motion.*` components nested under the config

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `src/main.tsx` | MODIFY | Wrap app in `<MotionConfig reducedMotion="user">` |
| 55 component files | NO CHANGE | All motion components automatically respect the config |
| `src/app/components/celebrations/*.tsx` | REVIEW | Verify opacity-only fallback is meaningful for celebrations |
| Canvas 2D session replay | NO CHANGE | Uses requestAnimationFrame directly, not motion components |
| `src/styles/theme.css` | MODIFY | Add `@media (prefers-reduced-motion: reduce)` for CSS animations |
| `e2e/a11y.spec.ts` | MODIFY | Add reduced-motion emulation test |

**Provider hierarchy after change:**

```tsx
// src/main.tsx
import { MotionConfig } from "motion/react";

root.render(
  <BrowserRouter>
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <QueryProvider>
          <App />
        </QueryProvider>
      </AuthProvider>
    </MotionConfig>
  </BrowserRouter>,
);
```

**CSS animation coverage:** The custom CSS animations defined in `theme.css` (`animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow`) are NOT covered by `MotionConfig` -- they use CSS `@keyframes`, not the motion library. Add:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-flame-flicker,
  .animate-ember-rise,
  .animate-phoenix-glow {
    animation: none !important;
  }
}
```

**Component-level hook for celebration fallbacks:**

```typescript
import { useReducedMotion } from "motion/react";

function PRCelebration({ record }) {
  const shouldReduce = useReducedMotion();
  if (shouldReduce) {
    // Show static badge instead of particle animation
    return <StaticPRBadge record={record} />;
  }
  return <AnimatedPRCelebration record={record} />;
}
```

Per the [useReducedMotion docs](https://motion.dev/docs/react-use-reduced-motion), this hook reactively responds to changes in the user's system preference.

**Confidence:** HIGH -- `MotionConfig` and `useReducedMotion` are first-party Motion library APIs.

---

### 11. Content Moderation Data Model

**Board requirement:** COO P2 -- No report, flag, or block mechanisms for community features

**Architecture decision: Three-table model (content_reports, user_blocks, moderation_actions) with RLS.**

The community system currently has: `community_comments` (with RLS, rate limiting, realtime), `shared_routines`, `shared_cycles` with voting. No moderation capability exists.

**New tables:**

```sql
-- Users can report content
CREATE TABLE content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reported_item_id UUID NOT NULL,
  reported_item_type TEXT NOT NULL CHECK (reported_item_type IN ('comment', 'routine', 'cycle')),
  reported_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'copyright', 'other')),
  description TEXT CHECK (char_length(description) <= 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE(reporter_id, reported_item_id, reported_item_type)
);

-- Users can block other users (hides their content)
CREATE TABLE user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  blocked_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

-- Admin action log (future admin dashboard, not exposed to users)
CREATE TABLE moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES content_reports(id),
  moderator_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('warn', 'hide_content', 'ban_user', 'dismiss')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**RLS policies:**

```sql
-- content_reports: create own, view own
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "report_insert" ON content_reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "report_select" ON content_reports FOR SELECT
  USING (reporter_id = auth.uid());

-- user_blocks: manage own blocks
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "block_insert" ON user_blocks FOR INSERT
  WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "block_select" ON user_blocks FOR SELECT
  USING (blocker_id = auth.uid());
CREATE POLICY "block_delete" ON user_blocks FOR DELETE
  USING (blocker_id = auth.uid());

-- moderation_actions: no client access (admin only via service_role)
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;
```

**Integration with existing community queries -- block filtering:**

The `user_blocks` table must filter community content. Create a reusable helper function:

```sql
CREATE OR REPLACE FUNCTION public.is_blocked(content_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_blocks
    WHERE blocker_id = auth.uid() AND blocked_id = content_user_id
  );
$$;
```

Then add to existing community RLS policies or query-level filters:

```typescript
// In community query files, add .not('user_id', 'in', blockedUserIds)
// Or filter client-side using the user_blocks query
```

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| New migration | NEW | 3 tables + RLS + helper function |
| Community query files | MODIFY | Add block filter |
| `CommunityFeedCard.tsx` | MODIFY | Add three-dot menu with Report/Block options |
| New components | NEW | `ReportDialog.tsx`, `BlockConfirmDialog.tsx` |
| New mutations | NEW | `useReportContent()`, `useBlockUser()`, `useUnblockUser()` |
| New queries | NEW | `blockedUsersOptions(userId)` |
| Profile/Settings | MODIFY | Add "Blocked Users" management section |

**Confidence:** MEDIUM -- standard community moderation pattern. Performance of `is_blocked()` function within RLS queries should be tested at scale.

---

### 12. GDPR Data Export Architecture

**Board requirement:** CSO/COO P1 -- Implement GDPR data export and account deletion

**Architecture decision: Two Edge Functions (`gdpr-export`, `gdpr-delete`) with service_role, invoked by authenticated user.**

GDPR Article 20 requires data portability in "structured, commonly used, machine-readable format." JSON is standard.

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| New Edge Function | NEW | `gdpr-export` -- aggregates user data, returns JSON |
| New Edge Function | NEW | `gdpr-delete` -- cancels Stripe, deletes all data, deletes auth user |
| Profile page | MODIFY | Add "Export My Data" and "Delete Account" buttons in settings |
| New mutation hooks | NEW | `useExportData()`, `useDeleteAccount()` |

**Export function data scope:**

```typescript
// gdpr-export Edge Function (service_role)
const userId = user.id; // extracted from JWT

const exportData = {
  account: { email: user.email, created_at: user.created_at },
  profile: await supabase.from('profiles').select('*').eq('id', userId).single(),
  subscriptions: await supabase.from('subscriptions').select('*').eq('user_id', userId),
  workouts: await supabase.from('workout_sessions').select('*').eq('user_id', userId),
  sets: await supabase.from('sets').select('*').eq('user_id', userId),
  personal_records: await supabase.from('personal_records').select('*').eq('user_id', userId),
  goals: await supabase.from('goals').select('*').eq('user_id', userId),
  comments: await supabase.from('community_comments').select('*').eq('user_id', userId),
  shared_routines: await supabase.from('shared_routines').select('*').eq('user_id', userId),
  integrations: await supabase.from('user_integrations')
    .select('provider, status, connected_at, last_sync_at')
    .eq('user_id', userId),
  external_activities: await supabase.from('external_activities').select('*').eq('user_id', userId),
  // EXCLUDED: integration_tokens (secrets), moderation_actions (admin data)
};
```

**Account deletion flow:**

```
User clicks "Delete Account"
  -> Type email to confirm dialog
  -> supabase.functions.invoke('gdpr-delete')
  -> Edge Function (uses both user JWT for auth + service_role for admin ops):
    1. Cancel Stripe subscription if active (stripe.subscriptions.cancel)
    2. Delete Supabase auth user via admin API (supabase.auth.admin.deleteUser)
       -- ON DELETE CASCADE handles all user data in all tables
    3. Return { success: true }
  -> Client signs out, redirects to landing page
```

The `ON DELETE CASCADE` from `auth.users(id)` is set on: `profiles`, `subscriptions`, `user_integrations`, `integration_tokens`, `workout_sessions`, `personal_records`, `goals`, `community_comments`, `shared_routines`, `shared_cycles`, `user_blocks`, `content_reports`, `oauth_states`, `user_onboarding`, `external_activities`. This handles data cleanup without manual table-by-table deletion.

**Important:** Stripe must be cancelled BEFORE auth user deletion, because the Stripe customer_id is on the profiles table which will be cascade-deleted.

**Confidence:** MEDIUM -- the cascade deletion pattern is clean, but error handling for partial failures (Stripe fails, user not deleted) needs careful design. A retry mechanism or manual cleanup flag may be needed.

---

### 13. Sentry PII Scrubbing

**Board requirement:** CSO -- Sentry has no PII scrubbing for health/biometric data

**Architecture decision: Configure `beforeSend` and `beforeBreadcrumb` hooks in Sentry init.**

**Integration points:**

| Layer | Change Type | What |
|-------|-------------|------|
| `src/lib/sentry.ts` | MODIFY | Add `beforeSend` hook to strip biometric fields |

```typescript
// In initSentry():
Sentry.init({
  // ... existing config ...
  beforeSend(event) {
    // Strip biometric/health data from error contexts
    if (event.contexts) {
      for (const [key, ctx] of Object.entries(event.contexts)) {
        if (ctx && typeof ctx === 'object') {
          for (const field of ['heart_rate', 'weight', 'body_fat', 'calories',
            'force', 'velocity', 'power', 'rom', 'asymmetry_score']) {
            delete (ctx as Record<string, unknown>)[field];
          }
        }
      }
    }
    // Strip from breadcrumb data
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(b => {
        if (b.data) {
          for (const field of ['heart_rate', 'weight', 'body_fat', 'calories',
            'force', 'velocity', 'power', 'access_token', 'refresh_token']) {
            delete b.data[field];
          }
        }
        return b;
      });
    }
    return event;
  },
});
```

**Confidence:** HIGH -- standard Sentry configuration.

---

## Component Boundaries Summary

### New Files

| Category | File | Purpose |
|----------|------|---------|
| Edge Functions | `supabase/functions/oauth-init/index.ts` | Generate CSRF state token for OAuth |
| Edge Functions | `supabase/functions/gdpr-export/index.ts` | Aggregate user data for download |
| Edge Functions | `supabase/functions/gdpr-delete/index.ts` | Cancel Stripe + delete user |
| CI/CD | `.github/workflows/ci.yml` | Build/test/deploy pipeline |
| CI/CD | `.github/workflows/deploy-functions.yml` | Edge Function deployment |
| Hosting | `public/_headers` or `vercel.json` | CSP and security headers |
| Migrations | `20260228_integration_tokens.sql` | Server-only token storage |
| Migrations | `20260228_oauth_states.sql` | CSRF state table |
| Migrations | `20260228_content_moderation.sql` | Reports, blocks, mod actions |
| Components | `src/app/components/moderation/ReportDialog.tsx` | Report content modal |
| Components | `src/app/components/moderation/BlockConfirmDialog.tsx` | Block user confirmation |
| Mutations | `src/mutations/moderation.ts` | Report/block mutations |
| Mutations | `src/mutations/gdpr.ts` | Export/delete mutations |
| Queries | `src/queries/moderation.ts` | Blocked users list |

### Modified Files (Ranked by Impact)

| File | Change Scope | Risk |
|------|-------------|------|
| `supabase/functions/_shared/cors.ts` | Origin whitelist (affects all 11 functions) | Medium -- test all functions |
| All 6 integration Edge Functions | Token read from new table | Medium -- functional change |
| 3 OAuth Edge Functions | State token validation | Medium -- flow change |
| `src/main.tsx` | Add MotionConfig wrapper (1 line) | Low |
| `src/styles/theme.css` | Add reduced-motion media query | Low |
| `src/app/components/Navigation.tsx` | Complete restructure to grouped nav | Medium -- visual regression |
| `vite.config.ts` | sourcemap: 'hidden' | Low |
| `supabase/config.toml` | Add verify_jwt entries | Low |
| `src/lib/sentry.ts` | Add beforeSend PII scrubbing | Low |
| `src/mutations/integrations.ts` | Remove token nulling, remove user_id from invoke | Low |
| `stripe-checkout/index.ts` | Origin validation | Low |
| `stripe-portal/index.ts` | Origin validation | Low |
| `package.json` | Add lint/typecheck scripts | Low |
| Community query files | Add block filter | Low |
| Profile page | Add Export/Delete/Blocked Users sections | Low |
| `CommunityFeedCard.tsx` | Add three-dot moderation menu | Low |
| `e2e/a11y.spec.ts` | Add reduced-motion test | Low |

---

## Recommended Build Order (Dependency-Based)

```
Phase 1: Security Foundation (no cross-dependencies, parallelize all)
  [1] CORS restriction (_shared/cors.ts) -- unblocks all Edge Function changes
  [2] Source maps: build.sourcemap = 'hidden' (1 line in vite.config.ts)
  [3] Sentry PII scrubbing (isolated to sentry.ts)
  [4] Stripe origin validation (2 functions, reuses CORS allowlist)

Phase 2: Critical Security (depends on CORS from Phase 1)
  [5] OAuth token migration (new table + modify 6 Edge Functions)
  [6] OAuth state CSRF fix (new table + new function + modify 3 functions)
  [7] Hevy sync auth fix (1 function)
  [8] Garmin webhook auth (1 function)

Phase 3: Infrastructure (independent of Phase 2, can parallelize)
  [9] CI/CD pipeline (.github/workflows/)
  [10] CSP headers (hosting config file)

Phase 4: Accessibility (independent, can parallelize with Phase 2-3)
  [11] MotionConfig + CSS reduced-motion
  [12] Navigation restructure

Phase 5: Features (depends on Phase 2 migrations being stable)
  [13] Content moderation tables + UI components
  [14] GDPR export + deletion Edge Functions + UI
```

**Critical path:** CORS fix -> OAuth token migration -> OAuth state CSRF fix -> CI/CD deployed

The CORS fix is first because every subsequent Edge Function modification needs the new `getCorsHeaders()` pattern -- changing functions twice is wasteful. OAuth token migration is second because it's the highest-severity security issue (CSO CRITICAL) and changes the table schema that other functions depend on.

**Parallelization opportunities:**
- Phase 1 items are all independent
- Phase 3 + Phase 4 can run in parallel with Phase 2
- Phase 5 items are independent of each other

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: CSP via HTML Meta Tag in SPA

**What people do:** Add `<meta http-equiv="Content-Security-Policy" content="...">` to `index.html`.

**Why it's wrong for this project:** The meta tag is baked into the static HTML at build time. It cannot use nonces (same nonce for every request). It cannot be updated without a rebuild. Some CSP directives (like `frame-ancestors`) are not supported via meta tag. HTTP headers are strictly more capable and the standard approach for static hosting.

**Do this instead:** Deploy-time headers file (`_headers` for Netlify, `vercel.json` headers for Vercel, or hosting platform equivalent).

### Anti-Pattern 2: Separate Token Table Per Provider

**What people do:** Create `strava_tokens`, `fitbit_tokens`, `garmin_tokens` tables.

**Why it's wrong:** Multiplies migration/RLS/query complexity. The current `user_integrations` table already uses a `provider` column discriminator. The token split should follow the same pattern -- one `integration_tokens` table with a foreign key to `user_integrations`.

**Do this instead:** Single `integration_tokens` table with `integration_id` FK.

### Anti-Pattern 3: Client-Side Block Filtering

**What people do:** Fetch all community content, then filter blocked users in JavaScript.

**Why it's wrong:** Exposes blocked user content in network responses (privacy issue). Wastes bandwidth. The block should be enforced at the database level.

**Do this instead:** Add block filter to RLS policies or query-level `.not()` filters so blocked content never leaves the database.

### Anti-Pattern 4: Monolithic CI Workflow

**What people do:** Put frontend build, E2E tests, Edge Function deploy, and database migration all in one job.

**Why it's wrong:** A Playwright test failure blocks Edge Function deployment. Edge Functions are independent of the frontend build. Database migrations should be a separate, deliberate operation.

**Do this instead:** Separate workflows for frontend CI and Edge Function deployment. Database migrations remain manual (via Supabase CLI or dashboard) -- they should not auto-deploy on push.

### Anti-Pattern 5: MotionConfig at Component Level

**What people do:** Wrap individual components in `<MotionConfig reducedMotion="user">`.

**Why it's wrong:** Misses any motion component not wrapped. Creates inconsistency where some animations respect the preference and others don't. The whole point of MotionConfig is that it applies to the entire subtree.

**Do this instead:** Single `<MotionConfig>` in `main.tsx`, wrapping everything. Use `useReducedMotion()` hook only in components that need different JSX (not just different animation), like celebrations that should show static fallback content.

---

## Scalability Considerations

| Concern | Current (100 users) | At 1K users | At 10K users |
|---------|---------------------|-------------|--------------|
| `is_blocked()` in RLS | Fine | Fine | Index on `user_blocks(blocker_id, blocked_id)` |
| GDPR export data size | < 1MB JSON | < 10MB | Streaming response or background job |
| OAuth states table | Trivial | Trivial | Cron to clean expired rows |
| Content reports review | Supabase dashboard | Supabase dashboard | Needs admin dashboard |
| CI/CD pipeline time | ~3 min | Same | Same (not user-count dependent) |
| CORS validation | Trivial | Trivial | Trivial (array.includes check) |

---

## Sources

- [Vite CSP Nonce Limitations -- Issue #20531](https://github.com/vitejs/vite/issues/20531) -- confirms nonce is not suitable for static SPA
- [Supabase Edge Functions CORS docs](https://supabase.com/docs/guides/functions/cors) -- origin restriction patterns
- [Supabase GitHub Actions deploy docs](https://supabase.com/docs/guides/functions/examples/github-actions) -- workflow YAML
- [Motion MotionConfig docs](https://motion.dev/docs/react-motion-config) -- reducedMotion prop values
- [Motion useReducedMotion hook](https://motion.dev/docs/react-use-reduced-motion) -- reactive hook API
- [Motion accessibility guide](https://motion.dev/docs/react-accessibility) -- WCAG compliance patterns
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) -- policy patterns
- [Supabase GDPR compliance](https://www.kontocsv.de/en/ratgeber/supabase-dsgvo-konform) -- DPA, data handling
- [Playwright CI setup](https://playwright.dev/docs/ci-intro) -- GitHub Actions workflow
- [Supabase Edge Function deployment](https://supabase.com/docs/guides/functions/deploy) -- CLI v1.62.0+ deploy all
- [Supabase Hardening Data API](https://supabase.com/docs/guides/database/hardening-data-api) -- security patterns

---

*Architecture research for: Phoenix Portal v1.2 launch-readiness hardening*
*Researched: 2026-02-27*
*Supersedes: v1.1 architecture research from 2026-02-16*
