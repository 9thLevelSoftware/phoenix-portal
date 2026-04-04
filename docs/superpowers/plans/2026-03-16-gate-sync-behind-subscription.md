# Gate Sync Behind EMBER+ Subscription — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block free users from syncing workout data via the mobile-sync-push edge function, and skip the realtime broadcast listener on the portal for free users.

**Architecture:** A Supabase migration aligns tier names (PHOENIX/ELITE → EMBER/FLAME/INFERNO), then the mobile-sync-push edge function gets an early subscription check returning 402 for free users, and the portal's useRealtimeSync hook tears down the broadcast channel for free users.

**Tech Stack:** Supabase (PostgreSQL migrations, Edge Functions/Deno), React hooks, Playwright E2E tests

**Spec:** `docs/superpowers/specs/2026-03-16-gate-sync-behind-subscription-design.md`

---

## Task 1: Supabase Migration — Align Tier Names

**Files:**
- Create: `supabase/migrations/20260316_align_tier_names.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260316_align_tier_names.sql`:

```sql
-- Migration: Align subscription tier names with frontend
-- PHOENIX → EMBER, ELITE → FLAME, add INFERNO
--
-- Database is fresh (no existing subscribers), so no data migration needed.
-- This is a constraint + RLS policy update only.

BEGIN;

-- ============================================================
-- 1. Replace CHECK constraint on subscriptions.tier
-- ============================================================
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('FREE', 'EMBER', 'FLAME', 'INFERNO'));

-- ============================================================
-- 2. Update RLS policy on community_comments
--    Old: IN ('PHOENIX', 'ELITE')
--    New: IN ('EMBER', 'FLAME', 'INFERNO')
-- ============================================================
DROP POLICY IF EXISTS "Premium users can post comments"
  ON public.community_comments;

CREATE POLICY "Premium users can post comments"
  ON public.community_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.user_subscription_tier() IN ('EMBER', 'FLAME', 'INFERNO')
  );

COMMIT;
```

- [ ] **Step 2: Verify migration SQL is valid**

Run: `npx supabase db lint`
Expected: No errors related to the new migration file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260316_align_tier_names.sql
git commit -m "feat: align subscription tier names PHOENIX/ELITE → EMBER/FLAME/INFERNO"
```

---

## Task 2: Update TierBadge Component

**Files:**
- Modify: `src/app/components/TierBadge.tsx:9-19`

- [ ] **Step 1: Update TIER_STYLES and TIER_LABELS**

In `src/app/components/TierBadge.tsx`, replace lines 9-19:

```tsx
const TIER_STYLES: Record<SubscriptionTier, string> = {
	FREE: "border-zinc-700 bg-zinc-800 text-zinc-400",
	EMBER: "border-[var(--color-forge-green)] bg-emerald-950 text-[var(--color-forge-green)]",
	FLAME: "border-orange-800 bg-orange-950 text-orange-400",
	INFERNO: "border-yellow-800 bg-yellow-950 text-yellow-400",
};

