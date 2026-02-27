# Project Research Summary

**Project:** Phoenix Portal v1.2 — Launch Readiness Hardening
**Domain:** Security hardening, legal compliance, CI/CD, and accessibility for a premium fitness analytics SaaS
**Researched:** 2026-02-27
**Confidence:** HIGH

> **Scope note:** This SUMMARY covers v1.2 research (2026-02-27). The v1.1 summary is preserved in git history. All v1.1 phases are complete. This document informs the v1.2 roadmap only.

---

## Executive Summary

Phoenix Portal v1.2 is not a feature milestone — it is an operational and compliance milestone. The product already works. The research confirms that the app is a 41,920 LOC / 266-file React 19 + Supabase SPA with a functional feature set, Stripe billing, OAuth integrations, and a community layer. What is missing is the infrastructure required to responsibly accept money from real users: accurate legal documents, GDPR-mandated user rights (export, deletion), security fixes for confirmed vulnerabilities (CORS wildcard on payment endpoints, OAuth CSRF, exposed OAuth tokens), and a CI/CD pipeline to prevent regressions going forward. Every one of these gaps is a launch blocker.

The recommended approach is to work in strict priority order. Four items are P0 legal blockers that must ship before any public access: the privacy policy rewrite (current policy falsely claims "we collect nothing" while storing data in Supabase, Stripe, and Sentry with 4 OAuth providers), Terms of Service (none exists; cannot legally charge customers without one), pricing consistency ($9.99 on landing page vs $14.99 on pricing page), and free-tier gating enforcement (pricing page promises limits that no code enforces). Security hardening is an architectural prerequisite that should be done alongside or just before the P0 work — the CORS wildcard and OAuth CSRF vulnerabilities are on live payment and integration infrastructure. After the foundation is secure and legally sound, seven P1 operational items must land before paid tiers activate: CI/CD pipeline, GDPR data export and deletion, basic support infrastructure, content moderation, Stripe billing tests, and a cookie consent banner.

The key risk is sequencing. The most dangerous pitfall is deploying security fixes in the wrong order and silently breaking existing functionality for real users. Research identifies nine specific failure modes — CSP blocking Stripe and Sentry silently, CORS restriction breaking local dev and OAuth flows, token column restriction disconnecting existing integrations, GDPR cascade deletion destroying other users' community content. Each has a verified prevention strategy. Critically: zero new npm packages are required. Every v1.2 capability is achievable with the existing stack or built-in platform APIs. This is a configuration, infrastructure, and hardening effort, not a technology adoption effort.

---

## Key Findings

### Recommended Stack

**Zero new npm packages required.** Every v1.2 capability is achievable with existing dependencies or built-in platform APIs. The existing stack (React 19, Vite 7, TypeScript strict, Tailwind v4, shadcn/ui, Supabase, Stripe, Sentry v10, TanStack Query, Zustand, React Router v7, Biome 2.4, Playwright, Recharts 3, Framer Motion/motion, @axe-core/playwright) covers all needs. The work is configuration files, Edge Function modifications, database migrations, and using APIs already present in installed packages.

**Core technologies for v1.2 work:**

- `Content-Security-Policy` via hosting headers or `<meta>` tag: XSS protection — deploy to hosting layer (`vercel.json` or `_headers`) when platform is confirmed; use `<meta>` tag as portable baseline until then
- GitHub Actions: CI/CD pipeline — free for GitHub-hosted repos; project already has CI-aware Playwright and Vitest configs that need only a workflow file
- Supabase Edge Functions (Deno runtime): GDPR export/deletion, OAuth state management, Garmin webhook auth — same infrastructure as existing 11 functions; no new infrastructure
- `MotionConfig reducedMotion="user"` (motion 12.x, already installed): Global reduced-motion support — one wrapper in App.tsx covers all 55 animated components automatically
- `@axe-core/playwright` 4.11.1 (already installed): Accessibility CI gate — needs only to run in the new pipeline
- `crypto.randomUUID()` / `crypto.subtle` (Deno built-in Web Crypto API): OAuth CSRF tokens and Garmin webhook HMAC verification — no npm packages

**Optional package updates (non-blocking, opportunistic):**

| Package | Current | Latest | Notes |
|---------|---------|--------|-------|
| `motion` | 12.23.24 | 12.34.3 | Patch updates. `MotionConfig reducedMotion` works on current version. |
| `@sentry/vite-plugin` | 4.9.1 | 5.1.1 | Major bump. v5 improves `filesToDeleteAfterUpload`. Evaluate during source map work. |

