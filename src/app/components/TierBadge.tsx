import { Badge } from "@/app/components/ui/badge";
import { Skeleton } from "@/app/components/ui/skeleton";
import { cn } from "@/app/components/ui/utils";
import { useSubscription } from "@/hooks/useSubscription";
import type { SubscriptionTier } from "@/schemas/subscription";

const TIER_STYLES: Record<SubscriptionTier, string> = {
	FREE: "border-zinc-700 bg-zinc-800 text-zinc-400",
	EMBER:
		"border-[var(--color-forge-green)] bg-emerald-950 text-[var(--color-forge-green)]",
	FLAME: "border-orange-800 bg-orange-950 text-orange-400",
	INFERNO: "border-yellow-800 bg-yellow-950 text-yellow-400",
};

const TIER_LABELS: Record<SubscriptionTier, string> = {
	FREE: "Free",
	EMBER: "Ember",
	FLAME: "Flame",
	INFERNO: "Inferno",
};

export function TierBadge({ className }: { className?: string }) {
	const { tier, isLoading } = useSubscription();

	if (isLoading) {
		return <Skeleton className={cn("h-5 w-16 rounded-full", className)} />;
	}

	return (
		<Badge variant="outline" className={cn(TIER_STYLES[tier], className)}>
			{TIER_LABELS[tier]}
		</Badge>
	);
}
