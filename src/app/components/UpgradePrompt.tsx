import { Crown, Flame, Lock, Zap } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import type { SubscriptionTier } from "@/hooks/useSubscription";
import { TIER_PRICING } from "@/lib/pricing";

type PaidTier = "PHOENIX" | "ELITE";

// Icon sets per tier for display alongside benefit labels
const TIER_ICONS: Record<PaidTier, (typeof Flame)[]> = {
	PHOENIX: [Flame, Zap, Crown],
	ELITE: [Crown, Zap, Flame],
};

// Derive benefits from shared pricing constants (single source of truth)
const TIER_BENEFITS: Record<PaidTier, { icon: typeof Flame; label: string }[]> =
	Object.fromEntries(
		(["PHOENIX", "ELITE"] as const).map((tier) => {
			const pricing = TIER_PRICING.find((t) => t.tier === tier)!;
			const icons = TIER_ICONS[tier];
			// Skip "Everything in X" entries, take up to 3 features
			const features = pricing.features
				.filter((f) => !f.startsWith("Everything in"))
				.slice(0, 3);
			return [
				tier,
				features.map((label, i) => ({ icon: icons[i] ?? Flame, label })),
			];
		}),
	) as Record<PaidTier, { icon: typeof Flame; label: string }[]>;

const TIER_COLORS: Record<
	PaidTier,
	{ border: string; glow: string; accent: string }
> = {
	PHOENIX: {
		border: "border-primary/40",
		glow: "from-primary/10 to-chart-2/10",
		accent: "text-primary",
	},
	ELITE: {
		border: "border-accent/40",
		glow: "from-accent/10 to-warning/10",
		accent: "text-accent",
	},
};

interface UpgradePromptProps {
	requiredTier: PaidTier;
	currentTier: SubscriptionTier;
	featureName?: string;
}

export function UpgradePrompt({
	requiredTier,
	currentTier: _currentTier,
	featureName,
}: UpgradePromptProps) {
	const colors = TIER_COLORS[requiredTier];
	const benefits = TIER_BENEFITS[requiredTier];

	return (
		<Card
			className={`relative overflow-hidden bg-gradient-to-br from-surface-2 to-background ${colors.border} p-8`}
		>
			{/* Subtle gradient glow */}
			<div
				className={`absolute inset-0 bg-gradient-to-br ${colors.glow} pointer-events-none`}
			/>

			<div className="relative z-10 flex flex-col items-center text-center gap-5">
				{/* Lock icon */}
				<div
					className={`rounded-full bg-background border ${colors.border} p-4`}
				>
					<Lock className={`w-8 h-8 ${colors.accent}`} />
				</div>

				{/* Message */}
				<div>
					<h3 className="text-lg font-semibold text-zinc-100 mb-1">
						Upgrade to <span className={colors.accent}>{requiredTier}</span>
					</h3>
					<p className="text-sm text-zinc-400">
						Unlock {featureName ?? "this feature"} and more with a{" "}
						{requiredTier} subscription.
					</p>
				</div>

				{/* Benefits */}
				<ul className="space-y-3 w-full max-w-xs text-left">
					{benefits.map((benefit) => (
						<li
							key={benefit.label}
							className="flex items-center gap-3 text-sm text-zinc-300"
						>
							<benefit.icon className={`w-4 h-4 ${colors.accent} shrink-0`} />
							{benefit.label}
						</li>
					))}
				</ul>

				{/* CTA */}
				<Button
					asChild
					className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0 text-white px-8"
				>
					<Link to="/pricing">View Plans</Link>
				</Button>
			</div>
		</Card>
	);
}
