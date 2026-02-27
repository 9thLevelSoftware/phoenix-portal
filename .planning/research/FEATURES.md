# Feature Research: v1.2 Launch Readiness Hardening

**Domain:** Security, legal compliance, accessibility, operational infrastructure for premium SaaS web app
**Researched:** 2026-02-27
**Confidence:** HIGH

## Scope

This research covers ONLY the new features needed for v1.2 launch readiness, as identified by the Board of Directors resolution. All existing features (analytics, community, session replay, billing, PWA, etc.) are considered shipped. The focus is on what's missing to responsibly accept payments from real users.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist when they pay money for a SaaS product. Missing any of these is a launch blocker.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|------------|-------|
| **Privacy Policy (rewritten)** | Legal requirement; current policy says "we collect nothing" while storing data in Supabase with Sentry, Stripe, and 4 OAuth providers | LOW | Nothing | The existing `PrivacyPolicy.tsx` is the mobile app's policy, not the portal's. Must be rewritten from scratch to disclose: Supabase data storage, Stripe payment processing, Sentry error monitoring, OAuth data from Strava/Fitbit/Garmin/Hevy, cookies/local storage, biometric/health data handling. Board P0 item. |
| **Terms of Service** | Cannot legally charge customers without ToS. Stripe requires merchant ToS. | LOW | Nothing | No ToS exists anywhere in the codebase. Needs: acceptable use policy, subscription terms, refund policy, limitation of liability, content ownership for community-shared routines, data retention. Board P0 item. |
| **Pricing consistency fix** | $9.99 on landing page vs $14.99 on pricing page destroys trust | LOW | Nothing | Not a feature build -- just a content fix. But it's a P0 blocker. Board P0 item. |
| **Free-tier gating enforcement** | Pricing page promises limits (e.g., 30 sessions of history) that code doesn't enforce | MEDIUM | Existing `SubscriptionGate` component | Current `SubscriptionGate` only gates entire features (PHOENIX/ELITE). Free tier needs usage-limit enforcement: capped history, restricted analytics depth, limited community interactions. Must enforce at both UI and RLS level. Board P0 item. |
| **CI/CD pipeline** | Any SaaS accepting payments needs automated build/test/deploy with rollback capability | MEDIUM | Existing Vitest + Playwright configs | No GitHub Actions workflows exist. Need: PR validation (biome lint + vitest + playwright), deploy gate, environment secrets management. Playwright config already supports CI mode (`forbidOnly`, `retries: 2`, `workers: 1`). Board P1 item. |
| **GDPR data export** | Article 20 (right to data portability). EU users can request all their data in machine-readable format | MEDIUM | Supabase Edge Functions | Must export: profile, workout history, personal records, routines, cycles, goals, community posts/comments, integration data. CSV export for workouts already exists (v1.0), but GDPR export needs ALL data, not just workouts. Edge Function to compile and deliver as ZIP. Board P1 item. |
| **GDPR account deletion** | Article 17 (right to erasure). 2025 GDPR enforcement priority. Must delete across ALL systems including Stripe and Sentry | HIGH | Supabase Edge Functions, Stripe API, Sentry API | Must cascade: Supabase user data (all tables), Supabase Auth account, Stripe customer record, Sentry user data, OAuth tokens at third-party providers. Must handle: confirmation flow, grace period (30 days recommended), data that must be retained for legal/tax purposes (invoices). Board P1 item. |
| **Basic support infrastructure (FAQ + contact)** | Paying customers need a way to get help | LOW | Nothing | No FAQ page, no contact form, no support email exists. Minimum: static FAQ page covering common questions (billing, data sync, account management), contact form that sends to a shared inbox (Supabase Edge Function to email, or embed a form service). Board P1 item. |
| **Content moderation (report/flag/block)** | Community features without moderation tools are a liability | MEDIUM | Existing community components | Zero report/flag/block mechanisms exist in the community components. Need: report button on community posts and comments, report categories (spam, offensive, copyright, other), user blocking (client-side mute + server-side), admin review queue (can be simple DB table + future admin UI). Board P2 item but should be P1 for paid launch -- community content is user-generated. |

