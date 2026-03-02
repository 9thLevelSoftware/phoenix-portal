// SINGLE SOURCE OF TRUTH for tier pricing. Do NOT hardcode prices elsewhere.
// All components displaying prices should import from this module.

import type { SubscriptionTier } from "@/hooks/useSubscription";

export interface TierPricing {
	name: string;
	tier: SubscriptionTier;
	monthlyPrice: string;
	annualPrice: string;
	annualMonthly: string;
	features: string[];
}

export const TIER_PRICING: TierPricing[] = [
	{
		name: "Free",
		tier: "FREE",
		monthlyPrice: "$0",
		annualPrice: "$0",
		annualMonthly: "$0",
		features: [
			"Basic workout tracking",
			"Limited session history",
			"Community browsing",
		],
	},
	{
		name: "Phoenix",
		tier: "PHOENIX",
		monthlyPrice: "$14.99",
		annualPrice: "$149.99",
		annualMonthly: "$12.50",
		features: [
			"Everything in Free",
			"Advanced analytics",
			"Force curves & VBT zones",
			"Community sharing",
			"Unlimited history",
		],
	},
	{
		name: "Elite",
		tier: "ELITE",
		monthlyPrice: "$24.99",
		annualPrice: "$249.99",
		annualMonthly: "$20.83",
		features: [
			"Everything in Phoenix",
			"Session replay",
			"50Hz telemetry data",
			"Advanced VBT analytics",
			"Priority support",
		],
	},
];
