// SINGLE SOURCE OF TRUTH for tier pricing. Do NOT hardcode prices elsewhere.
// All components displaying prices should import from this module.

import type { SubscriptionTier } from "@/schemas/subscription";

export interface TierPricing {
	name: string;
	tier: SubscriptionTier;
	monthlyPrice: string;
	annualPrice: string;
	annualMonthly: string;
	paddleMonthlyPriceId: string;
	paddleAnnualPriceId: string;
	features: string[];
	comingSoon?: boolean;
}

export const TIER_PRICING: TierPricing[] = [
	{
		name: "Ember",
		tier: "EMBER",
		monthlyPrice: "$5",
		annualPrice: "$49",
		annualMonthly: "$4.08",
		paddleMonthlyPriceId:
			import.meta.env.VITE_PADDLE_EMBER_MONTHLY_PRICE_ID ?? "",
		paddleAnnualPriceId:
			import.meta.env.VITE_PADDLE_EMBER_ANNUAL_PRICE_ID ?? "",
		features: [
			"Cloud sync & backup",
			"Restore workouts across devices",
			"Workout history & personal records",
			"Leaderboards & challenges",
		],
	},
	{
		name: "Flame",
		tier: "FLAME",
		monthlyPrice: "$15",
		annualPrice: "$149",
		annualMonthly: "$12.42",
		paddleMonthlyPriceId:
			import.meta.env.VITE_PADDLE_FLAME_MONTHLY_PRICE_ID ?? "",
		paddleAnnualPriceId:
			import.meta.env.VITE_PADDLE_FLAME_ANNUAL_PRICE_ID ?? "",
		features: [
			"Everything in Ember",
			"Community hub & routine sharing",
			"Advanced analytics & charts",
			"Third-party connections (Strava, Hevy, Liftosaur)",
		],
	},
	{
		name: "Inferno",
		tier: "INFERNO",
		monthlyPrice: "$25",
		annualPrice: "$249",
		annualMonthly: "$20.75",
		paddleMonthlyPriceId:
			import.meta.env.VITE_PADDLE_INFERNO_MONTHLY_PRICE_ID ?? "",
		paddleAnnualPriceId:
			import.meta.env.VITE_PADDLE_INFERNO_ANNUAL_PRICE_ID ?? "",
		features: [
			"Everything in Flame",
			"Advanced analytics & biomechanics",
			"Force curves & VBT zones",
			"Session replay with 50Hz telemetry",
		],
		comingSoon: true,
	},
];
