import { Badge } from "@/app/components/ui/badge";
import { Skeleton } from "@/app/components/ui/skeleton";
import { cn } from "@/app/components/ui/utils";
import {
	type SubscriptionTier,
	useSubscription,
} from "@/hooks/useSubscription";

const TIER_STYLES: Record<SubscriptionTier, string> = {
	FREE: "border-border bg-secondary text-muted-foreground",
	EMBER: "border-success bg-success/10 text-success",
	FLAME: "border-primary/60 bg-primary/10 text-sidebar-accent-foreground",
	INFERNO: "border-rank-gold/60 bg-rank-gold/10 text-rank-gold",
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
