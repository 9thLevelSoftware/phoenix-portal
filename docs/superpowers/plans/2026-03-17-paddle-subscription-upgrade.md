# Paddle Subscription Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Paddle webhook DB schema and add subscription upgrade support via the Paddle API so users can move from Ember → Flame → Inferno through the pricing UI.

**Architecture:** DB migration adds missing Paddle columns and drops legacy ones. Webhook handler gets column name fixes. A new `paddle-update-subscription` Edge Function calls the Paddle server API to change a subscription's price. The frontend detects active subscriptions and routes to upgrade vs. new checkout accordingly.

**Tech Stack:** Supabase (PostgreSQL, Edge Functions/Deno), Paddle Billing API, React 19, TanStack Query 5, Zustand

**Spec:** `docs/superpowers/specs/2026-03-17-paddle-subscription-upgrade-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260317_paddle_schema_fix.sql` | Create | Add paddle columns, drop legacy columns, fix status constraint |
| `supabase/functions/paddle-webhooks/index.ts` | Modify | Rename `stripe_*` → `paddle_*` in upsert payload |
| `supabase/functions/paddle-update-subscription/index.ts` | Create | New edge function: update subscription via Paddle API |
| `src/app/components/PricingPlans.tsx` | Modify | Upgrade flow + button text changes |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260317_paddle_schema_fix.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260317_paddle_schema_fix.sql`:

```sql
-- Migration: Fix subscriptions table for Paddle billing
-- Adds Paddle-specific columns, drops unused RevenueCat/Stripe legacy columns,
-- and updates status constraint to allow 'none'.

BEGIN;

-- 1. Add Paddle-specific columns
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS price_id TEXT;

-- 2. Drop legacy columns (confirmed empty — no data to migrate)
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS revenuecat_customer_id,
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS entitlement_ids,
  DROP COLUMN IF EXISTS store;

-- 3. Update status constraint to include 'none'
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status = ANY (ARRAY['active', 'past_due', 'canceled', 'trialing', 'incomplete', 'none']));

COMMIT;
```

- [ ] **Step 2: Apply migration to live database**

This migration must be applied to the live Supabase database. Use the Supabase MCP `execute_sql` tool or `supabase db push` to apply it. Verify by querying:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'subscriptions' ORDER BY ordinal_position;
```

Expected: `paddle_customer_id`, `paddle_subscription_id`, `price_id` present. `revenuecat_customer_id`, `product_id`, `entitlement_ids`, `store` absent.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260317_paddle_schema_fix.sql
git commit -m "feat: add Paddle columns to subscriptions table, drop legacy RevenueCat columns"
```

---

## Task 2: Webhook Handler Fix

**Files:**
- Modify: `supabase/functions/paddle-webhooks/index.ts`

- [ ] **Step 1: Rename stripe columns to paddle columns in upsert payload**

In `supabase/functions/paddle-webhooks/index.ts`, find the upsert payload object (the `upsertData` variable). Change:

```typescript
      stripe_customer_id: event.data.customer_id, // Legacy column → Paddle customer_id
      stripe_subscription_id: event.data.id, // Legacy column → Paddle subscription_id
```

to:

```typescript
      paddle_customer_id: event.data.customer_id,
      paddle_subscription_id: event.data.id,
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/paddle-webhooks/index.ts
git commit -m "fix: rename stripe columns to paddle columns in webhook upsert payload"
```

- [ ] **Step 4: Deploy the updated edge function**

```bash
supabase functions deploy paddle-webhooks --no-verify-jwt
```

Note: `--no-verify-jwt` is required because this function has `verify_jwt: false` (Paddle calls it directly, not the browser).

---

## Task 3: New Edge Function — `paddle-update-subscription`

**Files:**
- Create: `supabase/functions/paddle-update-subscription/index.ts`

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/paddle-update-subscription/index.ts`:

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

