# Stack Research

**Domain:** Launch-readiness hardening — security, legal, CI/CD, accessibility, operational infrastructure
**Researched:** 2026-02-27
**Confidence:** HIGH (versions verified via npm registry, official docs, and WebSearch as of Feb 27, 2026)

> **Scope note:** This document covers ONLY v1.2 stack additions. The existing stack (React 19, Vite 7, TypeScript strict, Tailwind v4, shadcn/ui, Supabase, Stripe, Sentry v10, TanStack Query, Zustand, React Router v7, Biome 2.4, Playwright, visx, Recharts 3, Framer Motion/motion) is established and validated. Nothing here replaces existing dependencies.

> **Key insight:** v1.2 requires almost zero new npm packages. The work is primarily configuration, infrastructure files, Edge Function hardening, and using APIs already available in existing dependencies. This is an operational milestone, not a feature milestone.

---

## Section 1: Security Hardening

### 1A. Content Security Policy (CSP)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `<meta>` CSP tag in `index.html` | N/A (HTML standard) | Restrict script/style/connect sources | No new dependency needed. For a Vite SPA deployed to a static host, a `<meta http-equiv="Content-Security-Policy">` tag is the simplest approach because it works regardless of hosting platform (Vercel, Netlify, Cloudflare Pages, S3+CloudFront). Hosting-level headers (`vercel.json`, `_headers`) are preferred when the platform is chosen, but the meta tag provides a platform-agnostic baseline that works immediately. |

**CSP policy for Phoenix Portal (all required domains):**

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob: https://*.supabase.co;
  connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.sentry.io https://*.strava.com https://api.fitbit.com https://connectapi.garmin.com https://api.hevy.com;
  frame-src https://js.stripe.com https://hooks.stripe.com;
  worker-src 'self' blob:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  report-uri https://o[ORG_ID].ingest.sentry.io/api/[PROJECT_ID]/security/;
">
```

**Rationale for each directive:**
- `script-src 'self'` -- no inline scripts in the build; Vite outputs only file-based modules. No nonce needed because Vite does not inject inline scripts in production builds (the entry point is a `<script type="module" src="...">` tag).
- `style-src 'unsafe-inline'` -- Tailwind v4 injects styles at runtime. Required until Tailwind ships a CSP-safe mode. This is the standard tradeoff in Tailwind v4 projects.
- `connect-src` -- enumerates every API the app calls: Supabase REST/Realtime, Stripe, Sentry, OAuth providers.
- `frame-src` -- Stripe Checkout/Elements uses iframes.
- `worker-src 'self' blob:` -- PWA service worker + Sentry Session Replay web worker.
- `report-uri` -- sends CSP violations to Sentry for monitoring.

**When hosting platform is chosen:** Migrate from `<meta>` to hosting-level headers (`vercel.json` headers array or Netlify `_headers` file) because HTTP headers override meta tags and support `report-to` (which meta does not).

**No plugin needed.** The Vite CSP plugins (`vite-plugin-csp`, `vite-plugin-content-security-policy`) add complexity for nonce-based policies. Phoenix Portal does not need nonces because it has no inline scripts. A static meta tag is sufficient and simpler.

### 1B. CORS Restriction on Edge Functions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Manual CORS header update | N/A (code change) | Restrict `Access-Control-Allow-Origin` from `*` to deployment domain | No new dependency. Supabase Edge Functions require manual CORS handling. The current `_shared/cors.ts` file sets `'*'` which is the CSO's #3 finding. |

**Implementation:**

```typescript
// supabase/functions/_shared/cors.ts
const ALLOWED_ORIGINS = [
  Deno.env.get('APP_URL') ?? 'http://localhost:5173',
];

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}
```

**Critical:** The `Vary: Origin` header is required when the response varies by origin. Without it, CDN or browser caches may serve a response with the wrong `Access-Control-Allow-Origin` value.

### 1C. OAuth CSRF Token (State Parameter Fix)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `crypto.randomUUID()` | Built-in (Web Crypto API) | Generate cryptographic CSRF state tokens for OAuth flows | Available in Deno (Edge Functions runtime) and all modern browsers. No npm package needed. The current implementation passes raw `user_id` as the OAuth state parameter, allowing account-linking forgery. |

**Implementation pattern:**

1. **Before redirect:** Generate `state = crypto.randomUUID()`, store `{state, user_id, created_at}` in a `oauth_states` table (or Supabase vault).
2. **On callback:** Look up `state` in DB, verify it exists and is < 10 minutes old, extract `user_id`, then delete the row.
3. **Apply to:** `strava-oauth`, `fitbit-oauth`, `garmin-oauth` Edge Functions.

This is the standard OAuth 2.0 CSRF prevention per RFC 6749 Section 10.12. No library needed -- it is 15 lines of code per function.

### 1D. Source Map Security

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Vite `sourcemap: 'hidden'` | Built-in (Vite 7) | Generate source maps without `//# sourceMappingURL` comment in output files | Already have `@sentry/vite-plugin` (v4.9.1 installed, v5.1.1 available). The plugin already uploads maps to Sentry. The only change is switching `sourcemap: true` to `sourcemap: 'hidden'` in `vite.config.ts` and adding `filesToDeleteAfterUpload`. |

