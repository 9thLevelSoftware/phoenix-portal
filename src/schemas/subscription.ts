import { z } from "zod";

export const subscriptionTierSchema = z.enum([
	"FREE",
	"EMBER",
	"FLAME",
	"INFERNO",
]);

export const subscriptionStatusSchema = z.enum([
	"active",
	"past_due",
	"canceled",
	"trialing",
	"incomplete",
	"none",
]);

export type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
