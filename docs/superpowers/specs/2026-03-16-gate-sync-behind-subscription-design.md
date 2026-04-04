# Gate Sync Behind EMBER+ Subscription

**Date:** 2026-03-16
**Status:** Approved

## Problem

Free users can sync workout data from the mobile app, consuming database and edge function resources. Only EMBER tier or higher should be able to sync.

Additionally, the database tier constraint uses legacy names (`PHOENIX`, `ELITE`) that don't match the frontend tier names (`EMBER`, `FLAME`, `INFERNO`). This must be fixed first.

## Design

### 1. Fix Tier Name Mismatch (prerequisite)

New Supabase migration `supabase/migrations/<timestamp>_align_tier_names.sql`:

- Drop and recreate the CHECK constraint on `subscriptions.tier` from `('FREE', 'PHOENIX', 'ELITE')` to `('FREE', 'EMBER', 'FLAME', 'INFERNO')`.
- Update all RLS policies referencing `PHOENIX`/`ELITE` to use `EMBER`/`FLAME`/`INFERNO`. Known location:
  - `20260218_phase11_comments.sql` policy uses `IN ('PHOENIX', 'ELITE')` -- update to `IN ('EMBER', 'FLAME', 'INFERNO')`.
- No data migration needed (fresh database, no existing subscribers).
- Note: `check_goal_limit()` trigger only checks `IF tier = 'FREE'`, so it is unaffected.

Frontend files also referencing legacy tier names:
- `src/app/components/TierBadge.tsx` -- `TIER_STYLES` and `TIER_LABELS` use `PHOENIX`/`ELITE` keys, must update to `EMBER`/`FLAME`/`INFERNO`.

E2E test infrastructure:
- `e2e/support/mockSupabase.ts` -- `MockSubscriptionTier` type uses `PHOENIX`/`ELITE`.
- `e2e/a11y.spec.ts`, `e2e/integrations.spec.ts`, `e2e/smoke.spec.ts` -- use `"ELITE"` as tier value.
- `e2e/pricing-gates.spec.ts` -- uses both `"PHOENIX"` and `"ELITE"`, asserts on tier-specific UI text.

All must be updated to use `EMBER`/`FLAME`/`INFERNO`.

### 2. Edge Function Gate (`mobile-sync-push`)

File: `supabase/functions/mobile-sync-push/index.ts`

After JWT verification (existing step 1), add a subscription tier check:

1. Create the service-role client (moved up from its current position).
2. Query `subscriptions` table for the authenticated user where status is `active` or `trialing`.
3. If no row exists or tier is `FREE`, return HTTP 402 with structured error:
   ```json
   {
     "error": "subscription_required",
     "message": "An Ember subscription or higher is required to sync workout data.",
     "requiredTier": "EMBER"
   }
   ```
4. If tier is `EMBER`, `FLAME`, or `INFERNO` with status `active` or `trialing`, proceed with sync.

**Design decision:** Users with `past_due` status are blocked from syncing. This is intentional -- if payment has failed, sync access is revoked until payment is resolved. This aligns with how the `user_subscription_tier()` function works (only returns a tier for `active` or `trialing` status).

### 3. Portal-Side Gate (`useRealtimeSync`)

File: `src/hooks/useRealtimeSync.ts`

- Import `useSubscription` from `@/hooks/useSubscription`.
- Subscribe to the broadcast channel unconditionally when authenticated.
- Once subscription data resolves (`isLoading === false`) and tier is confirmed `FREE`, tear down the channel.
- This avoids a race condition where a paid user misses sync events during the loading window.

### 4. Out of Scope

- RLS policies on `workout_sessions` INSERT -- the edge function uses service role (bypasses RLS), and the mobile app doesn't write directly via the Supabase client. **Invariant:** if the mobile app ever switches to direct Supabase client writes, an RLS-level gate must be added.
- `useSubscription` hook -- already typed with `EMBER | FLAME | INFERNO`.
- `PricingPlans` component -- already correct.
- Mobile app changes -- the mobile app will receive the 402 error and handle it on its side.
- Stale comments in `20260303_revenuecat_schema_migration.sql` referencing legacy tier names -- cosmetic, can be cleaned up separately.

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<timestamp>_align_tier_names.sql` | New migration: fix tier constraint + RLS policies |
| `supabase/functions/mobile-sync-push/index.ts` | Add subscription check before sync |
| `src/hooks/useRealtimeSync.ts` | Gate broadcast listener for free users |
| `src/app/components/TierBadge.tsx` | Update TIER_STYLES and TIER_LABELS to EMBER/FLAME/INFERNO |
| `e2e/support/mockSupabase.ts` | Update MockSubscriptionTier type |
| `e2e/a11y.spec.ts` | Update tier references |
| `e2e/integrations.spec.ts` | Update tier references |
| `e2e/smoke.spec.ts` | Update tier references |
| `e2e/pricing-gates.spec.ts` | Update tier references and UI text assertions |

## Success Criteria

- Free users calling `mobile-sync-push` receive 402 with structured error.
- EMBER+ users can sync normally (no regression).
- Free users on the portal do not hold open a realtime broadcast channel.
- Database tier constraint accepts `EMBER | FLAME | INFERNO` instead of `PHOENIX | ELITE`.
- TierBadge component renders correct labels for new tier names.
- E2E tests pass with updated tier names.