**New files required (not packages):**

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI quality gate pipeline |
| `.github/workflows/deploy-functions.yml` | Edge Function deployment on push to main |
| `vercel.json` or `public/_headers` | CSP and security headers at hosting layer |
| `supabase/functions/_shared/cors.ts` | Rewrite: origin-allowlist CORS replacing wildcard |
| `supabase/functions/oauth-init/index.ts` | New: CSRF-safe OAuth initiation |
| `supabase/functions/gdpr-export/index.ts` | New: compile all user data as downloadable ZIP |
| `supabase/functions/account-delete/index.ts` | New: ordered cascade deletion across all systems |
| 4 SQL migrations | `integration_tokens`, `oauth_states`, `content_reports`, `user_blocks` tables |

### Expected Features

**Must have before any public launch (P0 — legal/compliance blockers):**

- **Privacy Policy rewrite** — current `PrivacyPolicy.tsx` is the mobile app's policy, not the portal's; says "we collect nothing" while storing data in Supabase (cloud Postgres), Stripe (payments), Sentry (error monitoring), and 4 OAuth providers; LOW complexity, HIGH legal urgency
- **Terms of Service** — no ToS exists anywhere in the codebase; cannot legally charge customers; Stripe requires merchant ToS; needs subscription terms, acceptable use, limitation of liability, community content license; LOW complexity
- **Pricing consistency fix** — $9.99 on landing page vs $14.99 on pricing page; not a feature build, purely a content fix; P0 because it is deceptive pricing
- **Free-tier gating enforcement** — pricing page promises usage limits (e.g., 30 sessions of history) that `SubscriptionGate` component does not enforce; MEDIUM complexity; requires `useFreeTierLimits` hook and RLS enforcement

**Must have before paid tiers activate (P1 — operational/safety):**

- **CI/CD pipeline** — no GitHub Actions workflows exist; every deploy is unvalidated; Playwright and Vitest already have CI-aware configs, just need `.github/workflows/ci.yml`
- **GDPR data export** — Article 20 right to portability; Edge Function compiling profile, workouts, records, routines, goals, comments, integrations into downloadable ZIP; papaparse already installed
- **GDPR account deletion** — Article 17 right to erasure (2025 enforcement priority); cascade across Supabase (15+ tables), Stripe customer, OAuth token revocation; 30-day grace period; highest-complexity feature in v1.2
- **FAQ + contact form** — static FAQ page using existing Radix Accordion + mailto link + Discord invite; no library needed; no support infrastructure of any kind exists today
- **Content moderation (report/flag/block)** — zero moderation mechanisms in community features; `content_reports` table for report queue; `user_blocks` table for user blocking; manual review via Supabase Studio; no automated moderation
- **Stripe billing test coverage** — zero test coverage on Stripe checkout, portal, or webhook handlers; revenue-critical path; webhook mock payloads for all 5 event types
- **Cookie consent banner** — GDPR consent for Sentry cookie; custom ~50-line component; no library (react-cookie-consent is 8KB for a single-cookie scenario); conditionally initialize Sentry based on stored preference

**Should have before scale (P2 — UX/accessibility):**

- **Reduced-motion support** — zero `prefers-reduced-motion` support exists; `<MotionConfig reducedMotion="user">` at app root (one change, 55 components covered) plus CSS overrides for `animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow` in `theme.css`
- **Skip-to-content link** — keyboard navigation bypass; WCAG 2.1 AA requirement; 5-line custom component styled in Phoenix ember color
- **Chart accessibility** — `role="img"` + descriptive `aria-label` on all Recharts/visx chart wrappers; visually-hidden `<table>` fallback for Canvas-based visx charts (opaque to screen readers)
- **Desktop navigation restructure** — 13 flat nav items violate Hick's Law; grouped into 4 categories (Training, Insights, Social + standalone Dashboard/Profile); keep all 26 route paths unchanged

**Defer to v1.3+:**

- Admin dashboard — use Supabase Studio until moderation volume justifies a UI
- AI/automated content moderation — overkill for 50-200 users; high false positive rate in fitness domain ("Skull Crusher" is a tricep exercise)
- PII scrubbing in Sentry — low risk; add `beforeSend` filter when time permits
- Nested comment threads — already deferred from v1.1
- Full help desk (Zendesk, Intercom) — $15-50/mo per agent not justified for fewer than 500 users

