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
	/** Access-control tier: falls back to FREE unless active/trialing and period end is future. */
	tier: SubscriptionTier;
	/** Raw tier stored in the database (useful for display, e.g. "Your FLAME plan cancels on…"). */
	rawTier: SubscriptionTier;
	status: SubscriptionStatus;
	priceId: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	isEntitled: boolean;
	isStale: boolean;
	isLoading: boolean;
	/** True when the subscription query failed and no cached data is available. */
	isError: boolean;
	error: Error | null;
	isPremium: boolean;
	isFlame: boolean;
	isInferno: boolean;
}

async function fetchSubscription(userId: string) {
	const { data, error } = await supabase
		.from("subscriptions")
		.select("tier, status, price_id, current_period_end, cancel_at_period_end")
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
	};
}

export function useSubscription(): SubscriptionData {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	const subscriptionKey = queryKeys.subscription.byUser(user?.id ?? "");

	const { data, isLoading, isError, error } = useQuery({
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

	const rawTier: SubscriptionTier = data?.tier ?? "FREE";
	const status: SubscriptionStatus = data?.status ?? "none";
	const currentPeriodEnd = data?.currentPeriodEnd ?? null;

	const tier: SubscriptionTier = getEffectiveSubscriptionTier(
		rawTier,
		status,
		currentPeriodEnd,
	);
	const isEntitled = tier !== "FREE";

	return {
		tier,
		rawTier,
		status,
		priceId: data?.priceId ?? null,
		currentPeriodEnd,
		cancelAtPeriodEnd: data?.cancelAtPeriodEnd ?? false,
		isEntitled,
		isStale: isStaleActiveSubscription(status, currentPeriodEnd),
		isLoading,
		// Only report an error when the query failed AND we have no cached data to
		// fall back on; otherwise consumers keep using the last-known entitlement.
		isError: isError && data === undefined,
		error: error instanceof Error ? error : null,
		isPremium: isEntitled,
		isFlame: tier === "FLAME" || tier === "INFERNO",
		isInferno: tier === "INFERNO",
	};
}