### Differentiators (Competitive Advantage)

Features that go beyond baseline expectations and demonstrate product maturity.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| **Reduced-motion support** | 35% of adults over 40 experience vestibular dysfunction. Framer Motion's `MotionConfig` with `reducedMotion="user"` automatically disables transform/layout animations while preserving opacity. Shows care for accessibility beyond checkbox compliance. | LOW | Nothing | Zero `prefers-reduced-motion` support exists. Framer Motion provides `useReducedMotion` hook and `MotionConfig reducedMotion="user"` prop. Wrapping the app's `MotionConfig` provider is the simplest approach -- one change, global effect. Custom CSS animations (`animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow`) also need `@media (prefers-reduced-motion: reduce)` overrides in theme.css. |
| **Chart accessibility** | Recharts 3.x has `accessibilityLayer` enabled by default, but charts need descriptive `aria-label` attributes and `role="application"` for JAWS/NVDA Forms Mode. Tabular data fallbacks for screen readers make data truly accessible. | MEDIUM | Existing Recharts/visx charts | Currently only one `aria-label` exists across all chart components (Analytics time period selector). Each chart container needs `role="img"` with descriptive `aria-label` summarizing the data, or `role="application"` for keyboard-navigable charts. visx force curves (Canvas-based) need separate text descriptions since Canvas is opaque to screen readers. |
| **Skip-to-content link** | Keyboard users can bypass the 13-item navigation. Standard WCAG 2.1 AA requirement that most SaaS apps implement. | LOW | Nothing | Does not exist. A visually-hidden link at the top of the page that becomes visible on focus, jumping past the navigation to `main` content. Single component, ~20 lines. |
| **Desktop navigation restructure** | 13 flat navigation items violates Hick's Law. Grouped navigation with collapsible sections reduces cognitive load and scales better for future features. | MEDIUM | Nothing | Current `Navigation.tsx` renders 13 `NavLink` items in a flat horizontal bar. shadcn/ui provides a sidebar component. Recommended grouping: **Training** (Dashboard, History, Records), **Analysis** (Analytics, Biomechanics, Recovery), **Program** (Routines, Cycles, Goals, Challenges), **Social** (Community, Integrations), **Account** (Profile). Switch from horizontal nav bar to collapsible sidebar. |
| **Stripe billing path test coverage** | Revenue-critical path is the least tested path. Integration tests for webhook handling prove the payment pipeline works. | MEDIUM | Existing Stripe Edge Functions | Zero test coverage on Stripe checkout, portal, or webhook handlers. Need: mock webhook payloads for all 5 event types, verify subscription state transitions, test checkout redirect flow. Can use Stripe's test mode and fixtures. |
| **Cookie consent banner** | Required by GDPR for any cookies or tracking. Sentry and Supabase auth both use cookies/local storage. | LOW | Privacy Policy | Simple banner with accept/reject, stores preference in localStorage. No third-party consent management needed at this scale. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem valuable but would cause more harm than good at this stage.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Full admin dashboard** | Content moderation and user management seem to need admin UI | Massive scope (user list, ban management, content review, analytics, support tickets). Solo developer doesn't need a UI to query their own database. | Use Supabase Studio dashboard for admin queries. Store report/flag data in DB tables. Build admin UI in a future milestone when scale demands it. |
| **AI-powered content moderation** | Automated detection of toxic content in community posts/comments | Requires ML infrastructure, ongoing training, false positive management. Community is niche (fitness enthusiasts sharing routines) -- toxicity risk is low. | Manual moderation via report queue. Community self-policing through report/flag system. Block feature for user-level muting. |
| **Real-time chat / support widget** | Live support for paying customers | High ongoing cost, requires staffing, creates SLA expectations a solo developer cannot meet. Intercom/Zendesk adds $50-200/mo overhead. | FAQ page + contact form to shared inbox. Set expectation of 24-48hr response time. Discord server for community support. |
| **SOC 2 / ISO 27001 certification** | Enterprise compliance checkbox | Costs $10K-50K for audit. Overkill for a niche fitness companion app with <1000 users. No enterprise customers requiring it. | Document security practices in a public security page. GDPR compliance covers the actual user rights. Revisit only if enterprise customers appear. |
| **Multi-language / i18n** | Expand to non-English markets | Vitruvian Trainer community is predominantly English-speaking (AU/US/UK/EU markets). Translation maintenance cost for a solo developer is unsustainable. | English-only. Revisit only if non-English community segment grows significantly. |
| **Automated GDPR data processing records** | Full GDPR Article 30 compliance | Requires Data Protection Officer, formal processing records, ongoing documentation. Proportionality principle: small-scale processing by a solo developer doesn't require the same level as a large enterprise. | Maintain a simple data map document. Update Privacy Policy when data practices change. Respond to individual requests manually. |
| **Feature flag service (LaunchDarkly, etc.)** | Dynamic feature gating without deploys | Over-engineered for this use case. Subscription gating is the feature flag. Adding a third-party service adds cost, complexity, and a runtime dependency for something that changes rarely. | Use existing `SubscriptionGate` component with tier-based gating. Hard-code limits in a config file. Change limits via deploy. |
| **PII scrubbing in Sentry** | CSO flagged health/biometric data in error reports | Sentry's `beforeSend` callback can strip PII, but over-scrubbing makes error reports useless. The real risk is low -- Sentry captures error context, not full workout data. | Add `beforeSend` to strip `user.email` and any `body` fields containing workout data. Don't scrub everything -- keep stack traces and component names. Low priority, not a launch blocker. |

