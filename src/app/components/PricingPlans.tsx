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

interface TierConfig {
	name: string;
	tier: SubscriptionTier;
	icon: typeof Flame;
	monthlyPrice: string;
	annualPrice: string;
	annualMonthly: string;
	features: TierFeature[];
	accentBorder: string;
	accentBg: string;
	accentText: string;
	buttonClass: string;
	popular?: boolean;
}

const TIERS: TierConfig[] = [
	{
		name: "Free",
		tier: "FREE",
		icon: Flame,
		monthlyPrice: "$0",
		annualPrice: "$0",
		annualMonthly: "$0",
		features: [
			{ label: "Basic workout tracking" },
			{ label: "Limited session history" },
			{ label: "Community browsing" },
		],
		accentBorder: "border-zinc-700",
		accentBg: "from-zinc-800/50 to-zinc-900/50",
		accentText: "text-zinc-400",
		buttonClass: "",
	},
	{
		name: "Phoenix",
		tier: "PHOENIX",
		icon: Flame,
		monthlyPrice: "$14.99",
		annualPrice: "$149.99",
		annualMonthly: "$12.50",
		features: [
			{ label: "Everything in Free" },
			{ label: "Advanced analytics" },
			{ label: "Force curves & VBT zones" },
			{ label: "Community sharing" },
			{ label: "Unlimited history" },
		],
		accentBorder: "border-[#FF6B35]",
		accentBg: "from-[#FF6B35]/10 to-[#DC2626]/10",
		accentText: "text-[#FF6B35]",
		buttonClass:
			"bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#FF6B35]/90 hover:to-[#DC2626]/90 text-white border-0",
		popular: true,
	},
	{
		name: "Elite",
		tier: "ELITE",
		icon: Crown,
		monthlyPrice: "$24.99",
		annualPrice: "$249.99",
		annualMonthly: "$20.83",
		features: [
			{ label: "Everything in Phoenix" },
			{ label: "Session replay" },
			{ label: "50Hz telemetry data" },
			{ label: "Advanced VBT analytics" },
			{ label: "Priority support" },
		],
		accentBorder: "border-[#F59E0B]",
		accentBg: "from-[#F59E0B]/10 to-[#B45309]/10",
		accentText: "text-[#F59E0B]",
		buttonClass:
			"bg-gradient-to-r from-[#F59E0B] to-[#B45309] hover:from-[#F59E0B]/90 hover:to-[#B45309]/90 text-black border-0",
	},
];

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

	const handleSubscribe = async (tier: SubscriptionTier) => {
		if (tier === "FREE") return;

		const priceId = isAnnual ? PRICE_IDS[tier].annual : PRICE_IDS[tier].monthly;

		if (!priceId) {
			toast.error("Price configuration missing. Please contact support.");
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

		return (
			<Button
				className={`w-full ${tierConfig.buttonClass}`}
				onClick={() => handleSubscribe(tierConfig.tier)}
				disabled={isLoading || loadingTier !== null}
			>
				{isLoading ? (
					<>
						<Loader2 className="w-4 h-4 mr-2 animate-spin" />
						Redirecting...
					</>
				) : (
					`Subscribe to ${tierConfig.name}`
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
					<p className="text-[#9CA3AF] text-lg max-w-2xl mx-auto">
						Unlock premium features to get the most out of your training data
					</p>
				</div>

				{/* Billing Toggle */}
				<div className="flex items-center justify-center gap-3 mb-10">
					<span
						className={`text-sm font-medium ${!isAnnual ? "text-white" : "text-[#9CA3AF]"}`}
					>
						Monthly
					</span>
					<Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
					<span
						className={`text-sm font-medium ${isAnnual ? "text-white" : "text-[#9CA3AF]"}`}
					>
						Annual
					</span>
					{isAnnual && (
						<Badge className="bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30">
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
									isCurrent ? tierConfig.accentBorder : "border-[#374151]"
								} ${tierConfig.popular ? tierConfig.accentBorder : ""} transition-all hover:border-opacity-80`}
							>
								{/* Popular Badge */}
								{tierConfig.popular && (
									<div className="absolute -top-3 left-1/2 -translate-x-1/2">
										<Badge className="bg-[#FF6B35] text-white border-0 px-3">
											Most Popular
										</Badge>
									</div>
								)}

								{/* Current Plan Indicator */}
								{isCurrent && (
									<div className="absolute -top-3 right-4">
										<Badge
											variant="outline"
											className={`${tierConfig.accentBorder} ${tierConfig.accentText} bg-[#0D0D0D]`}
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
											<span className="text-[#9CA3AF] text-sm">/mo</span>
										</div>
										{isAnnual && tierConfig.tier !== "FREE" && (
											<p className="text-[#9CA3AF] text-xs mt-1">
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
												<span className="text-sm text-[#E5E7EB]">
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
