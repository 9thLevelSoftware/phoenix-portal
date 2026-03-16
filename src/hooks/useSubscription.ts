import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";

export type SubscriptionTier = "FREE" | "EMBER" | "FLAME" | "INFERNO";
export type SubscriptionStatus =
	| "active"
	| "past_due"
	| "canceled"
	| "trialing"
	| "incomplete"
	| "none";

interface SubscriptionData {
	tier: SubscriptionTier;
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

	return {
		tier: data.tier,
		status: data.status,
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

	const tier = data?.tier ?? "FREE";

	return {
		tier,
		status: data?.status ?? "none",
		currentPeriodEnd: data?.currentPeriodEnd ?? null,
		cancelAtPeriodEnd: data?.cancelAtPeriodEnd ?? false,
		isLoading,
		isPremium: tier !== "FREE",
		isFlame: tier === "FLAME" || tier === "INFERNO",
		isInferno: tier === "INFERNO",
	};
}
