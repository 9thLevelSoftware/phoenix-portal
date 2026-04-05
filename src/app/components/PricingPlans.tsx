import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowUp,
	Check,
	Clock,
	Crown,
	Flame,
	Loader2,
	Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/app/components/ui/card";
import { Switch } from "@/app/components/ui/switch";
import { useAuth } from "@/app/hooks/useAuth";
import {
	type SubscriptionTier,
	useSubscription,
} from "@/hooks/useSubscription";
import { openCheckout } from "@/lib/paddle-client";
import { TIER_PRICING, type TierPricing } from "@/lib/pricing";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/queries/keys";

interface TierFeature {
	label: string;
}

interface TierDisplayConfig {
	icon: typeof Flame;
	accentBorder: string;
	accentBg: string;
	accentText: string;
	buttonClass: string;
	popular?: boolean;
}

interface TierConfig extends TierDisplayConfig {
	name: string;
	tier: SubscriptionTier;
	monthlyPrice: string;
	annualPrice: string;
	annualMonthly: string;
	features: TierFeature[];
	comingSoon?: boolean;
}

// Display-only configuration per tier (no prices here — prices come from TIER_PRICING)
const TIER_DISPLAY: Record<SubscriptionTier, TierDisplayConfig> = {
	FREE: {
		icon: Flame,
		accentBorder: "border-zinc-700",
		accentBg: "from-zinc-800/50 to-zinc-900/50",
		accentText: "text-zinc-400",
		buttonClass: "",
	},
	EMBER: {
		icon: Sparkles,
		accentBorder: "border-[var(--color-forge-green)]",
		accentBg: "from-[var(--color-forge-green)]/10 to-emerald-900/10",
		accentText: "text-[var(--color-forge-green)]",
		buttonClass:
			"bg-[var(--color-forge-green)] hover:bg-[var(--color-forge-green)]/90 text-white border-0",
	},
	FLAME: {
		icon: Flame,
		accentBorder: "border-primary",
		accentBg: "from-primary/10 to-chart-2/10",
		accentText: "text-primary",
		buttonClass: "bg-primary hover:bg-primary/90 text-white border-0",
		popular: true,
	},
	INFERNO: {
		icon: Crown,
		accentBorder: "border-accent",
		accentBg: "from-accent/10 to-[#B45309]/10",
		accentText: "text-accent",
		buttonClass: "bg-accent hover:bg-accent/90 text-black border-0",
	},
};

// Merge shared pricing data with display config — no hardcoded prices in this file
const TIERS: TierConfig[] = TIER_PRICING.map((pricing) => ({
	...TIER_DISPLAY[pricing.tier],
	name: pricing.name,
	tier: pricing.tier,
	monthlyPrice: pricing.monthlyPrice,
	annualPrice: pricing.annualPrice,
	annualMonthly: pricing.annualMonthly,
	features: pricing.features.map((f) => ({ label: f })),
	comingSoon: pricing.comingSoon,
}));

const TIER_LEVEL: Record<SubscriptionTier, number> = {
	FREE: 0,
	EMBER: 1,
	FLAME: 2,
	INFERNO: 3,
};