**Change in vite.config.ts:**

```typescript
build: {
  sourcemap: 'hidden', // was: true
  // ...
},
```

**Add to Sentry plugin config:**

```typescript
sentryVitePlugin({
  // existing config...
  sourcemaps: {
    filesToDeleteAfterUpload: ['./dist/**/*.map'],
  },
}),
```

**Rationale:** `sourcemap: 'hidden'` generates `.map` files (Sentry uploads them) but strips the `//# sourceMappingURL` comment from JS bundles, so browsers cannot discover them. `filesToDeleteAfterUpload` removes `.map` files from the deploy artifact after Sentry upload, preventing accidental CDN exposure. This addresses CSO finding #4.

### 1E. Sentry PII Scrubbing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Sentry `beforeSend` callback | Built-in (@sentry/react v10) | Strip biometric/health data from error reports | No new dependency. Add a `beforeSend` hook to the existing `initSentry()` in `src/lib/sentry.ts` that scrubs fields like `weight`, `force`, `heart_rate`, `calories` from breadcrumbs and event contexts. |

### 1F. Webhook Authentication (Garmin)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| HMAC-SHA256 signature verification | Built-in (Web Crypto API) | Verify Garmin webhook payloads are authentic | Deno's Web Crypto API provides `crypto.subtle.importKey` and `crypto.subtle.sign` for HMAC verification. Garmin sends a signature header that should be verified against the payload using the consumer secret. No npm package needed. |

### 1G. Hevy Sync Authentication

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase JWT verification | Built-in (@supabase/supabase-js) | Require authenticated user for hevy-sync calls | The `hevy-sync` Edge Function currently accepts arbitrary `user_id` in the request body. Fix: extract user from the Authorization JWT header (which Supabase Edge Functions receive automatically) instead of trusting the body. Uses `supabase.auth.getUser()`. No new dependency. |

---

## Section 2: CI/CD Pipeline

### 2A. GitHub Actions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| GitHub Actions | N/A (platform) | CI/CD pipeline for build, lint, test, deploy gates | Free for public repos, 2000 min/mo for private. The project already has Playwright configured with `process.env.CI` checks (see `playwright.config.ts`). GitHub Actions is the standard CI for GitHub-hosted repos. No competing option is worth the migration cost. |

**Workflow file: `.github/workflows/ci.yml`**

Three jobs, sequential with fail-fast:

1. **lint-and-type-check** -- `npx biome check .` + `npx tsc --noEmit` (~30s)
2. **unit-tests** -- `npm run test` (Vitest) (~30s)
3. **build** -- `npm run build` (Vite production build) (~45s)
4. **e2e-tests** -- `npx playwright test` (needs Playwright browsers installed) (~2-3min)

