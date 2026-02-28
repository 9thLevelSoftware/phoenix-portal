# Project Research Summary

**Project:** Phoenix Portal v1.3 — RevenueCat Billing Migration
**Domain:** Subscription billing migration (Stripe → RevenueCat) for web companion app
**Researched:** 2026-02-28
**Confidence:** HIGH

## Executive Summary

Phoenix Portal currently uses Stripe for web-based subscription billing with 3 Edge Functions, a `subscriptions` table, and client-side `@stripe/stripe-js`. The mobile app already uses RevenueCat and writes to a separate `user_subscriptions` table. The v1.3 migration makes the portal a subscription status **consumer** — billing moves entirely to the mobile app via RevenueCat, and the portal stops being a checkout flow.

**Key finding: Zero new npm packages.** The portal needs no RevenueCat client SDK because it never initiates purchases. The migration is a net reduction: remove `@stripe/stripe-js`, replace 3 Stripe Edge Functions with 1 RevenueCat webhook handler, evolve the `subscriptions` table schema in place. The `useSubscription` hook interface stays identical, meaning 15+ consumer components (SubscriptionGate, TierBadge, all gated pages) need zero changes.

The critical risk is the database migration: `user_subscription_tier()` is a SECURITY DEFINER function used by RLS policies for comments and goals. If it returns wrong values during migration, all users are treated as FREE. The migration must be atomic (single transaction). The second risk is webhook delivery delays — RevenueCat webhooks can lag 6+ hours for initial events, vs Stripe's near-instant delivery. A hybrid webhook + REST API verification approach mitigates this.

## Key Findings

### Recommended Stack

**Remove:** `@stripe/stripe-js` (npm), `src/lib/stripe.ts`, 3 Stripe Edge Functions, 11 Stripe environment variables, `stripe_customer_id` column.

**Add:** 1 Edge Function (`revenuecat-webhooks`), 2 environment variables (`REVENUECAT_WEBHOOK_AUTH_KEY`, `REVENUECAT_API_KEY`), ~5 new columns on `subscriptions` table.

**No new npm packages. No RevenueCat client SDK.**

### Expected Features

**Table stakes (must ship atomically):**
- RevenueCat webhook Edge Function with auth + REST API verification
- Database migration: evolve `subscriptions` table (drop Stripe cols, add RC cols)
- `useSubscription` hook: same interface, new data source mapping
- PricingPlans: "subscribe in app" CTAs replacing checkout buttons
- Profile: remove Stripe portal, show subscription status
- UpgradePrompt: "subscribe in app" messaging
- Product/entitlement-to-tier mapping in `src/lib/pricing.ts`
- Delete Stripe Edge Functions, uninstall `@stripe/stripe-js`
- Replace webhook tests

**Differentiators (post-verification):**
- Grace period / billing issue UI banner
- Smart app store redirect (iOS/Android detection)
- Subscription sync health check via REST API

**Anti-features (do NOT build):**
- RevenueCat Web SDK (`purchases-js`) — portal doesn't initiate purchases
- Dual billing (Stripe + RevenueCat) — one source of truth
- Client-side RevenueCat API calls — exposes secret key

### Architecture Approach

**Recommended: Evolve the existing `subscriptions` table in place** (ARCHITECTURE.md Option A). Drop Stripe-specific columns, add RevenueCat columns, keep table name and column names (`tier`, `status`, `current_period_end`, `cancel_at_period_end`) identical. This means:
- `user_subscription_tier()` SQL function: **NO CHANGE** needed
- RLS policies: **NO CHANGE** needed
- Supabase Realtime channel: **NO CHANGE** needed
- `useSubscription` hook: minimal changes (may need status mapping)
- All 15+ consumer components: **NO CHANGE** needed

The webhook handler uses entitlement-based tier mapping (not product-based) because entitlements are cross-platform while product IDs are platform-specific.

### Critical Pitfalls

1. **Dual subscription table confusion** — Two tables exist (`subscriptions` + `user_subscriptions`). Evolving `subscriptions` in place avoids all RLS/hook/Realtime breakage.
2. **Webhook delivery delays** — RevenueCat webhooks can lag 6+ hours. Mitigate with REST API verification on critical events + manual refresh button.
3. **Existing Stripe subscribers** — Must handle gracefully: set `cancel_at_period_end = true`, keep Stripe webhook handler alive until zero active Stripe subs.
4. **app_user_id mismatch** — If mobile app doesn't use Supabase auth.uid as RevenueCat appUserId, the entire integration breaks. Must verify with mobile team.
5. **delete-account breaks** — Edge Function imports Stripe at module level; will crash if Stripe secrets are removed. Must update before removing env vars.