// Service-role client for DB queries (bypasses RLS)
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  try {
    // Authenticate the user via their JWT
    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Parse request body
    const { price_id: newPriceId } = await req.json();
    if (!newPriceId || typeof newPriceId !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid price_id" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Look up user's current subscription
    const { data: sub, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("paddle_subscription_id, price_id, status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError) {
      console.error("Error fetching subscription:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscription" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Validate subscription state
    if (!sub || !sub.paddle_subscription_id) {
      return new Response(
        JSON.stringify({ error: "No active subscription found" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (!["active", "trialing"].includes(sub.status)) {
      return new Response(
        JSON.stringify({ error: "No active subscription found" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (sub.price_id === newPriceId) {
      return new Response(
        JSON.stringify({ error: "Already on this plan" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Call Paddle API to update the subscription
    const paddleEnv = Deno.env.get("PADDLE_ENVIRONMENT") ?? "production";
    const baseUrl = paddleEnv === "sandbox"
      ? "https://sandbox-api.paddle.com"
      : "https://api.paddle.com";
    const apiKey = Deno.env.get("PADDLE_API_KEY");

    if (!apiKey) {
      console.error("PADDLE_API_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Billing service not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const paddleResponse = await fetch(
      `${baseUrl}/subscriptions/${sub.paddle_subscription_id}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ price_id: newPriceId, quantity: 1 }],
          proration_billing_mode: "prorated_immediately",
        }),
      },
    );

    if (!paddleResponse.ok) {
      const paddleError = await paddleResponse.text();
      console.error("Paddle API error:", paddleResponse.status, paddleError);
      return new Response(
        JSON.stringify({
          error: "Failed to update subscription",
          details: paddleError,
        }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("paddle-update-subscription error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (edge functions are separate from the Vite project, but verify no import errors)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/paddle-update-subscription/index.ts
git commit -m "feat: add paddle-update-subscription edge function for tier upgrades"
```

- [ ] **Step 4: Deploy the edge function**

```bash
supabase functions deploy paddle-update-subscription
```

Note: This function uses JWT verification (the default), so no `--no-verify-jwt` flag needed.

- [ ] **Step 5: Set required secrets (if not already set)**

```bash
supabase secrets set PADDLE_API_KEY=your_paddle_api_key_here
supabase secrets set PADDLE_ENVIRONMENT=sandbox
```

---

## Task 4: Frontend — Upgrade vs New Checkout

**Files:**
- Modify: `src/app/components/PricingPlans.tsx`

- [ ] **Step 1: Add status to useSubscription destructuring and add upgrade state**

In `PricingPlans.tsx`, change the existing destructuring at the top of the component (line 101):

```typescript
	const { tier: currentTier, isLoading: subscriptionLoading } =
		useSubscription();
```

to:

```typescript
	const { tier: currentTier, status: currentStatus, isLoading: subscriptionLoading } =
		useSubscription();
```

Also add state for upgrade loading and import `useQueryClient`:

Add to imports at the top of the file:

```typescript
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/queries/keys";
import { supabase } from "@/lib/supabase";
```

And inside the component function, after the existing `useState`:

```typescript
	const queryClient = useQueryClient();
	const [upgradingTier, setUpgradingTier] = useState<SubscriptionTier | null>(null);
```

- [ ] **Step 2: Add upgrade handler**

Add a new `handleUpgrade` function after the existing `handleSubscribe` function:

```typescript
	const isUpgradeEligible =
		currentTier !== "FREE" &&
		(currentStatus === "active" || currentStatus === "trialing");

	const handleUpgrade = async (tier: SubscriptionTier) => {
		const tierPricing = TIER_PRICING.find(
			(t: TierPricing) => t.tier === tier,
		);
		if (!tierPricing) return;

		const priceId = isAnnual
			? tierPricing.paddleAnnualPriceId
			: tierPricing.paddleMonthlyPriceId;

		if (!priceId) {
			toast.error("Paddle checkout is not configured yet.");
			return;
		}

		if (!user) {
			toast.error("You must be logged in to upgrade.");
			return;
		}

		setUpgradingTier(tier);
		try {
			const { error } = await supabase.functions.invoke(
				"paddle-update-subscription",
				{ body: { price_id: priceId } },
			);

			if (error) {
				toast.error(error.message || "Failed to update subscription");
				return;
			}

			toast.success(
				"Subscription updated! Changes may take a moment to reflect.",
			);

			// Invalidate subscription cache to trigger refetch
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.byUser(user.id),
				});
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setUpgradingTier(null);
		}
	};
```

- [ ] **Step 3: Update renderCTA to handle upgrades**

Replace the entire `renderCTA` function with:

```typescript
	const renderCTA = (tierConfig: TierConfig) => {
		if (tierConfig.comingSoon) {
			return (
				<Button variant="outline" className="w-full opacity-60" disabled>
					<Clock className="w-4 h-4 mr-2" />
					Coming Soon
				</Button>
			);
		}

		if (currentTier === tierConfig.tier) {
			return (
				<Button variant="outline" className="w-full" disabled>
					Current Plan
				</Button>
			);
		}

		if (TIER_LEVEL[currentTier] > TIER_LEVEL[tierConfig.tier]) {
			return (
				<Button variant="outline" className="w-full opacity-50" disabled>
					Included in your plan
				</Button>
			);
		}

		// Higher tier — upgrade or subscribe
		const isUpgrading = upgradingTier === tierConfig.tier;

		if (isUpgradeEligible) {
			return (
				<Button
					className={`w-full ${tierConfig.buttonClass}`}
					onClick={() => handleUpgrade(tierConfig.tier)}
					disabled={isUpgrading}
				>
					{isUpgrading ? (
						<>
							<Loader2 className="w-4 h-4 mr-2 animate-spin" />
							Upgrading...
						</>
					) : (
						"Upgrade"
					)}
				</Button>
			);
		}

		return (
			<Button
				className={`w-full ${tierConfig.buttonClass}`}
				onClick={() => handleSubscribe(tierConfig.tier)}
			>
				Subscribe
			</Button>
		);
	};
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All 200 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/app/components/PricingPlans.tsx
git commit -m "feat: add subscription upgrade flow — detect active sub, call Paddle API instead of new checkout"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Manual test checklist**

1. Free user sees "Subscribe" on all paid tiers
2. Ember user sees "Current Plan" on Ember, "Upgrade" on Flame, "Coming Soon" (disabled) on Inferno
3. Clicking "Upgrade" shows loading state → calls edge function → toast on success
4. Paddle webhook fires `subscription.updated` → DB updates → UI reflects new tier
5. Verify proration in Paddle dashboard
