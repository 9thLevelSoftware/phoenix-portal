import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import {
	getEffectiveSubscriptionTier,
	isStaleActiveSubscription,
	type SubscriptionStatus,
	type SubscriptionTier,
} from "@/lib/subscription-entitlement";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
// SPA -> Edge `_shared` import. This is the one billing predicate, shared so
// the CTA and the server cannot disagree (R-11). It is safe because
// billingAction.ts and its only transitive import (subscriptionEntitlement.ts)
// are pure predicates: no Deno.*, no env reads, no secret names, no
// service-role path. That is NOT true of the directory as a whole
// (paddleWebhookSecurity.ts, hmac.ts and every handler's default dependencies
// read secrets), so only these two modules may ever be imported from src/, and
// neither may grow a re-export of anything else in `_shared`. Bundle guard:
// tests/security/edge-function-security.test.ts.
import {
	type BillingActionName,
	billingAction,
} from "../../supabase/functions/_shared/billingAction.ts";

const subscriptionTierSchema = z.enum(["FREE", "EMBER", "FLAME", "INFERNO"]);
const subscriptionStatusSchema = z.enum([
	"active",
	"past_due",
	"canceled",
	"trialing",
	"incomplete",
	"none",
]);

export type { SubscriptionStatus, SubscriptionTier };

interface SubscriptionData {
	/** Access-control tier from the shared entitlement predicate (src/lib/subscription-entitlement.ts). */
	tier: SubscriptionTier;
	/** Raw tier stored in the database (useful for display, e.g. "Your FLAME plan cancels on…"). */
	rawTier: SubscriptionTier;
	status: SubscriptionStatus;
	priceId: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	isEntitled: boolean;
	/**
	 * The one billing routing predicate, shared with the Edge functions
	 * (supabase/functions/_shared/billingAction.ts):
	 * `manage` | `refresh` | `checkout`. A checkout may be opened only for
	 * `checkout` — paddle-checkout-custom-data refuses to sign anything else.
	 */
	billingAction: BillingActionName;
	/** past_due: access continues, but the card has to be updated (R-33). */
	needsPaymentUpdate: boolean;
	isStale: boolean;
	isLoading: boolean;
	/** True when the subscription query failed and no cached data is available. */
	isError: boolean;
	error: Error | null;
	/** Refetch billing status. Use this for retry UI — never treat isError as FREE. */
	refetch: () => Promise<unknown>;
	isPremium: boolean;
	isFlame: boolean;
	isInferno: boolean;
}