### Architecture Approach

The v1.2 architecture work is additive. The existing SPA architecture (BrowserRouter > AuthProvider > QueryProvider > App > AppRoutes, 26 routes, 3 Zustand stores, TanStack Query + Zod pipeline) does not change. The backend gains 3 new Edge Functions, 4 new database tables, and targeted security modifications to the existing 11 Edge Functions. The highest architectural impact is OAuth token isolation: splitting `user_integrations` into a browser-accessible display table and a server-only `integration_tokens` table (no RLS SELECT policy, service_role only), requiring updates to all 6 OAuth/sync Edge Functions. All other changes are either new files or modifications to specific functions.

**Major components and their v1.2 responsibilities:**

1. **`_shared/cors.ts` rewrite** — Replace `Access-Control-Allow-Origin: *` with `getCorsHeaders(req)` function using `ALLOWED_ORIGINS` env var. Single change point for all 8 browser-facing Edge Functions. The 3 server-to-server functions (`stripe-webhooks`, `garmin-webhook`, `process-sync-queue`) have CORS headers removed entirely.

2. **`integration_tokens` table (new, server-only)** — No RLS SELECT policy means zero browser client access even with anon key. Stores `access_token`, `refresh_token`, `api_key`, `token_expires_at` currently exposed in `user_integrations`. All 6 OAuth/sync Edge Functions updated to read from this table via service_role key.

3. **`oauth-init` Edge Function (new)** — Generates `crypto.randomUUID()` state token, stores in `oauth_states` table with 10-minute expiry, returns redirect URL. Replaces client-side OAuth URL construction. All 3 OAuth providers (Strava, Fitbit, Garmin) updated to validate state via this mechanism.

4. **`gdpr-export` and `account-delete` Edge Functions (new)** — Deletion uses explicit ordered cascade (anonymize community content first with "[Deleted User]" sentinel, delete personal data, cancel Stripe subscription, delete Stripe customer, delete auth user last via admin API). Never relies on ON DELETE CASCADE alone.

5. **GitHub Actions workflows (new)** — `ci.yml`: quality-gate job (biome + tsc + vitest in parallel), build job, e2e job with Playwright browser caching, deploy-frontend on push to main. `deploy-functions.yml`: triggered when `supabase/functions/**` changes.

6. **`App.tsx` MotionConfig wrap** — Single `<MotionConfig reducedMotion="user">` wrapper covers all 55 motion/react consumers globally. Preserves opacity and color animations; disables transforms and layout animations per WCAG 2.1 AA.

7. **CSP headers** — Start with `Content-Security-Policy-Report-Only` mode on staging. Transition to enforcement after verifying all integration paths (Stripe checkout, Sentry, Supabase realtime, Google/Apple OAuth, PWA service worker). Required `unsafe-inline` for `style-src` because Tailwind v4 injects styles at runtime.

8. **Legal pages** — `PrivacyPolicy.tsx` content rewrite (keep component structure, replace content entirely). New `TermsOfService.tsx` on new `/terms` route.

### Critical Pitfalls

1. **CSP headers break Stripe/Sentry/Supabase silently** — App appears functional but checkout fails, errors go unreported, realtime dies, PWA service worker breaks — all without visible error messages (CSP violations are browser-console only). Prevention: deploy as `Content-Security-Policy-Report-Only` first; exercise every feature path on staging; collect full domain list before switching to enforcement. Required domains include 6 Stripe subdomains, both `https://` and `wss://` for Supabase, Google/Apple OAuth `frame-src`, and `worker-src blob:` for PWA.

2. **CORS restriction breaks local dev, staging, and OAuth flows** — Hardcoding one production domain blocks `localhost:5173`, Vercel preview URLs, and OAuth callbacks (which are server-to-server, not browser-initiated). Prevention: `ALLOWED_ORIGINS` env var as comma-separated list; `Vary: Origin` response header required (CDN caching); fix Stripe checkout to use `APP_URL` env var instead of `req.headers.get('origin')` (origin header can be spoofed).