export function PricingPlans() {
	const {
		tier: currentTier,
		status: currentStatus,
		isLoading: subscriptionLoading,
		cancelAtPeriodEnd,
		currentPeriodEnd,
	} = useSubscription();
	const { user } = useAuth();
	const [isAnnual, setIsAnnual] = useState(false);
	const queryClient = useQueryClient();
	const [upgradingTier, setUpgradingTier] = useState<SubscriptionTier | null>(
		null,
	);
	const [confirmUpgradeTier, setConfirmUpgradeTier] =
		useState<SubscriptionTier | null>(null);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [isCanceling, setIsCanceling] = useState(false);

	const handleSubscribe = async (tier: SubscriptionTier) => {
		const tierPricing = TIER_PRICING.find((t: TierPricing) => t.tier === tier);
		if (!tierPricing) return;

		const priceId = isAnnual
			? tierPricing.paddleAnnualPriceId
			: tierPricing.paddleMonthlyPriceId;

		if (!priceId) {
			toast.error("Paddle checkout is not configured yet.");
			return;
		}

		if (!user) {
			toast.error("You must be logged in to subscribe.");
			return;
		}

		await openCheckout({
			priceId,
			userId: user.id,
			userEmail: user.email ?? "",
			onSuccess: () => {
				toast.success("Subscription activated!");
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.byUser(user.id),
				});
			},
		});
	};

	const handleCancel = async () => {
		setIsCanceling(true);
		try {
			const { error } = await supabase.functions.invoke(
				"paddle-cancel-subscription",
			);

			if (error) {
				toast.error(error.message || "Failed to cancel subscription");
				return;
			}

			toast.success(
				"Subscription canceled. You'll retain access until the end of your billing period.",
			);

			// Invalidate subscription cache to trigger refetch
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.byUser(user.id),
				});
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setIsCanceling(false);
			setConfirmCancel(false);
		}
	};

	const isUpgradeEligible =
		currentTier !== "FREE" &&
		(currentStatus === "active" || currentStatus === "trialing");

	const handleUpgrade = async (tier: SubscriptionTier) => {
		const tierPricing = TIER_PRICING.find((t: TierPricing) => t.tier === tier);
		if (!tierPricing) return;

		const priceId = isAnnual
			? tierPricing.paddleAnnualPriceId
			: tierPricing.paddleMonthlyPriceId;

		if (!priceId) {
			toast.error("Paddle checkout is not configured yet.");
			return;
		}

		if (!user) {
			toast.error("You must be logged in to upgrade.");
			return;
		}

		setUpgradingTier(tier);
		try {
			const { error } = await supabase.functions.invoke(
				"paddle-update-subscription",
				{ body: { price_id: priceId } },
			);

			if (error) {
				toast.error(error.message || "Failed to update subscription");
				return;
			}

			toast.success(
				"Subscription updated! Changes may take a moment to reflect.",
			);

			// Invalidate subscription cache to trigger refetch
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.byUser(user.id),
				});
			}
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setUpgradingTier(null);
		}
	};

	const renderCTA = (tierConfig: TierConfig) => {
		if (tierConfig.comingSoon) {
			return (
				<Button variant="outline" className="w-full opacity-60" disabled>
					<Clock className="w-4 h-4 mr-2" />
					Coming Soon
				</Button>
			);
		}

		if (currentTier === tierConfig.tier) {
			if (tierConfig.tier === "FREE") {
				return (
					<Button variant="outline" className="w-full" disabled>
						Current Plan
					</Button>
				);
			}

			if (cancelAtPeriodEnd) {
				return (
					<div className="flex flex-col gap-2 w-full">
						<Button variant="outline" className="w-full" disabled>
							Current Plan
						</Button>
						<p className="text-xs text-muted-foreground text-center">
							Cancels on{" "}
							{currentPeriodEnd
								? new Date(currentPeriodEnd).toLocaleDateString()
								: "end of period"}
						</p>
					</div>
				);
			}

			return (
				<div className="flex flex-col gap-2 w-full">
					<Button variant="outline" className="w-full" disabled>
						Current Plan
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-muted-foreground hover:text-destructive text-xs"
						onClick={() => setConfirmCancel(true)}
					>
						Cancel subscription
					</Button>
				</div>
			);
		}

		if (TIER_LEVEL[currentTier] > TIER_LEVEL[tierConfig.tier]) {
			return (
				<Button variant="outline" className="w-full opacity-50" disabled>
					Included in your plan
				</Button>
			);
		}

		// Higher tier — upgrade or subscribe
		const isUpgrading = upgradingTier === tierConfig.tier;

		if (isUpgradeEligible) {
			return (
				<Button
					className={`w-full ${tierConfig.buttonClass}`}
					onClick={() => setConfirmUpgradeTier(tierConfig.tier)}
					disabled={isUpgrading}
				>
					{isUpgrading ? (
						<>
							<Loader2 className="w-4 h-4 mr-2 animate-spin" />
							Upgrading...
						</>
					) : (
						<>
							<ArrowUp className="w-4 h-4 mr-2" />
							Upgrade
						</>
					)}
				</Button>
			);
		}

		return (
			<Button
				className={`w-full ${tierConfig.buttonClass}`}
				onClick={() => handleSubscribe(tierConfig.tier)}
			>
				Subscribe
			</Button>
		);
	};

	return (
		<div className="min-h-screen p-4 md:p-8">
			<div className="max-w-5xl mx-auto">
				{/* Header */}
				<div className="text-center mb-10">
					<h1 className="text-display-2 text-white mb-3">Choose Your Plan</h1>
					<p className="text-muted-foreground text-lg max-w-2xl mx-auto">
						Unlock premium features to get the most out of your training data
					</p>
				</div>

				{/* Billing Toggle */}
				<div className="flex items-center justify-center gap-3 mb-10">
					<span
						className={`text-sm font-medium ${!isAnnual ? "text-white" : "text-muted-foreground"}`}
					>
						Monthly
					</span>
					<Switch
						checked={isAnnual}
						onCheckedChange={setIsAnnual}
						aria-label="Annual billing"
					/>
					<span
						className={`text-sm font-medium ${isAnnual ? "text-white" : "text-muted-foreground"}`}
					>
						Annual
					</span>
					{isAnnual && (
						<Badge className="bg-success/20 text-success border-success/30">
							Save ~17%
						</Badge>
					)}
				</div>

				{/* Tier Cards */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
					{TIERS.map((tierConfig) => {
						const Icon = tierConfig.icon;
						const isCurrent = currentTier === tierConfig.tier;

						return (
							<Card
								key={tierConfig.tier}
								className={`relative bg-gradient-to-b ${tierConfig.accentBg} border-2 ${
									isCurrent ? tierConfig.accentBorder : "border-secondary"
								} ${tierConfig.popular ? tierConfig.accentBorder : ""} transition-all hover:border-opacity-80`}
							>
								{/* Popular Badge */}
								{tierConfig.popular && (
									<div className="absolute -top-3 left-1/2 -translate-x-1/2">
										<Badge className="bg-primary text-white border-0 px-3">
											Most Popular
										</Badge>
									</div>
								)}

								{/* Coming Soon Badge */}
								{tierConfig.comingSoon && (
									<div className="absolute -top-3 left-1/2 -translate-x-1/2">
										<Badge className="bg-accent/20 text-accent border-accent/30 px-3">
											<Sparkles className="w-3 h-3 mr-1" />
											Coming Soon
										</Badge>
									</div>
								)}

								{/* Current Plan Indicator */}
								{isCurrent && (
									<div className="absolute -top-3 right-4">
										<Badge
											variant="outline"
											className={`${tierConfig.accentBorder} ${tierConfig.accentText} bg-background`}
										>
											Current
										</Badge>
									</div>
								)}

								<CardHeader className="text-center pt-8">
									<div className="flex justify-center mb-3">
										<div
											className={`p-3 rounded-full bg-gradient-to-b ${tierConfig.accentBg}`}
										>
											<Icon className={`w-6 h-6 ${tierConfig.accentText}`} />
										</div>
									</div>
									<CardTitle
										className={`text-xl font-bold ${tierConfig.accentText}`}
									>
										{tierConfig.name}
									</CardTitle>
								</CardHeader>

								<CardContent className="text-center">
									{/* Price */}
									<div className="mb-6">
										<div className="flex items-baseline justify-center gap-1">
											<span className="text-4xl font-bold text-white font-data">
												{isAnnual
													? tierConfig.annualMonthly
													: tierConfig.monthlyPrice}
											</span>
											<span className="text-muted-foreground text-sm">/mo</span>
										</div>
										{isAnnual && (
											<p className="text-muted-foreground text-xs mt-1">
												{tierConfig.annualPrice}/year billed annually
											</p>
										)}
									</div>

									{/* Features */}
									<ul className="space-y-3 text-left">
										{tierConfig.features.map((feature) => (
											<li
												key={feature.label}
												className="flex items-start gap-2"
											>
												<Check
													className={`w-4 h-4 mt-0.5 shrink-0 ${tierConfig.accentText}`}
												/>
												<span className="text-sm text-secondary-foreground">
													{feature.label}
												</span>
											</li>
										))}
									</ul>
								</CardContent>

								<CardFooter className="mt-auto">
									{subscriptionLoading ? (
										<Button variant="outline" className="w-full" disabled>
											<Loader2 className="w-4 h-4 mr-2 animate-spin" />
											Loading...
										</Button>
									) : (
										renderCTA(tierConfig)
									)}
								</CardFooter>
							</Card>
						);
					})}
				</div>
			</div>

			{/* Upgrade Confirmation Dialog */}
			<AlertDialog
				open={confirmUpgradeTier !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmUpgradeTier(null);
				}}
			>
				<AlertDialogContent className="bg-surface-2 border-primary/30">
					<AlertDialogHeader>
						<AlertDialogTitle>
							Upgrade to {confirmUpgradeTier ?? ""}
						</AlertDialogTitle>
						<AlertDialogDescription>
							Your payment method on file will be charged a prorated amount for
							the remainder of your current billing period. The new plan takes
							effect immediately.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-primary text-white border-0"
							onClick={() => {
								if (confirmUpgradeTier) {
									handleUpgrade(confirmUpgradeTier);
								}
								setConfirmUpgradeTier(null);
							}}
						>
							Confirm Upgrade
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Cancel Confirmation Dialog */}
			<AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
				<AlertDialogContent className="bg-surface-2 border-destructive/30">
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
						<AlertDialogDescription>
							Your subscription will remain active until the end of your current
							billing period (
							{currentPeriodEnd
								? new Date(currentPeriodEnd).toLocaleDateString()
								: "end of period"}
							). After that, you'll be downgraded to the Free plan.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep subscription</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground"
							onClick={handleCancel}
						>
							{isCanceling ? "Canceling..." : "Yes, cancel"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
