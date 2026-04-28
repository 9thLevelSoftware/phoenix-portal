import type { ReactNode } from "react";
import { UpgradePrompt } from "@/app/components/UpgradePrompt";
import { Skeleton } from "@/app/components/ui/skeleton";
import { useSubscription } from "@/hooks/useSubscription";
import type { SubscriptionTier } from "@/schemas/subscription";

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
	const { tier, isLoading } = useSubscription();

	if (isLoading) {
		return <Skeleton className="h-32 w-full" />;
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