---

## Feature Dependencies

```
Privacy Policy (rewrite)
    └── Cookie Consent Banner (references privacy policy for details)
    └── GDPR Data Export (privacy policy must disclose export right)
    └── GDPR Account Deletion (privacy policy must disclose deletion right)

Terms of Service
    └── Content Moderation (ToS defines acceptable use policy that moderation enforces)

Free-Tier Gating Enforcement
    └── Pricing Consistency Fix (must know the final limits before coding them)

CI/CD Pipeline
    └── Stripe Billing Tests (tests run in CI pipeline)

Content Moderation (report/flag/block)
    └── Community features (already built -- moderation adds to existing components)

Desktop Nav Restructure
    (independent -- no dependencies, no dependents for v1.2)

Accessibility (reduced-motion, skip-to-content, chart a11y)
    (independent -- each can be done separately, no cross-dependencies)

GDPR Account Deletion
    └── requires Supabase Edge Function
    └── requires Stripe Customer API integration
    └── requires cascade logic across all DB tables
```

### Dependency Notes

- **Cookie Consent requires Privacy Policy:** The consent banner links to the privacy policy for details on what cookies/tracking are used. Write the policy first.
- **GDPR export/deletion require Privacy Policy:** The privacy policy must disclose these rights before the features can be offered. Policy first, features second.
- **Content Moderation requires Terms of Service:** The ToS defines what content is acceptable. Moderation enforces those rules. Write ToS first.
- **Free-tier gating requires pricing fix:** Cannot code usage limits until the actual tier limits are finalized and consistent between landing page and pricing page.
- **Stripe tests require CI/CD:** Tests exist to run in the pipeline. Build the pipeline, then add the tests.
- **GDPR Account Deletion is the most complex dependency chain:** Must cascade across Supabase (15+ tables), Stripe (customer deletion), Sentry (user deletion), and potentially revoke OAuth tokens at third-party providers. This is the highest-risk feature in v1.2.

---

## MVP Definition

### Phase 0: Legal and Security (Must ship before ANY public launch)

- [x] **Pricing consistency fix** -- resolve $9.99 vs $14.99 discrepancy
- [ ] **Privacy Policy rewrite** -- accurate to portal's actual data practices
- [ ] **Terms of Service** -- subscription terms, acceptable use, liability limitation
- [ ] **Free-tier gating enforcement** -- match pricing page promises in code + RLS