**Runner:** `ubuntu-latest` with Node.js 20 (matches project's `engines.node >= 20.19.0`).

**Caching:** `actions/setup-node@v4` with `cache: 'npm'` for node_modules. Playwright browser cache via `actions/cache@v4` with key based on Playwright version.

**Triggers:** `push` to `main`, `pull_request` to `main`.

**No deploy job initially.** Deploy automation depends on hosting platform choice (Vercel/Netlify auto-deploy from GitHub, or manual `vercel deploy`). The CI pipeline gates quality; deploy is a separate concern.

### 2B. Playwright Browser Install Caching

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@playwright/test` | 1.58.2 (already installed) | E2E testing in CI | Already in devDependencies. CI job needs `npx playwright install --with-deps chromium` before running tests. Cache the browser binary using `actions/cache@v4` with a key that includes the Playwright version to avoid 1-2 min download on every run. |

---

## Section 3: Legal / GDPR Compliance

### 3A. GDPR Data Export

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase Edge Function + `papaparse` | N/A (new Edge Function) | Export all user data as JSON/CSV on request | GDPR Article 20 requires data portability. The portal already has `papaparse` (v5.5.3) for CSV export of workout history. A new `gdpr-export` Edge Function queries all user tables (workouts, goals, records, integrations, comments, profile) and returns a ZIP. No new npm package -- PapaParse runs server-side in Deno via `npm:papaparse`. |

### 3B. Account Deletion

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase Edge Function + `supabase.auth.admin.deleteUser()` | Built-in (@supabase/supabase-js admin API) | Complete account deletion (GDPR Article 17 right to erasure) | Must use service_role key (Edge Function only). Pattern: (1) delete from all user data tables via CASCADE or explicit deletes, (2) delete auth.users row via admin API, (3) cancel Stripe subscription via API. No npm dependency. Supabase's admin `deleteUser()` cascades through auth tables. Application data tables need explicit `ON DELETE CASCADE` foreign keys or explicit queries. |

### 3C. Privacy Policy and Terms of Service

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Static React components | N/A | Legal pages rendered in the app | No dependency. The app already has a `PrivacyPolicy.tsx` component (which contains the incorrect "we don't collect data" text). Rewrite in place. Add `TermsOfService.tsx`. Both are static content components with no library needs. Route already exists for privacy; add `/terms` route. |

### 3D. Cookie Consent Banner

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Custom component (no library) | N/A | GDPR consent for analytics cookies | The portal uses Sentry (which sets cookies) and potentially Google Fonts. A simple banner with "Accept" / "Reject" that stores preference in `localStorage` and conditionally initializes Sentry is sufficient. Do NOT add a cookie consent library (react-cookie-consent, cookieconsent) -- they are bloated for this use case. The portal has no ad tracking, no Google Analytics, no marketing pixels. The banner is ~50 lines of code. |

---

## Section 4: Accessibility

### 4A. Reduced Motion Support

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `MotionConfig` with `reducedMotion="user"` | Built-in (motion 12.x) | Automatically disable transform/layout animations when user prefers reduced motion | Already installed: `motion@12.23.24` (latest: 12.34.3). The `MotionConfig` component from `motion/react` accepts a `reducedMotion` prop. Setting it to `"user"` at the app root makes ALL 55 `<motion.*>` components automatically respect `prefers-reduced-motion`. Transform and layout animations are disabled; opacity and backgroundColor are preserved. This is the single highest-leverage accessibility fix. |

**Implementation (one line in App.tsx or provider hierarchy):**

```tsx
import { MotionConfig } from "motion/react";

// Wrap the app root
<MotionConfig reducedMotion="user">
  {/* existing app tree */}
</MotionConfig>
```

**For bespoke control (individual components):**

```tsx
import { useReducedMotion } from "motion/react";

function MyComponent() {
  const shouldReduceMotion = useReducedMotion();
  // Replace x/y slide with opacity fade, etc.
}
```

**Scope:** 55 files import from `motion/react`. The `MotionConfig` wrapper handles all of them globally. The `useReducedMotion` hook is needed only for components where the reduced-motion behavior should differ from the default (e.g., celebration animations that should fade instead of flying).

### 4B. Skip-to-Content Link

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Custom `<a>` element | N/A (HTML standard) | Allow keyboard users to skip navigation | No library needed. A visually-hidden anchor (`<a href="#main-content" class="sr-only focus:not-sr-only ...">`) as the first element in the body, plus `id="main-content"` on the `<main>` element. Tailwind's `sr-only` and `focus:not-sr-only` classes handle the show-on-focus pattern. This is a 5-line component. Do NOT install `@reach/skip-nav` -- it is unmaintained (last release 2022) and the functionality is trivial. |

### 4C. Chart Accessibility

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `aria-label` + `role="img"` on chart wrappers | N/A (ARIA standard) | Screen reader alternatives for Recharts/visx charts | No library. Add `role="img"` and descriptive `aria-label` to chart container divs. For complex data, add a visually-hidden `<table>` fallback that presents the same data in tabular form. Recharts does not natively support ARIA -- the wrapping div approach is the standard community pattern. |

### 4D. Accessibility Testing in CI

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@axe-core/playwright` | 4.11.1 (already installed) | Automated WCAG 2.1 AA audit in E2E tests | Already in devDependencies. The project already has axe-core Playwright tests from v1.1 (with contrast fixes). The v1.2 work is to (1) ensure these run in CI, (2) expand coverage to all 26 routes, and (3) fail the build on critical violations. No new package. |

---

## Section 5: Content Moderation

### 5A. Report/Flag System

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase table + RLS | N/A (database schema) | Store content reports from users | No npm dependency. A `content_reports` table with columns: `id`, `reporter_id`, `target_type` (comment/routine/profile), `target_id`, `reason` (enum: spam, harassment, inappropriate, other), `details`, `status` (pending/reviewed/dismissed/actioned), `created_at`, `reviewed_at`, `reviewed_by`. RLS: users can INSERT their own reports, cannot read others' reports. |

### 5B. User Blocking

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Supabase table + client-side filter | N/A (database schema) | Allow users to block other users | A `user_blocks` table: `blocker_id`, `blocked_id`, `created_at`. RLS: users manage their own blocks. Client-side: filter blocked users from community feeds, comments, and routine listings. Server-side: RLS policy on `community_comments` that excludes blocked users' content. No npm dependency. |

### 5C. Auto-Moderation (Deferred)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **NOT recommended for v1.2** | N/A | AI-based content filtering | The community is small (projected 50-200 active users). Manual moderation via a report queue is sufficient. AI moderation services (Perspective API, OpenAI Moderation, Stream AutoMod) add cost and complexity disproportionate to the community size. Revisit if community exceeds 1000 active users. |

---

## Section 6: Operational Infrastructure

### 6A. FAQ / Support Page

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Static React component + Radix Accordion | Already installed (Radix UI) | FAQ page with expandable sections | `@radix-ui/react-accordion` is already in the bundle. A FAQ page is a static component using the existing `Accordion` shadcn/ui primitive. No new dependency. |

### 6B. Contact / Support Channel

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `mailto:` link + Discord invite | N/A | Minimum viable support channel | No dependency. A support email address and a link to the Project Phoenix Discord server. Do NOT add a full help desk (Zendesk, Intercom, Crisp) -- the user base is too small to justify the cost and integration complexity. A shared inbox (support@phoenixportal.app or similar) with email forwarding is sufficient for < 500 users. |

---

## Summary: What to Install

### New npm Packages

**None.** Every v1.2 capability is achievable with existing dependencies or built-in platform APIs.

### Updates to Existing Packages (Optional, Non-Blocking)

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| `motion` | 12.23.24 | 12.34.3 | Patch updates only. `MotionConfig reducedMotion` works on current version. Update opportunistically. |
| `@sentry/vite-plugin` | 4.9.1 | 5.1.1 | Major version bump. v5 adds `filesToDeleteAfterUpload` improvements. Evaluate during source map security work. |

### New Files (Not Packages)

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI/CD pipeline |
| `vercel.json` or `_headers` | CSP + security headers (when hosting platform chosen) |
| `supabase/functions/_shared/cors.ts` | Rewrite: origin-restricted CORS |
| `supabase/functions/gdpr-export/index.ts` | New Edge Function: data export |
| `supabase/functions/account-delete/index.ts` | New Edge Function: account deletion |
| `supabase/migrations/XXX_content_reports.sql` | Report/flag schema |
| `supabase/migrations/XXX_user_blocks.sql` | User blocking schema |
| `supabase/migrations/XXX_oauth_states.sql` | CSRF state token storage |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `<meta>` CSP tag | `vite-plugin-csp` or `vite-plugin-content-security-policy` | Plugins add nonce-based CSP which requires server-side rendering or SSR middleware. Phoenix Portal is a static SPA -- nonces cannot be generated client-side. The meta tag approach is simpler, works everywhere, and Vite's production build has no inline scripts requiring nonces. |
| GitHub Actions | CircleCI, GitLab CI | Project is on GitHub. GitHub Actions has zero configuration overhead for GitHub repos. CircleCI/GitLab CI require account setup and external integration. |
| Custom cookie consent banner | `react-cookie-consent` (npm) | The library is 8KB gzipped and designed for complex multi-category GDPR consent flows. Phoenix Portal has exactly one optional cookie (Sentry). A 50-line custom component is smaller, simpler, and fully controllable. |
| `MotionConfig reducedMotion="user"` | Custom `useMediaQuery('(prefers-reduced-motion: reduce)')` hook | Motion's built-in `MotionConfig` handles ALL 55 motion components with a single wrapper. A custom hook would require manually threading reduced-motion logic through every animated component. Use `useReducedMotion` from `motion/react` only for bespoke override behavior on specific components. |
| Manual report/flag queue | Stream Chat moderation, Perspective API | Massive over-engineering for a community of 50-200 users. A Supabase table with a simple admin query is sufficient. The project explicitly avoids admin dashboards in v1.2 scope, so a SQL-queryable report table with email notifications is the right granularity. |
| `mailto:` support link | Zendesk, Intercom, Crisp | Help desk software costs $15-50/mo per agent and adds a chat widget script to the bundle. For a solo developer with < 500 users, email is faster and cheaper. Upgrade to a help desk if support volume exceeds 20 tickets/week. |
| `@reach/skip-nav` for skip links | Custom 5-line component | @reach/skip-nav is unmaintained (last publish: 2022, React 18 era). The skip-to-content pattern is 5 lines of HTML/CSS. Installing a dead package for trivial functionality adds risk for zero benefit. |
| Supabase admin `deleteUser()` for GDPR | Custom deletion logic | The admin API handles auth table cleanup. Application data tables need explicit CASCADE or manual deletion, but the auth portion is handled by Supabase's built-in admin method. No alternative provides better coverage. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `helmet` (npm) | Express.js middleware -- does not apply to Vite SPA or Supabase Edge Functions. Completely wrong runtime. | CSP meta tag + hosting platform headers |
| `csurf` (npm) | Express.js CSRF middleware -- deprecated, and not applicable to Edge Functions. | `crypto.randomUUID()` + database state table |
| `react-cookie-consent` | Bloated for a single-cookie scenario. Adds consent categories, cookie scanner, multi-language -- none needed. | Custom ~50-line banner component |
| `@reach/skip-nav` | Unmaintained (2022). React 18 era. Trivial functionality. | 5-line custom skip link |
| AI moderation (Perspective API, OpenAI) | Overkill for 50-200 users. Adds external API dependency, cost, and latency to every post. | Manual report queue with email alerts |
| Full help desk (Zendesk, Intercom) | $15-50/mo per agent. Chat widget adds 50-100KB to bundle. Not justified for < 500 users. | `mailto:` link + Discord community |
| `vite-plugin-csp` | Designed for nonce-based CSP requiring SSR. Phoenix Portal is a static SPA. | Static `<meta>` CSP tag |

## Version Compatibility

| Package/Tool | Compatible With | Notes |
|--------------|-----------------|-------|
| `MotionConfig reducedMotion` | `motion` >= 11.0 | Available since Framer Motion v11. The project has v12.23.24. Fully compatible. |
| `@sentry/vite-plugin` v5 | Vite 7.x | v5 is compatible. `filesToDeleteAfterUpload` available since v4. |
| GitHub Actions `ubuntu-latest` | Node.js 20.19+ | Matches project's `engines.node` field. Use `actions/setup-node@v4` with `node-version: '20'`. |
| `@axe-core/playwright` 4.11.1 | `@playwright/test` 1.58.2 | Both already installed and version-compatible. |
| Supabase `auth.admin.deleteUser()` | `@supabase/supabase-js` >= 2.x | Available in v2. Project has v2.95.3. Fully compatible. |
| `crypto.randomUUID()` | Deno (Edge Functions runtime) | Built-in Web Crypto API. No polyfill needed. |
| `crypto.subtle` (HMAC) | Deno (Edge Functions runtime) | Built-in Web Crypto API for Garmin webhook signature verification. |

## Integration Points

### How new capabilities connect to existing stack:

```
CSP meta tag
  └── index.html (add <meta> tag)
      ├── Allows: *.supabase.co (REST + Realtime)
      ├── Allows: api.stripe.com + js.stripe.com (Checkout)
      ├── Allows: *.sentry.io (error reporting)
      └── Allows: fonts.googleapis.com + fonts.gstatic.com

CORS fix
  └── supabase/functions/_shared/cors.ts (rewrite)
      └── All 12 Edge Functions import from here (single change point)

OAuth CSRF fix
  └── New table: oauth_states
      └── strava-oauth, fitbit-oauth, garmin-oauth (add state verification)

Source map fix
  └── vite.config.ts (sourcemap: 'hidden' + filesToDeleteAfterUpload)
      └── @sentry/vite-plugin (already configured, add deletion option)

MotionConfig
  └── App.tsx or provider hierarchy (wrap app root)
      └── All 55 motion/react consumers (automatic, no per-file changes)

CI/CD
  └── .github/workflows/ci.yml
      ├── Biome check (existing biome.json config)
      ├── TypeScript check (existing tsconfig.json)
      ├── Vitest (existing test setup)
      └── Playwright (existing playwright.config.ts with CI flags)

GDPR
  └── New Edge Functions (gdpr-export, account-delete)
      ├── Uses existing Supabase service_role pattern
      └── Uses existing papaparse for CSV generation

Content moderation
  └── New Supabase tables (content_reports, user_blocks)
      └── New RLS policies + client-side filtering in existing query files
```

## Sources

- [Vite CSP approaches](https://hysterelius.com/vite-headers/) -- CSP meta tag vs plugin comparison
- [Vite static deploy docs](https://vite.dev/guide/static-deploy) -- official deployment patterns
- [Supabase CORS docs](https://supabase.com/docs/guides/functions/cors) -- Edge Function CORS configuration
- [Supabase Edge Function auth](https://supabase.com/docs/guides/functions/auth) -- securing Edge Functions
- [Sentry Vite source maps](https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/uploading/vite/) -- `filesToDeleteAfterUpload` and `sourcemap: 'hidden'`
- [Motion accessibility docs](https://motion.dev/docs/react-accessibility) -- `MotionConfig reducedMotion` API
- [Motion useReducedMotion](https://motion.dev/docs/react-use-reduced-motion) -- per-component reduced motion hook
- [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) -- axe-core integration guide
- [Playwright CI setup](https://playwright.dev/docs/ci-intro) -- GitHub Actions configuration
- [Supabase deleteUser API](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) -- admin account deletion
- [Supabase GDPR compliance](https://github.com/orgs/supabase/discussions/2341) -- DPA and data handling requirements
- [Supabase user self-deletion guide](https://blog.mansueli.com/supabase-user-self-deletion-empower-users-with-edge-functions) -- Edge Function pattern
- [Vercel security headers](https://vercel.com/docs/headers/security-headers) -- hosting-level CSP headers
- npm registry (verified 2026-02-27): motion@12.34.3, @axe-core/playwright@4.11.1, @playwright/test@1.58.2, @sentry/vite-plugin@5.1.1, vitest@4.0.18

---
*Stack research for: v1.2 Launch Readiness Hardening*
*Researched: 2026-02-27*
*Key finding: Zero new npm packages required. All capabilities use existing deps or platform APIs.*
