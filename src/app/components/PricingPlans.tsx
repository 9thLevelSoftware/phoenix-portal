import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	Check,
	Clock,
	Crown,
	Flame,
	Loader2,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
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

interface PlanChangeIntent {
	tier: SubscriptionTier;
	priceId: string;
	billingInterval: "monthly" | "annual";
	label: string;
}

interface UpdateSubscriptionResponse {
	success?: boolean;
	action?: "switch" | "uncancel";
	code?: "checkout_required";
	error?: string;
	message?: string;
	subscription?: {
		tier: SubscriptionTier;
		status:
			| "active"
			| "trialing"
			| "past_due"
			| "canceled"
			| "incomplete"
			| "none";
		priceId: string | null;
		currentPeriodEnd: string | null;
		cancelAtPeriodEnd: boolean;
	};
}

interface RefreshSubscriptionResponse {
	status?: "no_subscription" | "refreshed";
	subscription?: {
		tier?: SubscriptionTier;
		status?: UpdateSubscriptionResponse["subscription"] extends infer T
			? T extends { status: infer S }
				? S
				: never
			: never;
		price_id?: string | null;
		priceId?: string | null;
		current_period_end?: string | null;
		currentPeriodEnd?: string | null;
		cancel_at_period_end?: boolean;
		cancelAtPeriodEnd?: boolean;
	};
}

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

function selectedPriceId(tierConfig: TierConfig, isAnnual: boolean): string {
	const tierPricing = TIER_PRICING.find(
		(t: TierPricing) => t.tier === tierConfig.tier,
	);
	return isAnnual
		? (tierPricing?.paddleAnnualPriceId ?? "")
		: (tierPricing?.paddleMonthlyPriceId ?? "");
}