async function fetchSubscription(userId: string) {
	const { data, error } = await supabase
		.from("subscriptions")
		.select(
			"tier, status, price_id, current_period_end, cancel_at_period_end, updated_at",
			"tier, status, price_id, current_period_end, cancel_at_period_end, updated_at, paddle_subscription_id",
		)
		.eq("user_id", userId)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch subscription: ${error.message}`);
	}

	if (!data) {
		return {
			tier: "FREE" as SubscriptionTier,
			status: "none" as SubscriptionStatus,
			priceId: null,
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			updatedAt: null,
			paddleSubscriptionId: null,
		};
	}

	const tierRaw =
		typeof data.tier === "string" ? data.tier.toUpperCase() : data.tier;
	const tierParsed = subscriptionTierSchema.safeParse(tierRaw);
	const tier: SubscriptionTier = tierParsed.success ? tierParsed.data : "FREE";

	const statusRaw =
		typeof data.status === "string" ? data.status : String(data.status ?? "");
	const statusParsed = subscriptionStatusSchema.safeParse(statusRaw);
	const status: SubscriptionStatus = statusParsed.success
		? statusParsed.data
		: "none";

	return {
		tier,
		status,
		priceId: typeof data.price_id === "string" ? data.price_id : null,
		currentPeriodEnd: data.current_period_end ?? null,
		cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
		updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
		paddleSubscriptionId:
			typeof data.paddle_subscription_id === "string"
				? data.paddle_subscription_id
				: null,
	};
}

export function useSubscription(): SubscriptionData {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	const subscriptionKey = queryKeys.subscription.byUser(user?.id ?? "");

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: subscriptionKey,
		queryFn: () => fetchSubscription(user?.id),
		enabled: !!user,
		staleTime: 5 * 60 * 1000, // 5 minutes
		// Preserve the last-known entitlement across transient refetch errors so a
		// momentary network/Supabase failure doesn't silently downgrade the user —
		// but ONLY for the same user. `keepPreviousData` would also carry a row
		// forward across a user switch or sign-out (the query key changes), briefly
		// exposing the previous account's paid entitlement to the new/anonymous
		// session. Scope the carry-over to a matching user id so that never happens.
		placeholderData: (previousData, previousQuery) => {
			if (!previousQuery) return undefined;
			const previousUserId = previousQuery.queryKey[1];
			return previousUserId === subscriptionKey[1] ? previousData : undefined;
		},
	});

	// Subscribe to Realtime changes on the subscriptions table for this user
	useEffect(() => {
		if (!user) return;

		const channelSuffix =
			typeof globalThis.crypto?.randomUUID === "function"
				? globalThis.crypto.randomUUID()
				: Math.random().toString(36).slice(2);
		const channel = supabase
			.channel(`subscription:${user.id}:${channelSuffix}`)
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "subscriptions",
					filter: `user_id=eq.${user.id}`,
				},
				() => {
					// Invalidate the subscription query so it refetches
					queryClient.invalidateQueries({
						queryKey: queryKeys.subscription.byUser(user.id),
					});
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [user, queryClient]);

	// Missing data defaults to FREE for the typed fields, but consumers MUST
	// check `isError` first. Mapping `data?.tier ?? "FREE"` into an upgrade
	// wall or skipped realtime channel treats a billing outage as unpaid.
	const billingUnavailable = isError && data === undefined;
	const rawTier: SubscriptionTier = data?.tier ?? "FREE";
	const status: SubscriptionStatus = data?.status ?? "none";
	const currentPeriodEnd = data?.currentPeriodEnd ?? null;

	const cancelAtPeriodEnd = data?.cancelAtPeriodEnd ?? false;

	const tier: SubscriptionTier = getEffectiveSubscriptionTier(
		rawTier,
		status,
		currentPeriodEnd,
		{ cancelAtPeriodEnd },
	);
	const isEntitled = !billingUnavailable && tier !== "FREE";

	// Same predicate the Edge functions use, so the CTA and the server can
	// never disagree about whether a new checkout is allowed (R-11, F-022).
	// A billing outage must not read as "no subscription, open a checkout".
	const action = billingUnavailable
		? null
		: billingAction({
				paddle_subscription_id: data?.paddleSubscriptionId ?? null,
				tier: rawTier,
				status,
				current_period_end: currentPeriodEnd,
				cancel_at_period_end: cancelAtPeriodEnd,
			});

	return {
		tier,
		rawTier,
		status,
		priceId: data?.priceId ?? null,
		currentPeriodEnd,
		cancelAtPeriodEnd,
		isEntitled,
		// Billing unavailable: never "checkout" — an outage must not sell the
		// user a subscription they may already have.
		billingAction: action?.action ?? "refresh",
		needsPaymentUpdate: Boolean(action?.needsPaymentUpdate),
		isStale: isStaleActiveSubscription(status, currentPeriodEnd, {
			updatedAt: data && "updatedAt" in data ? data.updatedAt : null,
		}),
		isLoading,
		// Only report an error when the query failed AND we have no cached data to
		// fall back on; otherwise consumers keep using the last-known entitlement.
		isError: billingUnavailable,
		error: error instanceof Error ? error : null,
		refetch,
		isPremium: isEntitled,
		isFlame: !billingUnavailable && (tier === "FLAME" || tier === "INFERNO"),
		isInferno: !billingUnavailable && tier === "INFERNO",
	};
}
