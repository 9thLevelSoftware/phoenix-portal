import { ArrowRight, HeartPulse } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { useSubscription } from "@/hooks/useSubscription";
import { useRecoveryScore } from "@/hooks/useRecoveryScore";
import { GATING_THRESHOLD_DAYS } from "@/lib/recovery";
import { RecoveryScore } from "./RecoveryScore";

export function RecoveryDashboardWidget() {
	const { isPremium } = useSubscription();
	const { recovery, isLoading, daysSinceFirstSession } = useRecoveryScore();

	// Only render for premium users
	if (!isPremium) return null;

	if (isLoading) {
		return (
			<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
				<div className="flex items-center justify-between mb-4">
					<h3 className="text-xl text-white flex items-center gap-2">
						<HeartPulse className="w-5 h-5 text-primary" />
						Recovery
					</h3>
				</div>
				<div className="flex items-center justify-center py-6">
					<div className="w-12 h-12 rounded-full border-2 border-secondary animate-pulse" />
				</div>
			</Card>
		);
	}

	return (
		<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-xl text-white flex items-center gap-2">
					<HeartPulse className="w-5 h-5 text-primary" />
					Recovery
				</h3>
				<Button
					variant="ghost"
					className="text-primary hover:bg-primary/10"
					asChild
				>
					<Link to="/recovery">
						View Details
						<ArrowRight className="w-4 h-4 ml-2" />
					</Link>
				</Button>
			</div>

			{recovery?.isGated ? (
				<div className="flex flex-col items-center justify-center py-4 text-center">
					<HeartPulse className="w-8 h-8 text-secondary mb-2" />
					<p className="text-sm text-muted-foreground mb-1">
						Building baseline...
					</p>
					<p className="text-xs text-muted">
						{GATING_THRESHOLD_DAYS - daysSinceFirstSession} days remaining
					</p>
				</div>
			) : recovery ? (
				<div className="flex items-center justify-center py-2">
					<RecoveryScore result={recovery} size="sm" />
					<div className="ml-3">
						<p className="text-sm text-white">
							{recovery.status === "elevated"
								? "Elevated"
								: recovery.status === "moderate"
									? "Balanced"
									: "Increased fatigue"}
						</p>
						{recovery.isClamped && (
							<p className="text-xs text-muted">Limited range</p>
						)}
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center justify-center py-4 text-center">
					<HeartPulse className="w-8 h-8 text-secondary mb-2" />
					<p className="text-sm text-muted-foreground">
						No training data yet
					</p>
				</div>
			)}
		</Card>
	);
}