function tierName(tier: SubscriptionTier): string {
	return TIER_PRICING.find((t) => t.tier === tier)?.name ?? tier;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFunctionErrorMessage(
	error: unknown,
	response: Response | undefined,
): Promise<string> {
	if (response) {
		try {
			const body = await response.clone().json();
			if (typeof body?.message === "string") return body.message;
			if (typeof body?.error === "string") return body.error;
		} catch {
			// Fall back to the SDK error below.
		}
	}

	return error instanceof Error
		? error.message
		: "Failed to update subscription";
}

function normalizeSubscriptionPayload(
	subscription:
		| UpdateSubscriptionResponse["subscription"]
		| RefreshSubscriptionResponse["subscription"]
		| undefined,
) {
	if (!subscription) return null;

	return {
		tier: subscription.tier ?? "FREE",
		status: subscription.status ?? "none",
		priceId:
			"priceId" in subscription
				? (subscription.priceId ?? null)
				: (subscription.price_id ?? null),
		currentPeriodEnd:
			"currentPeriodEnd" in subscription
				? (subscription.currentPeriodEnd ?? null)
				: (subscription.current_period_end ?? null),
		cancelAtPeriodEnd:
			"cancelAtPeriodEnd" in subscription
				? Boolean(subscription.cancelAtPeriodEnd)
				: Boolean(subscription.cancel_at_period_end),
	};
}

function isFreshPaidSubscription(
	subscription: ReturnType<typeof normalizeSubscriptionPayload>,
	target: { tier: SubscriptionTier; priceId: string },
): boolean {
	if (!subscription) return false;
	if (
		subscription.tier !== target.tier ||
		subscription.priceId !== target.priceId
	) {
		return false;
	}
	if (subscription.status !== "active" && subscription.status !== "trialing") {
		return false;
	}
	if (!subscription.currentPeriodEnd) return false;

	const periodEndMs = Date.parse(subscription.currentPeriodEnd);
	return Number.isFinite(periodEndMs) && periodEndMs > Date.now();
}

export function PricingPlans() {
	const {
		tier: currentTier,
		priceId: currentPriceId,
		isLoading: subscriptionLoading,
		cancelAtPeriodEnd,
		currentPeriodEnd,
		isEntitled,
		isStale,
	} = useSubscription();
	const { user } = useAuth();
	const [isAnnual, setIsAnnual] = useState(false);
	const queryClient = useQueryClient();
	const [billingActionPriceId, setBillingActionPriceId] = useState<
		string | null
	>(null);
	const [pendingPlanChange, setPendingPlanChange] =
		useState<PlanChangeIntent | null>(null);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [isCanceling, setIsCanceling] = useState(false);
	const [refreshAttemptedForUser, setRefreshAttemptedForUser] = useState<
		string | null
	>(null);

	useEffect(() => {
		if (
			!user ||
			subscriptionLoading ||
			!isStale ||
			refreshAttemptedForUser === user.id
		) {
			return;
		}

		setRefreshAttemptedForUser(user.id);
		void supabase.functions
			.invoke("paddle-refresh-subscription")
			.then(({ error }) => {
				if (error) {
					console.warn("Failed to refresh stale Paddle subscription", error);
				}
			})
			.finally(() => {
				void queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.byUser(user.id),
				});
			});
	}, [
		user,
		subscriptionLoading,
		isStale,
		refreshAttemptedForUser,
		queryClient,
	]);

	const handleSubscribe = async (
		tier: SubscriptionTier,
		explicitPriceId?: string,
	) => {
		const tierPricing = TIER_PRICING.find((t: TierPricing) => t.tier === tier);
		if (!tierPricing) return;

		const priceId =
			explicitPriceId ??
			(isAnnual
				? tierPricing.paddleAnnualPriceId
				: tierPricing.paddleMonthlyPriceId);

		if (!priceId) {
			toast.error("Paddle checkout is not configured yet.");
			return;
		}

		if (!user) {
			toast.error("You must be logged in to subscribe.");
			return;
		}

		const reconcileBillingAfterCheckout = async (
			checkoutTransactionId: string | null,
		) => {
			for (let attempt = 0; attempt < 5; attempt++) {
				if (attempt > 0) {
					await sleep(1500);
				}

				const invokeOptions = checkoutTransactionId
					? { body: { transaction_id: checkoutTransactionId } }
					: undefined;
				const { data, error } =
					await supabase.functions.invoke<RefreshSubscriptionResponse>(
						"paddle-refresh-subscription",
						invokeOptions,
					);

				if (error) {
					console.warn("Failed to refresh subscription after checkout", error);
				}

				const normalized = normalizeSubscriptionPayload(data?.subscription);
				if (normalized) {
					queryClient.setQueryData(queryKeys.subscription.byUser(user.id), {
						tier: normalized.tier,
						status: normalized.status,
						priceId: normalized.priceId,
						currentPeriodEnd: normalized.currentPeriodEnd,
						cancelAtPeriodEnd: normalized.cancelAtPeriodEnd,
					});
				}

				await queryClient.invalidateQueries({
					queryKey: queryKeys.subscription.byUser(user.id),
				});

				if (isFreshPaidSubscription(normalized, { tier, priceId })) {
					return;
				}
			}
		};

		// Mark this checkout in-flight so the Subscribe button can disable and
		// prevent repeated clicks opening multiple checkout attempts.
		setBillingActionPriceId(priceId);
		try {
			await openCheckout({
				priceId,
				userId: user.id,
				userEmail: user.email ?? "",
				onSuccess: (event) => {
					const checkoutTransactionId =
						typeof event.data?.transaction_id === "string"
							? event.data.transaction_id
							: null;
					toast.success("Checkout complete. Finalizing your subscription...");
					void reconcileBillingAfterCheckout(checkoutTransactionId);
				},
			});
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Billing checkout is unavailable. Please try again.";
			toast.error(message);
		} finally {
			setBillingActionPriceId(null);
		}
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

			if (user) {
				void queryClient.invalidateQueries({
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

	const handlePlanChange = async (intent: PlanChangeIntent) => {
		if (!user) {
			toast.error("You must be logged in to manage your subscription.");
			return;
		}

		setBillingActionPriceId(intent.priceId);
		try {
			const { data, error, response } =
				await supabase.functions.invoke<UpdateSubscriptionResponse>(
					"paddle-update-subscription",
					{
						body: {
							tier: intent.tier,
							billing_interval: intent.billingInterval,
							price_id: intent.priceId,
						},
					},
				);

			if (data?.code === "checkout_required") {
				await handleSubscribe(intent.tier, intent.priceId);
				return;
			}

			if (error) {
				toast.error(await getFunctionErrorMessage(error, response));
				return;
			}

			toast.success(
				data?.action === "uncancel"
					? "Cancellation removed. Your subscription will continue renewing."
					: "Subscription updated. Changes may take a moment to reflect.",
			);

			const normalized = normalizeSubscriptionPayload(data?.subscription);
			if (normalized) {
				queryClient.setQueryData(queryKeys.subscription.byUser(user.id), {
					tier: normalized.tier,
					status: normalized.status,
					priceId: normalized.priceId,
					currentPeriodEnd: normalized.currentPeriodEnd,
					cancelAtPeriodEnd: normalized.cancelAtPeriodEnd,
				});
			}

			void queryClient.invalidateQueries({
				queryKey: queryKeys.subscription.byUser(user.id),
			});
		} catch {
			toast.error("An unexpected error occurred");
		} finally {
			setBillingActionPriceId(null);
		}
	};

	const getPlanChangeLabel = (tier: SubscriptionTier, priceId: string) => {
		if (isEntitled && currentTier === tier && currentPriceId !== priceId) {
			return "Switch billing";
		}

		if (TIER_LEVEL[tier] < TIER_LEVEL[currentTier]) {
			return "Downgrade";
		}

		if (TIER_LEVEL[tier] > TIER_LEVEL[currentTier]) {
			return "Upgrade";
		}

		return "Switch plan";
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

		const priceId = selectedPriceId(tierConfig, isAnnual);
		const billingInterval = isAnnual ? "annual" : "monthly";
		if (!priceId) {
			return (
				<Button variant="outline" className="w-full opacity-60" disabled>
					Unavailable
				</Button>
			);
		}

		const isCurrentPrice = isEntitled && currentPriceId === priceId;
		const isBillingActionInFlight = billingActionPriceId === priceId;

		if (isCurrentPrice) {
			if (cancelAtPeriodEnd) {
				return (
					<div className="flex flex-col gap-2 w-full">
						<Button
							className={`w-full ${tierConfig.buttonClass}`}
							onClick={() =>
								void handlePlanChange({
									tier: tierConfig.tier,
									priceId,
									billingInterval,
									label: "Keep plan",
								})
							}
							disabled={isBillingActionInFlight}
						>
							{isBillingActionInFlight ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									Keeping...
								</>
							) : (
								<>
									<RefreshCw className="w-4 h-4 mr-2" />
									Keep plan
								</>
							)}
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

		if (isEntitled) {
			const actionLabel = getPlanChangeLabel(tierConfig.tier, priceId);
			const ActionIcon =
				actionLabel === "Downgrade"
					? ArrowDown
					: actionLabel === "Switch billing"
						? RefreshCw
						: ArrowUp;

			return (
				<Button
					className={`w-full ${tierConfig.buttonClass}`}
					onClick={() =>
						setPendingPlanChange({
							tier: tierConfig.tier,
							priceId,
							billingInterval,
							label: actionLabel,
						})
					}
					disabled={isBillingActionInFlight}
				>
					{isBillingActionInFlight ? (
						<>
							<Loader2 className="w-4 h-4 mr-2 animate-spin" />
							Updating...
						</>
					) : (
						<>
							<ActionIcon className="w-4 h-4 mr-2" />
							{actionLabel}
						</>
					)}
				</Button>
			);
		}

		return (
			<Button
				className={`w-full ${tierConfig.buttonClass}`}
				onClick={() => void handleSubscribe(tierConfig.tier, priceId)}
				disabled={isBillingActionInFlight}
			>
				{isBillingActionInFlight ? (
					<>
						<Loader2 className="w-4 h-4 mr-2 animate-spin" />
						Starting checkout...
					</>
				) : (
					"Subscribe"
				)}
			</Button>
		);
	};

	const planChangeTitle = pendingPlanChange
		? `${pendingPlanChange.label} ${tierName(pendingPlanChange.tier)}`
		: "Change plan";
	const planChangeAction = pendingPlanChange?.label ?? "Confirm";

	return (
		<div className="min-h-screen p-4 md:p-8">
			<div className="max-w-5xl mx-auto">
				<div className="text-center mb-10">
					<h1 className="text-display-2 text-white mb-3">Choose Your Plan</h1>
					<p className="text-muted-foreground text-lg max-w-2xl mx-auto">
						Unlock premium features to get the most out of your training data
					</p>
				</div>

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

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
					{TIERS.map((tierConfig) => {
						const Icon = tierConfig.icon;
						const isCurrent = isEntitled && currentTier === tierConfig.tier;
						const currentPriceMismatch =
							isCurrent &&
							Boolean(currentPriceId) &&
							currentPriceId !== selectedPriceId(tierConfig, isAnnual);

						return (
							<Card
								key={tierConfig.tier}
								className={`relative bg-gradient-to-b ${tierConfig.accentBg} border-2 ${
									isCurrent ? tierConfig.accentBorder : "border-secondary"
								} ${tierConfig.popular ? tierConfig.accentBorder : ""} transition-all hover:border-opacity-80`}
							>
								{tierConfig.popular && (
									<div className="absolute -top-3 left-1/2 -translate-x-1/2">
										<Badge className="bg-primary text-white border-0 px-3">
											Most Popular
										</Badge>
									</div>
								)}

								{tierConfig.comingSoon && (
									<div className="absolute -top-3 left-1/2 -translate-x-1/2">
										<Badge className="bg-accent/20 text-accent border-accent/30 px-3">
											<Sparkles className="w-3 h-3 mr-1" />
											Coming Soon
										</Badge>
									</div>
								)}

								{isCurrent && (
									<div className="absolute -top-3 right-4">
										<Badge
											variant="outline"
											className={`${tierConfig.accentBorder} ${tierConfig.accentText} bg-background`}
										>
											{currentPriceMismatch ? "Current Tier" : "Current"}
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

			<AlertDialog
				open={pendingPlanChange !== null}
				onOpenChange={(open) => {
					if (!open) setPendingPlanChange(null);
				}}
			>
				<AlertDialogContent className="bg-surface-2 border-primary/30">
					<AlertDialogHeader>
						<AlertDialogTitle>{planChangeTitle}</AlertDialogTitle>
						<AlertDialogDescription>
							Paddle will apply prorated billing immediately. If you had a
							scheduled cancellation, this will keep the subscription active.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-primary text-white border-0"
							onClick={() => {
								if (pendingPlanChange) {
									void handlePlanChange(pendingPlanChange);
								}
								setPendingPlanChange(null);
							}}
						>
							{planChangeAction}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

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
