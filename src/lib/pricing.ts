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
	comingSoon?: boolean;
}

export const TIER_PRICING: TierPricing[] = [
	{
		name: "Ember",
		tier: "EMBER",
		monthlyPrice: "$10",
		annualPrice: "$99",
		annualMonthly: "$8.25",
		features: [
			"Cloud sync & backup on multiple devices",
			"Unlimited workout history",
			"Community sharing & routines",
			"Third-party connections (Strava, Fitbit, Garmin, Hevy)",
		],
	},
	{
		name: "Inferno",
		tier: "INFERNO",
		monthlyPrice: "$20",
		annualPrice: "$199",
		annualMonthly: "$16.58",
		features: [
			"Everything in Ember",
			"Advanced analytics & biomechanics",
			"Force curves & VBT zones",
			"Session replay with 50Hz telemetry",
		],
		comingSoon: true,
	},
];