### Phase 1: Operational Infrastructure (Must ship before paid tiers activate)

- [ ] **CI/CD pipeline** -- GitHub Actions with build, lint, test, deploy gates
- [ ] **GDPR data export** -- Edge Function to compile all user data as downloadable ZIP
- [ ] **GDPR account deletion** -- cascade deletion across all systems with 30-day grace period
- [ ] **FAQ + contact form** -- static FAQ page and contact form to shared inbox
- [ ] **Content moderation** -- report/flag/block on community posts and comments
- [ ] **Stripe billing tests** -- webhook integration tests for all 5 event types
- [ ] **Cookie consent banner** -- GDPR-compliant consent with accept/reject

### Phase 2: UX and Accessibility (Should ship before scale)

- [ ] **Reduced-motion support** -- `MotionConfig reducedMotion="user"` + CSS overrides
- [ ] **Skip-to-content link** -- keyboard navigation bypass
- [ ] **Chart accessibility** -- aria-labels, role attributes, text descriptions for screen readers
- [ ] **Desktop navigation restructure** -- grouped sidebar replacing flat 13-item horizontal nav

### Defer to v1.3+

- [ ] **Admin dashboard** -- defer until moderation volume justifies a UI
- [ ] **Nested comment threads** -- already deferred from v1.1
- [ ] **PII scrubbing in Sentry** -- low risk, add `beforeSend` filter when time permits

---

## Feature Prioritization Matrix

| Feature | User Value | Legal/Compliance Value | Implementation Cost | Priority |
|---------|------------|------------------------|---------------------|----------|
| Privacy Policy rewrite | LOW (users rarely read) | CRITICAL (launch blocker) | LOW | **P0** |
| Terms of Service | LOW (users rarely read) | CRITICAL (launch blocker) | LOW | **P0** |
| Pricing consistency fix | MEDIUM (trust) | HIGH (deceptive pricing) | LOW | **P0** |
| Free-tier gating enforcement | MEDIUM (fairness) | HIGH (false advertising) | MEDIUM | **P0** |
| CI/CD pipeline | LOW (invisible) | HIGH (operational safety) | MEDIUM | **P1** |
| GDPR data export | LOW (rarely used) | HIGH (legal requirement) | MEDIUM | **P1** |
| GDPR account deletion | LOW (rarely used) | HIGH (2025 enforcement priority) | HIGH | **P1** |
| FAQ + contact form | MEDIUM (support expectation) | MEDIUM (customer trust) | LOW | **P1** |
| Content moderation | MEDIUM (community safety) | HIGH (liability) | MEDIUM | **P1** |
| Stripe billing tests | LOW (invisible) | HIGH (revenue protection) | MEDIUM | **P1** |
| Cookie consent banner | LOW (annoyance) | MEDIUM (GDPR compliance) | LOW | **P1** |
| Reduced-motion support | HIGH (a11y) | MEDIUM (WCAG 2.1 AA) | LOW | **P2** |
| Skip-to-content link | MEDIUM (a11y) | MEDIUM (WCAG 2.1 AA) | LOW | **P2** |
| Chart accessibility | MEDIUM (a11y) | MEDIUM (WCAG 2.1 AA) | MEDIUM | **P2** |
| Desktop nav restructure | HIGH (UX) | LOW | MEDIUM | **P2** |

**Priority key:**
- **P0:** Must have before any public launch (legal/compliance blockers)
- **P1:** Must have before paid tiers activate (operational/safety requirements)
- **P2:** Should have before scale (UX/accessibility improvements)

---

## Competitor Feature Analysis

The competitive landscape for Phoenix Portal is unusual: it serves a niche community of Vitruvian Trainer owners whose machines lost official software support. Direct competitors are other fitness analytics platforms.

