import { Check, Crown, Flame, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
	type SubscriptionTier,
	useSubscription,
} from "@/hooks/useSubscription";
import { TIER_PRICING } from "@/lib/pricing";
import { redirectToCheckout } from "@/lib/stripe";

const PRICE_IDS = {
	PHOENIX: {
		monthly: import.meta.env.VITE_STRIPE_PHOENIX_MONTHLY_PRICE_ID ?? "",
		annual: import.meta.env.VITE_STRIPE_PHOENIX_ANNUAL_PRICE_ID ?? "",
	},
	ELITE: {
		monthly: import.meta.env.VITE_STRIPE_ELITE_MONTHLY_PRICE_ID ?? "",
		annual: import.meta.env.VITE_STRIPE_ELITE_ANNUAL_PRICE_ID ?? "",
	},
} as const;

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
	PHOENIX: {
		icon: Flame,
		accentBorder: "border-primary",
		accentBg: "from-primary/10 to-chart-2/10",
		accentText: "text-primary",
		buttonClass:
			"bg-gradient-to-r from-primary to-chart-2 hover:from-primary/90 hover:to-chart-2/90 text-white border-0",
		popular: true,
	},
	ELITE: {
		icon: Crown,
		accentBorder: "border-accent",
		accentBg: "from-accent/10 to-[#B45309]/10",
		accentText: "text-accent",
		buttonClass:
			"bg-gradient-to-r from-accent to-[#B45309] hover:from-accent/90 hover:to-[#B45309]/90 text-black border-0",
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
}));

const TIER_LEVEL: Record<SubscriptionTier, number> = {
	FREE: 0,
	PHOENIX: 1,
	ELITE: 2,
};

export function PricingPlans() {
	const { tier: currentTier, isLoading: subscriptionLoading } =
		useSubscription();
	const [isAnnual, setIsAnnual] = useState(false);
	const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);

	const isPriceConfigured = (tier: SubscriptionTier): boolean => {
		if (tier === "FREE") return true;
		const id = isAnnual ? PRICE_IDS[tier].annual : PRICE_IDS[tier].monthly;
		return !!id;
	};

	const handleSubscribe = async (tier: SubscriptionTier) => {
		if (tier === "FREE") return;

		const priceId = isAnnual ? PRICE_IDS[tier].annual : PRICE_IDS[tier].monthly;

		if (!priceId) {
			toast.info(
				"Subscriptions are coming soon! We're still setting up payments.",
			);
			return;
		}

		setLoadingTier(tier);
		try {
			await redirectToCheckout(priceId);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to start checkout",
			);
			setLoadingTier(null);
		}
	};

	const renderCTA = (tierConfig: TierConfig) => {
		if (tierConfig.tier === "FREE") {
			if (currentTier === "FREE") {
				return (
					<Button variant="outline" className="w-full" disabled>
						Current Plan
					</Button>
				);
			}
			return null;
		}

		if (currentTier === tierConfig.tier) {
			return (
				<Button variant="outline" className="w-full" disabled>
					Current Plan
				</Button>
			);
		}

		if (TIER_LEVEL[currentTier] > TIER_LEVEL[tierConfig.tier]) {
			return (
				<Button variant="outline" className="w-full opacity-50" disabled>
					Included in {currentTier === "ELITE" ? "Elite" : "Phoenix"}
				</Button>
			);
		}

		const isLoading = loadingTier === tierConfig.tier;
		const priceReady = isPriceConfigured(tierConfig.tier);

		return (
			<Button
				className={`w-full ${priceReady ? tierConfig.buttonClass : ""}`}
				variant={priceReady ? "default" : "outline"}
				onClick={() => handleSubscribe(tierConfig.tier)}
				disabled={isLoading || loadingTier !== null}
			>
				{isLoading ? (
					<>
						<Loader2 className="w-4 h-4 mr-2 animate-spin" />
						Redirecting...
					</>
				) : priceReady ? (
					`Subscribe to ${tierConfig.name}`
				) : (
					"Coming Soon"
				)}
			</Button>
		);
	};

	return (
		<div className="min-h-screen p-4 md:p-8">
			<div className="max-w-5xl mx-auto">
				{/* Header */}
				<div className="text-center mb-10">
					<h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
						Choose Your Plan
					</h1>
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
					<Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
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
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
											<span className="text-4xl font-bold text-white">
												{isAnnual
													? tierConfig.annualMonthly
													: tierConfig.monthlyPrice}
											</span>
											<span className="text-muted-foreground text-sm">/mo</span>
										</div>
										{isAnnual && tierConfig.tier !== "FREE" && (
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
		</div>
	);
}