3. **OAuth token column restriction disconnects existing integrations** — Removing tokens from `user_integrations` without verifying Edge Functions use service_role key causes all sync operations to fail with null token errors. Prevention: audit all 6 integration functions for service_role usage before running migration; confirm frontend code never reads token columns (it does not — only status/provider/last_sync_at are displayed, per `src/queries/integrations.ts`).

4. **GDPR account deletion cascades destroy other users' community content** — Naive `ON DELETE CASCADE` deletes shared routines saved by others, vaporizes comments with replies, and removes community votes affecting other routines' rankings. Prevention: classify data into three categories before building the deletion flow — delete personal data, anonymize community content (set `user_id` to deleted-user sentinel, replace content with "[deleted]"), handle behavioral data explicitly. Implement as ordered Edge Function; never rely on CASCADE alone.

5. **CI/CD pipeline reveals implicit environment assumptions on first run** — 17 authenticated E2E tests skip silently (no `SUPABASE_TEST_EMAIL`/`SUPABASE_TEST_PASSWORD` in CI), Playwright browser install adds 400MB without caching, `SENTRY_AUTH_TOKEN` absent may cause build issues, CRLF line endings break Biome on Linux runners. Prevention: start with build + unit tests only; add E2E as a separate job after the basic pipeline is green; add `.gitattributes` with `* text=auto eol=lf`; cache Playwright browsers with key based on Playwright version.

---

## Implications for Roadmap

The work naturally organizes into three phases with a strict dependency structure. Security hardening is an architectural prerequisite that must come first. Legal/compliance plus CI/CD form a coupled second phase — you need the CI gate in place before shipping irreversible operations like GDPR deletion. UX and accessibility improvements follow as a third phase that requires CI regression protection to be safe.

---

### Phase 1: Security Hardening (Architectural Foundation)

**Rationale:** Security fixes must come first because the CORS wildcard is on live payment endpoints, the OAuth CSRF vulnerability allows account-linking forgery against any user whose ID is known, and OAuth tokens are browser-readable today. These are not theoretical risks — the CSO identified them against the running system. The `_shared/cors.ts` rewrite and `integration_tokens` table migration are also architectural changes that all subsequent Edge Function work will build on. Done once, done first.

**Delivers:**
- CORS restriction on all 8 browser-facing Edge Functions (origin allowlist via `ALLOWED_ORIGINS` env var; `Vary: Origin` response header)
- CORS headers removed from 3 server-to-server Edge Functions (`stripe-webhooks`, `garmin-webhook`, `process-sync-queue`)
- OAuth token isolation: `integration_tokens` server-only table; tokens removed from `user_integrations`; all 6 OAuth/sync Edge Functions updated
- CSRF-safe OAuth flows: `oauth-init` Edge Function; `oauth_states` table with 10-minute expiry; Strava, Fitbit, Garmin callbacks updated
- Source maps hidden: `build.sourcemap: 'hidden'` + `filesToDeleteAfterUpload` in Sentry plugin; source maps uploaded to Sentry, not served publicly
- Garmin webhook authentication: shared secret validation via query parameter
- Hevy sync authentication: JWT extraction replacing body `user_id` (copies pattern from `stripe-checkout`)
- Stripe checkout/portal origin validation: `APP_URL` env var replacing spoofable `req.headers.get('origin')`
- Sentry `beforeSend` PII filter: strips `weight`, `force`, `heart_rate`, `calories` from error event context

**Avoids:** Pitfall 1 (CSP breakage — deploy report-only first), Pitfall 2 (token restriction lockout — verify service_role usage first), Pitfall 3 (CORS breaking all environments — env var approach), Pitfall 7 (source maps breaking Sentry — verify upload before removing public maps)

**Research flag:** Standard security patterns with official documentation. No additional research phase needed. CORS allowlist and OAuth state flow are documented in Supabase official guides and OAuth 2.0 RFC 6749 Section 10.12.

---

### Phase 2: Legal, Compliance, and CI/CD (Launch Gate)

**Rationale:** After the security foundation is stable, legal and operational blockers must be resolved before a single paying user is onboarded. Privacy Policy and ToS are P0 blockers with legal consequences if wrong. The CI/CD pipeline must be established before GDPR deletion is shipped — the deletion Edge Function is too complex and irreversible to deploy without automated testing. The GDPR features depend on the CI gate. Content moderation enforcement depends on the ToS (the ToS defines what acceptable use means). The dependency chain: pricing fix first, then free-tier gating; Privacy Policy first, then cookie consent; ToS first, then content moderation; CI first, then GDPR deletion.