| Feature | Strava (web) | Fitbod (web) | TrainHeroic | Our Approach |
|---------|--------------|--------------|-------------|--------------|
| Privacy Policy | Comprehensive, lawyer-written | Standard SaaS policy | Detailed with DPA | Must rewrite for portal's actual data practices. Reference Strava's structure as template. |
| Terms of Service | Extensive, covers user content | Standard subscription terms | Includes coach/athlete terms | Standard SaaS ToS covering subscription, content ownership, acceptable use |
| GDPR data export | Bulk export via settings | Account data request | Data download button | Edge Function compiling all user data as ZIP. Offer in Profile/Settings page. |
| Account deletion | Settings > Delete Account | Email request | Settings page | In-app flow with 30-day grace period. Must cascade across Supabase + Stripe. |
| Content moderation | Flag/report on activities | N/A (no community) | Report on programs | Report button on posts/comments, category picker, block user |
| Free tier limits | Time-gated features | 3 free workouts | Limited athlete count | Usage-count limits matching pricing page promises |
| Support | Help center + email | In-app chat | Email + knowledge base | FAQ page + contact form. Appropriate for scale. |
| Reduced motion | Partial | No | No | Full support via MotionConfig. Differentiator over most fitness platforms. |
| Navigation | Left sidebar, grouped | Bottom tabs (mobile-first) | Left sidebar, grouped | Switch to grouped left sidebar. Current 13-item flat bar is worst-in-class. |

---

## Implementation Notes by Feature

### Privacy Policy Rewrite
The existing `PrivacyPolicy.tsx` component has good page structure (header, sections, footer) but entirely wrong content. The mobile app policy says "We do not collect any personal information" and "No Cloud Sync" -- both false for the portal. Rewrite content in-place, keeping the component structure. Must disclose:
- Supabase: account data, workout history, community content stored in cloud Postgres
- Stripe: payment information processed by Stripe (PCI-compliant, Phoenix never sees card numbers)
- Sentry: error reports with device/browser info and potentially user context
- OAuth providers: data synced from Strava, Fitbit, Garmin, Hevy
- Cookies/localStorage: auth tokens, preferences, PWA state
- Health/biometric data: workout metrics, force curves, recovery scores (sensitive data category under GDPR)

### Terms of Service
New page, new route. Mirror the `PrivacyPolicy.tsx` component structure. Key sections: acceptance of terms, account responsibilities, subscription and billing (defer to Stripe terms), community content (user retains ownership, grants license for display), acceptable use, termination, limitation of liability, governing law.

### Free-Tier Gating Enforcement
The `SubscriptionGate` component handles feature-level gating (PHOENIX/ELITE). Free-tier needs usage-level gating: a hook like `useFreeTierLimits` that checks counts against configured limits. Enforce at query level (TanStack Query) and RLS level (Supabase). Show upgrade prompt when limit is reached, not a hard error. Best practice from research: "Don't hide premium features -- showcase them. When a free user attempts a gated action, show exactly what they'd unlock and why it matters."

