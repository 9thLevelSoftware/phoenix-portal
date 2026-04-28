import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import {
	type SubscriptionStatus,
	type SubscriptionTier,
	subscriptionStatusSchema,
	subscriptionTierSchema,
} from "@/schemas/subscription";

export type {
	SubscriptionStatus,
	SubscriptionTier,
} from "@/schemas/subscription";

/** Statuses that grant access to the user's paid tier. */
const ACTIVE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
	"active",
	"trialing",
]);

interface SubscriptionData {
	/** Access-control tier: falls back to FREE when subscription is not active/trialing. */
	tier: SubscriptionTier;
	/** Raw tier stored in the database (useful for display, e.g. "Your FLAME plan cancels on…"). */
	rawTier: SubscriptionTier;
	status: SubscriptionStatus;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	isLoading: boolean;
	isPremium: boolean;
	isFlame: boolean;
	isInferno: boolean;
}

async function fetchSubscription(userId: string) {
	const { data, error } = await supabase
		.from("subscriptions")
		.select("tier, status, current_period_end, cancel_at_period_end")
		.eq("user_id", userId)
		.maybeSingle();

	if (error) {
		throw new Error(`Failed to fetch subscription: ${error.message}`);
	}

	if (!data) {
		return {
			tier: "FREE" as SubscriptionTier,
			status: "none" as SubscriptionStatus,
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
		currentPeriodEnd: data.current_period_end,
		cancelAtPeriodEnd: data.cancel_at_period_end,
	};
}

export function useSubscription(): SubscriptionData {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.subscription.byUser(user?.id ?? ""),
		queryFn: () => fetchSubscription(user?.id),
		enabled: !!user,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	// Subscribe to Realtime changes on the subscriptions table for this user
	useEffect(() => {
		if (!user) return;

		const channel = supabase
			.channel(`subscription:${user.id}`)
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

	// Effective tier mirrors server-side requireSubscription() logic:
	// only active/trialing subscriptions grant paid access.
	const tier: SubscriptionTier = ACTIVE_STATUSES.has(status) ? rawTier : "FREE";

	return {
		tier,
		rawTier,
		status,
		currentPeriodEnd: data?.currentPeriodEnd ?? null,
		cancelAtPeriodEnd: data?.cancelAtPeriodEnd ?? false,
		isLoading,
		isPremium: tier !== "FREE",
		isFlame: tier === "FLAME" || tier === "INFERNO",
		isInferno: tier === "INFERNO",
	};
}