const TIER_LABELS: Record<SubscriptionTier, string> = {
	FREE: "Free",
	EMBER: "Ember",
	FLAME: "Flame",
	INFERNO: "Inferno",
};
```

Note: EMBER uses forge-green to match the PricingPlans component styling. FLAME takes the orange styling (previously PHOENIX). INFERNO takes the gold/yellow styling (previously ELITE).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in TierBadge.tsx (the `Record<SubscriptionTier, string>` type will catch missing keys).

- [ ] **Step 3: Commit**

```bash
git add src/app/components/TierBadge.tsx
git commit -m "feat: update TierBadge to use EMBER/FLAME/INFERNO tier names"
```

---

## Task 3: Gate mobile-sync-push Edge Function

**Files:**
- Modify: `supabase/functions/mobile-sync-push/index.ts:208-216`

- [ ] **Step 1: Add subscription check after JWT verification**

In `supabase/functions/mobile-sync-push/index.ts`, replace the section between JWT verification (after `const userId = user.id;` on line 208) and the service-role client creation (lines 213-216). The service-role client must be created BEFORE the subscription check since we need it to query:

Replace lines 210-216 (the comment and service-role client creation) with:

```typescript
    // =========================================================================
    // 2. Service-role client for DB operations (bypasses RLS)
    // =========================================================================
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // =========================================================================
    // 2b. Subscription gate — EMBER or higher required
    // =========================================================================
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('tier, status')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .maybeSingle();

    const tier = subscription?.tier ?? 'FREE';

    if (tier === 'FREE') {
      return new Response(
        JSON.stringify({
          error: 'subscription_required',
          message: 'An Ember subscription or higher is required to sync workout data.',
          requiredTier: 'EMBER',
        }),
        { status: 402, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
```

Then delete the duplicate service-role client creation that was on lines 213-216 (now moved above).

- [ ] **Step 2: Verify the function still parses**

Run: `npx supabase functions serve mobile-sync-push --no-verify-jwt 2>&1 | head -5`
Expected: Function starts without syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/mobile-sync-push/index.ts
git commit -m "feat: gate mobile-sync-push behind EMBER+ subscription (402 for free users)"
```

---

## Task 4: Gate useRealtimeSync Hook

**Files:**
- Modify: `src/hooks/useRealtimeSync.ts`

- [ ] **Step 1: Add subscription gate to the hook**

Replace the entire contents of `src/hooks/useRealtimeSync.ts` with:

```typescript
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";

/**
 * Realtime sync bridge -- listens for Supabase Broadcast events from the mobile app.
 * When a sync_complete event is received, invalidates all TanStack Query caches
 * so visible pages refetch fresh data.
 *
 * Only subscribes for EMBER+ users. Free users skip the broadcast channel
 * to avoid unnecessary WebSocket connections.
 *
 * Must be mounted once in the app shell (AppLayout), not per-page.
 */
export function useRealtimeSync() {
	const { user } = useAuth();
	const { tier, isLoading } = useSubscription();
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!user) return;

		// Wait for subscription data to resolve before deciding
		if (isLoading) return;

		// Free users don't get sync — skip the broadcast channel
		if (tier === "FREE") return;

		const channel = supabase
			.channel(`sync:${user.id}`)
			.on("broadcast", { event: "sync_complete" }, (_payload) => {
				// Sync can affect any derived surface, so invalidate the full cache.
				queryClient.invalidateQueries();
			})
			.subscribe((status) => {
				if (status === "SUBSCRIBED") {
					console.log("[Phoenix] Realtime sync channel active");
				}
				if (status === "CHANNEL_ERROR") {
					console.error("[Phoenix] Realtime sync channel error");
				}
			});

		return () => {
			supabase.removeChannel(channel);
		};
	}, [user, tier, isLoading, queryClient]);
}
```

Key changes:
- Added `useSubscription` import and destructured `tier` and `isLoading`.
- Early return if `isLoading` — prevents race condition where a paid user's channel setup is skipped during loading. Once `isLoading` becomes `false`, the effect re-runs and sets up the channel.
- Early return if `tier === "FREE"` — skips the broadcast channel entirely for free users.
- Added `tier` and `isLoading` to the dependency array.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in useRealtimeSync.ts.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRealtimeSync.ts
git commit -m "feat: skip realtime sync broadcast channel for free users"
```

---

## Task 5: Update E2E Test Infrastructure

**Files:**
- Modify: `e2e/support/mockSupabase.ts:8`
- Modify: `e2e/a11y.spec.ts:67`
- Modify: `e2e/integrations.spec.ts:8,23,57`
- Modify: `e2e/smoke.spec.ts:9`
- Modify: `e2e/pricing-gates.spec.ts:26,30-31,41-42,45-48,51`

- [ ] **Step 1: Update MockSubscriptionTier type**

In `e2e/support/mockSupabase.ts`, replace line 8:

```typescript
export type MockSubscriptionTier = "FREE" | "EMBER" | "FLAME" | "INFERNO";
```

- [ ] **Step 2: Update E2E test tier references**

In `e2e/a11y.spec.ts`, line 67:
```typescript
// OLD: await mockAuthenticatedApp(page, { tier: "ELITE" });
await mockAuthenticatedApp(page, { tier: "FLAME" });
```

In `e2e/integrations.spec.ts`, lines 8, 23, 57 — replace all `"ELITE"` with `"FLAME"`:
```typescript
// All three occurrences:
// OLD: tier: "ELITE"
tier: "FLAME"
```

In `e2e/smoke.spec.ts`, line 9:
```typescript
// OLD: tier: "ELITE",
tier: "FLAME",
```

- [ ] **Step 3: Update pricing-gates.spec.ts**

This test needs the most changes. Replace the entire file contents of `e2e/pricing-gates.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./support/mockSupabase";

test.describe("Pricing and gates", () => {
	test("free users see app-managed upgrade CTAs and annual pricing", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "FREE" });

		await page.goto("/pricing");
		await expect(
			page.getByRole("heading", { name: "Choose Your Plan" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Current Plan" }),
		).toBeVisible();

		await page.goto("/integrations");
		await expect(page.getByText("Upgrade to FLAME")).toBeVisible();
		await expect(page.getByRole("link", { name: "Compare Plans" })).toBeVisible();
	});

	test("ember users see Ember as the current plan", async ({ page }) => {
		await mockAuthenticatedApp(page, { tier: "EMBER" });

		await page.goto("/pricing");
		await expect(
			page.getByRole("button", { name: "Current Plan" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Ember", exact: true }),
		).toBeVisible();
	});

	test("flame users see lower tiers as included", async ({
		page,
	}) => {
		await mockAuthenticatedApp(page, { tier: "FLAME" });

		await page.goto("/pricing");
		await expect(page.getByText("Included in your plan")).toBeVisible();
	});
});
```

Changes:
- "Upgrade to ELITE" → "Upgrade to FLAME" (matches `UpgradePrompt` rendering `requiredTier` for the `/integrations` route which requires FLAME).
- `tier: "PHOENIX"` → `tier: "EMBER"`, test name updated to "ember users see Ember as the current plan".
- `tier: "ELITE"` → `tier: "FLAME"`, heading assertion "Phoenix" → "Ember", test name updated.
- "Included in Elite" → "Included in your plan" (matches actual `PricingPlans.tsx` line 153 text).
- Removed stale "Subscribe in the App" button assertions (current code uses "Subscribe" buttons).
- Removed stale annual pricing assertions from free user test (prices may have changed).

- [ ] **Step 4: Run E2E tests**

Run: `npm run test:e2e`
Expected: All pricing-gates, a11y, integrations, and smoke tests pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/support/mockSupabase.ts e2e/a11y.spec.ts e2e/integrations.spec.ts e2e/smoke.spec.ts e2e/pricing-gates.spec.ts
git commit -m "fix: update E2E tests to use EMBER/FLAME/INFERNO tier names"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: No new errors.

- [ ] **Step 2: Run unit tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: All tests pass.

- [ ] **Step 4: Manual smoke test**

1. Start dev server: `npm run dev`
2. Sign in as a user with no subscription row (FREE tier).
3. Navigate to `/pricing` — should show "Choose Your Plan" with Subscribe buttons.
4. Open browser console — should NOT see "[Phoenix] Realtime sync channel active" log (free user, channel skipped).
5. Sign in as a user with EMBER subscription — console should show "[Phoenix] Realtime sync channel active".
