import type { ReactNode } from "react";
import { UpgradePrompt } from "@/app/components/UpgradePrompt";
import { Button } from "@/app/components/ui/button";
import { Skeleton } from "@/app/components/ui/skeleton";
import {
	type SubscriptionTier,
	useSubscription,
} from "@/hooks/useSubscription";

const TIER_LEVEL: Record<SubscriptionTier, number> = {
	FREE: 0,
	EMBER: 1,
	FLAME: 2,
	INFERNO: 3,
};

interface SubscriptionGateProps {
	requiredTier: "EMBER" | "FLAME" | "INFERNO";
	children: ReactNode;
	fallback?: ReactNode;
	featureName?: string;
}

export function SubscriptionGate({
	requiredTier,
	children,
	fallback,
	featureName,
}: SubscriptionGateProps) {
	const { tier, isLoading, isError, refetch } = useSubscription();

	if (isLoading) {
		return <Skeleton className="h-32 w-full" />;
	}

	if (isError) {
		return (
			<div
				className="flex flex-col items-center justify-center py-16 text-center"
				data-testid="subscription-error"
			>
				<p className="mb-2 text-lg text-white">
					Couldn't load your subscription
				</p>
				<p className="mb-6 max-w-sm text-sm text-muted-foreground">
					Billing status is unavailable. Retry to continue — this is not a free
					plan.
				</p>
				<Button variant="outline" onClick={() => void refetch()}>
					Retry
				</Button>
			</div>
		);
	}

	if (TIER_LEVEL[tier] >= TIER_LEVEL[requiredTier]) {
		return <>{children}</>;
	}

	return (
		<>
			{fallback ?? (
				<UpgradePrompt
					requiredTier={requiredTier}
					currentTier={tier}
					featureName={featureName}
				/>
			)}
		</>
	);
}