**Delivers:**
- Privacy Policy rewrite: accurate disclosure of Supabase, Stripe, Sentry, OAuth providers, biometric health data (GDPR sensitive data category), cookies/localStorage
- Terms of Service: subscription terms, acceptable use, limitation of liability, community content license (user retains ownership, grants display license)
- Pricing consistency fix: resolve $9.99 vs $14.99 discrepancy (content change only)
- Free-tier gating enforcement: `useFreeTierLimits` hook checking usage counts against configured limits; RLS policies enforcing limits server-side; upgrade prompt on limit reached (showcase locked features, not hard errors)
- GitHub Actions `ci.yml`: quality-gate job (biome check, tsc --noEmit, vitest run in parallel), build job, e2e job (Playwright with Chromium + browser caching), deploy-frontend on push to main
- GitHub Actions `deploy-functions.yml`: `supabase functions deploy` triggered on `supabase/functions/**` changes
- GDPR data export Edge Function: queries all user tables, compiles as ZIP using papaparse (already installed); exposed in Profile/Settings page
- GDPR account deletion Edge Function: explicit ordered cascade with 30-day grace period (`deletion_requested_at` column on profiles); confirmation email on execution
- Cookie consent banner: custom component; stores preference in localStorage; conditionally initializes Sentry
- FAQ + contact page: shadcn Accordion using existing Radix UI (no new package); mailto + Discord link
- Content moderation: `content_reports` table (report queue); `user_blocks` table (user blocking); report button in community post/comment 3-dot menus; block user from profile; manual review via Supabase Studio
- Stripe billing test coverage: mock webhook payloads for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

**Avoids:** Pitfall 4 (GDPR cascade destruction — ordered anonymize-then-delete approach, never CASCADE alone), Pitfall 5 (CI environment failures — start with build+unit tests, add E2E separately), Pitfall 10 (content moderation false positives — manual-only, no automated filtering)

**Research flag:** GDPR account deletion warrants careful implementation planning. The 30-day grace period flow, Stripe customer deletion vs financial record retention requirements, and the edge cases (active subscriptions, pending invoices) need validation against Stripe's data processing addendum before implementation begins. Everything else in this phase follows well-documented patterns.

---

### Phase 3: UX, Accessibility, and Navigation (Polish Before Scale)

**Rationale:** These improvements are valuable but not launch blockers. They require Phase 2's CI/CD pipeline to be in place — axe-core regression tests must run in CI to ensure accessibility work doesn't regress. The animation work touches 55+ components and must be done carefully to avoid killing the Phoenix brand's animated identity. The navigation restructure must preserve all 26 existing route paths; URL changes would break Discord links and bookmarks.

**Delivers:**
- `<MotionConfig reducedMotion="user">` in App.tsx (one wrapper, 55 motion/react consumers covered globally; preserves opacity/color animations, disables transforms/layout)
- CSS `@media (prefers-reduced-motion: reduce)` overrides for `animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow` in `theme.css`
- Celebration animation fallbacks: PR/streak/badge/challenge-won animations degrade to opacity-only fade under reduced-motion (requires per-component `useReducedMotion` hook for bespoke behavior)
- Skip-to-content link: Phoenix-ember colored (`bg-phoenix-ember text-white`), `sr-only focus:not-sr-only` pattern, `id="main-content"` on `<main>`
- Chart accessibility: `role="img"` + descriptive `aria-label` on all Recharts chart wrappers; `role="application"` where keyboard navigation is supported; visually-hidden `<table>` fallback for Canvas-based visx charts
- Phoenix-themed `:focus-visible` styles in global CSS (ember color, not default browser blue — which clashes with dark theme)
- Desktop navigation restructure: 4 grouped categories (Training: Dashboard, History, Records, Routines, Cycles; Insights: Analytics, Biomechanics, Recovery, Goals, Challenges, Compare; Social: Community, Integrations; Account: Profile) via dropdown menus; all 26 route paths unchanged; mobile bottom nav untouched
- Axe-core CI gate expanded to all 26 routes

**Avoids:** Pitfall 8 (animation suppression killing Phoenix brand — MotionConfig at root preserves opacity, disables vestibular-triggering transforms; celebration animations get per-component fallback, not suppression), Pitfall 9 (nav restructure breaking deep links — never change route paths; add redirects only if paths must change)