### CI/CD Pipeline
Playwright config already has CI-aware settings. Vitest is configured in `vite.config.ts`. GitHub Actions workflow needs:
1. **PR validation:** biome check, vitest run, playwright test (Chromium only for speed)
2. **Deploy gate:** only deploy on main after all checks pass
3. **Secrets:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_TEST_EMAIL`, `SUPABASE_TEST_PASSWORD`
4. **Caching:** node_modules (npm lockfile hash), Playwright browsers, Vite build cache

### GDPR Account Deletion (Highest Complexity)
Cascade order matters:
1. Export user data first (offer download before deletion)
2. Cancel Stripe subscription via API
3. Delete Stripe customer record (or anonymize per Stripe retention requirements)
4. Delete all user-owned rows across 15+ Supabase tables (workouts, records, routines, cycles, goals, community posts, comments, integrations, telemetry)
5. Anonymize community content that other users have interacted with (don't delete comments with replies -- set author to "Deleted User")
6. Revoke OAuth tokens at third-party providers
7. Delete Supabase Auth user
8. Clear Sentry user data
9. Send confirmation email
Implement as Supabase Edge Function with transaction-like behavior. 30-day grace period via `deletion_requested_at` column.

### Content Moderation
Minimum viable moderation for a niche community:
- **Report button:** 3-dot menu on community feed cards and comments. Categories: spam, offensive content, copyright violation, other.
- **Block user:** Adds to `blocked_users` table. Blocked user's content hidden client-side. Not a ban -- they can still post, you just don't see them.
- **Report storage:** `content_reports` table with reporter_id, content_type, content_id, category, status (pending/reviewed/dismissed/actioned), created_at.
- **No admin UI yet:** Review reports via Supabase Studio. Build admin UI when volume justifies it.

### Desktop Navigation Restructure
Replace 13-item horizontal `NavLink` bar with grouped sidebar. Use shadcn/ui sidebar component. Categories:
- **Training:** Dashboard, History, Records (daily use)
- **Analysis:** Analytics, Biomechanics, Recovery (deep dive)
- **Program:** Routines, Cycles, Goals, Challenges (planning)
- **Social:** Community, Integrations (connection)
- **Account:** Profile (settings)

Collapsible on desktop (icon-only mode). Persists open/closed state in localStorage. Must not break mobile bottom nav -- sidebar is desktop-only.

### Reduced-Motion Support
Two-part implementation:
1. **Framer Motion:** Wrap app in `<MotionConfig reducedMotion="user">`. This automatically disables transform and layout animations when OS setting is enabled, while preserving opacity transitions. One line of code, global effect.
2. **CSS animations:** Add `@media (prefers-reduced-motion: reduce)` block in `theme.css` to disable `animate-flame-flicker`, `animate-ember-rise`, `animate-phoenix-glow`, and any `animate-pulse` usage.

### Chart Accessibility
Three levels of improvement:
1. **Quick wins:** Add `role="img"` and descriptive `aria-label` to every chart container div (e.g., "Bar chart showing weekly workout volume over the past 8 weeks").
2. **Keyboard nav:** Recharts 3.x `accessibilityLayer` is enabled by default. Add `role="application"` to chart containers for JAWS/NVDA Forms Mode support.
3. **Screen reader fallback:** For complex visx Canvas charts (force curves, session replay), add visually-hidden `<table>` with the underlying data as text alternative.

---

## Sources

- [Supabase GDPR Discussion](https://github.com/orgs/supabase/discussions/2341) -- Supabase compliance status and DPA
- [GDPR Right to Erasure (Art. 17)](https://gdpr-info.eu/art-17-gdpr/) -- Official regulation text
- [GDPR Right to Erasure Enforcement Priority 2025](https://www.compliancepoint.com/privacy/gdpr-right-to-erasure-an-enforcement-priority-in-2025/) -- CEF 2025 focus
- [Recharts Accessibility Wiki](https://github.com/recharts/recharts/wiki/Recharts-and-accessibility) -- accessibilityLayer, keyboard nav, screen reader support
- [Recharts Accessibility Discussion](https://github.com/recharts/recharts/discussions/4484) -- Community discussion on a11y improvements
- [Motion for React Accessibility](https://motion.dev/docs/react-accessibility) -- reducedMotion, useReducedMotion
- [useReducedMotion Hook](https://www.framer.com/motion/use-reduced-motion/) -- Framer Motion API reference
- [Content Moderation Best Practices 2025](https://arena.im/uncategorized/content-moderation-best-practices-for-2025/) -- Hybrid moderation approaches
- [Playwright CI Setup](https://playwright.dev/docs/ci-intro) -- Official CI integration guide
- [SaaS Privacy Compliance 2025](https://secureprivacy.ai/blog/saas-privacy-compliance-requirements-2025-guide) -- Compliance requirements overview
- [WCAG 2.1](https://www.w3.org/TR/WCAG21/) -- Web Content Accessibility Guidelines
- [Feature Gating Best Practices](https://www.withorb.com/blog/feature-gating) -- Hard limits vs soft limits for free tiers

---
*Feature research for: Phoenix Portal v1.2 Launch Readiness*
*Researched: 2026-02-27*
