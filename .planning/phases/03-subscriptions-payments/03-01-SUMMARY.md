---
phase: 03-subscriptions-payments
plan: 01
subsystem: payments, database
tags: [stripe, supabase, edge-functions, rls, subscriptions, webhooks, deno]

# Dependency graph
requires:
  - phase: 01-auth-data-layer
    provides: Supabase client, auth provider, database types
provides:
  - subscriptions table with RLS and tier helper function
  - profiles table with stripe_customer_id
  - stripe-checkout Edge Function (Checkout Session creation)
  - stripe-portal Edge Function (Customer Portal Session creation)
  - stripe-webhooks Edge Function (5 event types with signature verification)
  - config.toml with JWT bypass for webhooks
  - shared CORS module for Edge Functions
affects: [03-02, 03-03, 03-04, 04-biomechanics, 05-training-programs, 06-session-replay]

# Tech tracking
tech-stack:
  added: [stripe@14 (Deno/esm.sh), @supabase/supabase-js@2 (jsr)]
  patterns: [Edge Function with CORS preflight, webhook signature verification with req.text(), RLS tier enforcement via SECURITY DEFINER function, service role key for server-side writes]

key-files:
  created:
    - supabase/migrations/00001_create_subscriptions.sql
    - supabase/config.toml
    - supabase/functions/_shared/cors.ts
    - supabase/functions/stripe-checkout/index.ts
    - supabase/functions/stripe-portal/index.ts
    - supabase/functions/stripe-webhooks/index.ts
  modified: []

key-decisions:
  - "Profiles table created with IF NOT EXISTS for idempotent migration"
  - "getTierFromPriceId reads env vars for price-to-tier mapping (not hardcoded)"
  - "invoice.paid handler retrieves full subscription to update period dates accurately"
  - "Webhook function validates Stripe-Signature header presence before body read"

patterns-established:
  - "Edge Function CORS: shared corsHeaders import from _shared/cors.ts"
  - "Auth pattern: parse Authorization header, create per-request Supabase client"
  - "Webhook pattern: req.text() + constructEventAsync with SubtleCryptoProvider"
  - "Customer lookup: profiles.stripe_customer_id for user-to-Stripe mapping"

# Metrics
duration: 2min
completed: 2026-02-15
---

# Phase 3 Plan 01: Subscription Infrastructure Summary

**Supabase subscriptions table with RLS tier enforcement, plus three Stripe Edge Functions (checkout, portal, webhooks) using Deno imports**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-16T01:13:38Z
- **Completed:** 2026-02-16T01:15:30Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- Subscriptions table with tier/status constraints, RLS, and user_subscription_tier() helper function
- Three Stripe Edge Functions handling checkout session creation, customer portal, and webhook event processing
- Webhook function handles all 5 critical lifecycle events with proper signature verification

## Task Commits

Each task was committed atomically:

1. **Task 1: Create subscriptions migration with RLS and tier helper function** - `1220493` (feat)
2. **Task 2: Create Stripe Edge Functions and config.toml** - `97ca629` (feat)

## Files Created/Modified
- `supabase/migrations/00001_create_subscriptions.sql` - Profiles table, subscriptions table, RLS policies, user_subscription_tier() function, realtime enablement
- `supabase/config.toml` - JWT bypass for stripe-webhooks Edge Function
- `supabase/functions/_shared/cors.ts` - Shared CORS headers for all Edge Functions
- `supabase/functions/stripe-checkout/index.ts` - Creates Stripe Checkout Session with customer lookup/create
- `supabase/functions/stripe-portal/index.ts` - Creates Stripe Customer Portal Session
- `supabase/functions/stripe-webhooks/index.ts` - Processes 5 webhook event types with signature verification

## Decisions Made
- Profiles table uses `IF NOT EXISTS` for idempotent migration (may already exist from future mobile app sync)
- `getTierFromPriceId()` reads price IDs from environment variables rather than hardcoding, so tier mapping works across test/production Stripe accounts
- `invoice.paid` handler retrieves the full subscription object from Stripe to get accurate period dates, rather than just marking status
- Webhook function checks for `Stripe-Signature` header presence before reading body, returning 400 early if missing

## Deviations from Plan

None - plan executed exactly as written.

## User Setup Required

External services require manual configuration before Edge Functions can be deployed:
- **Stripe products and prices:** Create PHOENIX ($14.99/mo, $149.99/yr) and ELITE ($24.99/mo, $249.99/yr) products in Stripe Dashboard
- **Environment variables:** STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SIGNING_SECRET, and 4 price ID env vars must be set as Supabase Edge Function secrets
- **VITE_STRIPE_PUBLISHABLE_KEY:** Must be added to `.env.local` for client-side Stripe integration (future plan 03-02)
- **Webhook endpoint:** Must be configured in Stripe Dashboard pointing to the Supabase Edge Function URL
- **Customer Portal:** Must be enabled in Stripe Dashboard settings

## Next Phase Readiness
- Database schema and Edge Functions are ready for client-side integration (plan 03-02)
- useSubscription hook and SubscriptionGate component can now be built on top of this infrastructure
- Stripe Dashboard configuration is a prerequisite before any end-to-end testing

## Self-Check: PASSED

All 6 created files verified on disk. Both task commits (1220493, 97ca629) confirmed in git log.

---
*Phase: 03-subscriptions-payments*
*Completed: 2026-02-15*