**Research flag:** Two items need a design decision before implementation:
- **Celebration animations under reduced-motion:** Should `PR Set`, `Streak`, `Challenge Won`, `Badge Earned` celebrations become opacity-only fades or static "achievement unlocked" banners when reduced-motion is active? This is a product/design call, not a code question. Flag for design review before implementation sprint begins.
- **Navigation restructure scope:** The architecture research recommends grouped dropdown menus, but a sidebar is also viable. The decision affects how the 13 items are grouped and what the mobile experience looks like. Confirm the navigation pattern (dropdown vs sidebar) during planning before implementation.

---

### Phase Ordering Rationale

- **Security first** because CORS and OAuth vulnerabilities are on live infrastructure serving real users. Legal documents can follow the security baseline; live vulnerabilities cannot wait.
- **Legal + CI/CD second** because you need automated testing gates before deploying GDPR deletion (irreversible) and free-tier enforcement (potentially locks out users). The privacy policy and ToS are required before cookie consent and content moderation can function correctly.
- **UX/accessibility third** because it has zero legal urgency, requires CI regression protection to be safe (axe-core), and carries design risk that benefits from dedicated focus rather than being squeezed into a compliance sprint.
- **Dependency chain respected throughout:** Pricing fix before free-tier gating; Privacy Policy before cookie consent and GDPR features; ToS before content moderation enforcement; CI pipeline before GDPR deletion; CORS fix before any new Edge Functions are deployed.

### Research Flags

**Needs validation during implementation planning:**
- **Phase 2, GDPR account deletion:** The Stripe customer deletion vs financial record retention sequencing. Stripe's data processing addendum specifies what must be retained for legal/tax purposes. Validate before building the account-delete Edge Function. This is a legal/API question, not a code question.
- **Phase 3, Celebration animation fallbacks:** Design decision on whether reduced-motion celebrations should fade (opacity) or display as static banners. Requires a product/design call before implementation sprint.
- **Phase 3, Navigation restructure pattern:** Dropdown menus vs sidebar — confirm before implementation to avoid mid-sprint architecture change.

**Standard patterns (skip research-phase):**
- **Phase 1:** CORS allowlist, OAuth state flow, source map configuration, JWT auth extraction — all documented in official Supabase, Vite, and Sentry docs. Direct implementation.
- **Phase 2:** GitHub Actions + Playwright is fully documented. Privacy Policy and ToS are content writing tasks. Content moderation report queue is a standard DB table pattern. Cookie consent is a ~50-line component.
- **Phase 3:** `MotionConfig reducedMotion="user"` is documented in motion.dev official docs. Skip-to-content link is a 5-line HTML/CSS pattern. Chart ARIA is standard WCAG technique.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry and official docs as of 2026-02-27. Zero new packages confirmed by cross-referencing STACK and ARCHITECTURE research against existing `package.json`. |
| Features | HIGH | Feature set directly driven by Board P0/P1/P2 resolutions and CSO/COO/CXO findings against the live codebase. No speculation — every item traces to a named Board finding or legal requirement. |
| Architecture | HIGH | Every integration point verified by inspecting actual source files with specific line numbers cited (e.g., `strava-oauth/index.ts` line 28 using `user_id` as OAuth state; `hevy-sync/index.ts` line 43 accepting arbitrary `user_id`). Migration SQL and Edge Function patterns are production-tested patterns from the existing 11 functions. |
| Pitfalls | HIGH (security), MEDIUM (CI/CD, a11y) | Security pitfalls are based on direct codebase inspection with line number citations. CI/CD and accessibility pitfalls are from community post-mortems and documented failure patterns, not project-specific inspection. |

**Overall confidence: HIGH**

The single area of meaningful uncertainty is the Stripe financial record retention requirements for GDPR account deletion — specifically which customer and invoice fields Stripe allows to be deleted vs must retain for legal/tax compliance. This is a legal/API question with a documented answer in Stripe's data processing addendum; it requires verification before building the deletion Edge Function, not research from scratch.

### Gaps to Address

- **Hosting platform not confirmed:** CSP implementation has two options — hosting-level HTTP headers (`vercel.json` or `_headers` file) vs `<meta http-equiv="Content-Security-Policy">` tag in `index.html`. HTTP headers are preferred (support `report-to` directive; override meta tags) but require knowing the platform. If unknown: implement `<meta>` tag as portable baseline, migrate to HTTP headers after platform choice. Resolve at Phase 1 kickoff.