## Implications for Roadmap

### Phase 21: Database Schema & Webhook Handler
**Rationale:** Foundation — everything reads from the database. Must be working before UI changes.
**Delivers:** Database migration (evolve `subscriptions` table), RevenueCat webhook Edge Function with auth + entitlement mapping + idempotency, webhook handler tests.
**Addresses:** Core data pipeline, entitlement-to-tier mapping.
**Avoids:** Pitfall 1 (dual table), Pitfall 4 (RLS gap), Pitfall 8 (idempotency).

### Phase 22: UI Migration & Stripe Removal
**Rationale:** After webhook handler is verified, update all UI touchpoints, then remove Stripe infrastructure.
**Delivers:** PricingPlans rewrite ("subscribe in app"), Profile subscription management update, UpgradePrompt CTA update, delete-account Edge Function update, Stripe Edge Functions deletion, `@stripe/stripe-js` removal, CSP cleanup, legal page updates, data export updates, env var cleanup.
**Addresses:** All UI touchpoints, Stripe decommission, legal accuracy.
**Avoids:** Pitfall 7 (incomplete removal), Pitfall 10 (delete-account crash), Pitfall 13 (legal pages).

### Phase 23: Verification & Polish
**Rationale:** After core migration is complete, add reliability features and verify end-to-end.
**Delivers:** Manual subscription refresh button, grace period / billing issue banner, comprehensive E2E testing of subscription flows, database types regeneration.
**Addresses:** Webhook delay mitigation, degraded state UX.
**Avoids:** Pitfall 2 (stale status), Pitfall 9 (Realtime breakage).

### Phase Ordering Rationale

- Database migration MUST come before webhook handler (handler writes to the table)
- Webhook handler MUST be verified before UI changes (UI depends on data flowing correctly)
- UI updates MUST complete before Stripe deletion (Stripe imports must be removed from all consumers first)
- delete-account update MUST happen before Stripe env var removal (otherwise it crashes)
- Legal page updates can happen in parallel with UI migration

### Research Flags

Phases needing deeper research during planning:
- **Phase 21:** Confirm `app_user_id` mapping with mobile team; confirm exact entitlement IDs from RevenueCat dashboard
- **Phase 22:** Audit existing Stripe subscribers for migration path

Standard patterns (skip research-phase):
- **Phase 22:** UI component updates are straightforward find-and-replace
- **Phase 23:** REST API verification is well-documented

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new packages confirmed. RevenueCat SDK explicitly not needed. |
| Features | HIGH | Full codebase audit with specific file/line citations. 14+ Stripe touchpoints mapped. |
| Architecture | HIGH | Option A (evolve subscriptions table) verified: zero changes to RLS, Realtime, useSubscription interface. |
| Pitfalls | HIGH | 15 pitfalls identified with specific prevention strategies. Community reports on webhook delays verified. |

**Overall confidence:** HIGH

### Gaps to Address

- **app_user_id mapping:** Confirm mobile app calls `Purchases.logIn(supabaseUserId)`. If not, need mapping table. BLOCKER.
- **Entitlement IDs:** Assumed `phoenix_access` / `elite_access`. Actual names from RevenueCat dashboard needed before webhook handler.
- **Existing Stripe subscribers:** Need to know count and migration timeline before decommissioning Stripe.
- **RevenueCat Pro plan:** Webhooks require Pro plan (free under $2,500 MTR). Confirm plan is active.

## Sources

### Primary (HIGH confidence)
- RevenueCat Webhooks docs — event types, payload structure, retry behavior, auth model
- RevenueCat Entitlements docs — entitlement-to-product mapping, cross-platform pattern
- RevenueCat REST API v1 — subscriber endpoint, rate limits, stability guarantee
- RevenueCat Community — webhook security, Supabase integration, delay reports
- Codebase audit — 14+ files with Stripe references, database schema, RLS policies

### Secondary (MEDIUM confidence)
- RevenueCat pricing — Pro plan requirements, MTR thresholds
- Existing `user_subscriptions` table schema — inferred from `database.types.ts`

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