- **Pricing final values:** The $9.99 vs $14.99 discrepancy must be resolved by a product decision before free-tier gating enforcement begins. The content fix is one line; the gating enforcement requires knowing the final limits. Resolve before Phase 2 sprint begins.

- **Legal review for Privacy Policy and ToS:** Research confirmed the required structure and disclosure content, but health/biometric data is a sensitive data category under GDPR Article 9 that benefits from qualified legal review. "Best effort" privacy policies written without legal review carry risk proportional to the sensitivity of the data. Acknowledge this gap explicitly in the v1.2 kickoff.

- **Stripe customer deletion vs retention requirements:** GDPR Article 17 requires erasure but Stripe retains financial records for legal/tax purposes. Verify the exact Stripe fields that must be retained vs can be deleted against Stripe's data processing addendum before building the account-delete Edge Function.

---

## Sources

### Primary (HIGH confidence)

- [Vite CSP docs — issue #20531](https://github.com/vitejs/vite/issues/20531) — static SPA CSP meta tag vs HTTP headers; confirms nonce approach does not work for static SPAs
- [Supabase CORS guide](https://supabase.com/docs/guides/functions/cors) — Edge Function CORS configuration
- [Supabase Edge Function auth](https://supabase.com/docs/guides/functions/auth) — JWT extraction pattern
- [Supabase admin deleteUser API](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) — GDPR account deletion
- [Supabase GitHub Actions deploy](https://supabase.com/docs/guides/functions/examples/github-actions) — `supabase functions deploy` since CLI v1.62.0
- [Sentry Vite source maps](https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/uploading/vite/) — `sourcemap: 'hidden'` + `filesToDeleteAfterUpload`
- [Motion for React accessibility](https://motion.dev/docs/react-accessibility) — `MotionConfig reducedMotion` API
- [Motion useReducedMotion hook](https://motion.dev/docs/react-use-reduced-motion) — per-component bespoke override
- [Playwright CI setup](https://playwright.dev/docs/ci-intro) — GitHub Actions integration, browser caching
- [GDPR Art. 17 — Right to erasure](https://gdpr-info.eu/art-17-gdpr/) — official regulation text
- [GDPR Art. 20 — Right to data portability](https://gdpr-info.eu/art-20-gdpr/) — official regulation text
- [Recharts accessibility wiki](https://github.com/recharts/recharts/wiki/Recharts-and-accessibility) — `accessibilityLayer`, `role="application"` pattern
- Direct codebase inspection: `strava-oauth/index.ts`, `hevy-sync/index.ts`, `stripe-checkout/index.ts`, `supabase/functions/_shared/cors.ts`, `supabase/migrations/20260216_integrations.sql`, `vite.config.ts`, `playwright.config.ts`, `Navigation.tsx`
- npm registry (verified 2026-02-27): motion@12.34.3, @axe-core/playwright@4.11.1, @playwright/test@1.58.2, @sentry/vite-plugin@5.1.1, vitest@4.0.18

### Secondary (MEDIUM confidence)

- [GDPR Right to Erasure enforcement priority 2025](https://www.compliancepoint.com/privacy/gdpr-right-to-erasure-an-enforcement-priority-in-2025/) — 2025 CEF enforcement focus context
- [Feature gating best practices](https://www.withorb.com/blog/feature-gating) — showcase locked features, not hard errors; soft limits over hard blocks
- [Content moderation best practices 2025](https://arena.im/uncategorized/content-moderation-best-practices-for-2025/) — manual-first approach for small communities; 10-20% false positive rate for automated systems
- [Supabase user self-deletion guide](https://blog.mansueli.com/supabase-user-self-deletion-empower-users-with-edge-functions) — Edge Function deletion pattern
- [SaaS Privacy Compliance 2025](https://secureprivacy.ai/blog/saas-privacy-compliance-requirements-2025-guide) — GDPR requirements for SaaS

### Tertiary (needs validation during implementation)

- Stripe customer deletion vs retention requirements — verify against Stripe's data processing addendum before building account-delete Edge Function; specific field-level retention rules not confirmed
- Garmin webhook security model — less documented than Stripe; shared-secret approach is a pragmatic mitigation; confirm registration flow and available security mechanisms with Garmin Connect API docs before implementation

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
