import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionTier } from "@/hooks/useSubscription";
import { renderWithProviders } from "@/test/test-utils";
import { PricingPlans } from "../PricingPlans";

const mockSubscription = vi.hoisted(() => ({
	current: {
		tier: "FREE" as SubscriptionTier,
		rawTier: "FREE" as SubscriptionTier,
		status: "none",
		priceId: null as string | null,
		currentPeriodEnd: null as string | null,
		cancelAtPeriodEnd: false,
		isEntitled: false,
		isStale: false,
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
		isPremium: false,
		isFlame: false,
		isInferno: false,
	},
}));

const mockInvoke = vi.hoisted(() => vi.fn());
const mockOpenCheckout = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useSubscription", () => ({
	useSubscription: () => mockSubscription.current,
}));

const mockAuth = vi.hoisted(() => ({
	current: { id: "user-1", email: "user@example.com" },
}));

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => ({ user: mockAuth.current }),
}));

vi.mock("@/lib/supabase", () => ({
	supabase: {
		functions: {
			invoke: mockInvoke,
		},
	},
}));

vi.mock("@/lib/paddle-client", () => ({
	openCheckout: mockOpenCheckout,
}));

const mockPricing = vi.hoisted(() => ({
	TIER_PRICING: [
		{
			name: "Ember",
			tier: "EMBER",
			monthlyPrice: "$5",
			annualPrice: "$49",
			annualMonthly: "$4.08",
			paddleMonthlyPriceId: "pri_ember_monthly",
			paddleAnnualPriceId: "pri_ember_annual",
			features: ["Cloud sync"],
		},
		{
			name: "Flame",
			tier: "FLAME",
			monthlyPrice: "$15",
			annualPrice: "$149",
			annualMonthly: "$12.42",
			paddleMonthlyPriceId: "pri_flame_monthly",
			paddleAnnualPriceId: "pri_flame_annual",
			features: ["Everything in Ember"],
		},
		{
			name: "Inferno",
			tier: "INFERNO",
			monthlyPrice: "$25",
			annualPrice: "$249",
			annualMonthly: "$20.75",
			paddleMonthlyPriceId: "pri_inferno_monthly",
			paddleAnnualPriceId: "pri_inferno_annual",
			features: ["Everything in Flame"],
			comingSoon: false,
		},
	],
}));
vi.mock("@/lib/pricing", () => mockPricing);

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

function setSubscription(overrides: Partial<typeof mockSubscription.current>) {
	mockSubscription.current = {
		tier: "FREE",
		rawTier: "FREE",
		status: "none",
		priceId: null,
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		isEntitled: false,
		isStale: false,
		isLoading: false,
		isError: false,
		refetch: vi.fn(),
		isPremium: false,
		isFlame: false,
		isInferno: false,
		...overrides,
	};
}

describe("PricingPlans billing actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
		mockOpenCheckout.mockResolvedValue(undefined);
		setSubscription({});
		mockPricing.TIER_PRICING[2].paddleMonthlyPriceId = "pri_inferno_monthly";
		mockPricing.TIER_PRICING[2].paddleAnnualPriceId = "pri_inferno_annual";
		mockPricing.TIER_PRICING[2].comingSoon = false;
	});

	it("treats expired scheduled cancellations as subscribable and refreshes once", async () => {
		setSubscription({
			tier: "FREE",
			rawTier: "FLAME",
			status: "active",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2026-04-17T00:00:00Z",
			cancelAtPeriodEnd: true,
			isEntitled: false,
			isStale: true,
		});

		renderWithProviders(<PricingPlans />);

		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("paddle-refresh-subscription");
		});
		expect(screen.getAllByRole("button", { name: /subscribe/i }).length).toBe(
			3,
		);
		expect(
			screen.queryByRole("button", { name: /keep plan/i }),
		).not.toBeInTheDocument();
	});

	it("offers Keep plan for a future scheduled cancellation", async () => {
		const user = userEvent.setup();
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "active",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2999-04-17T00:00:00Z",
			cancelAtPeriodEnd: true,
			isEntitled: true,
			isStale: false,
			isPremium: true,
			isFlame: true,
		});

		renderWithProviders(<PricingPlans />);
		await user.click(screen.getByRole("button", { name: /keep plan/i }));

		expect(mockInvoke).toHaveBeenCalledWith("paddle-update-subscription", {
			body: {
				tier: "FLAME",
				billing_interval: "monthly",
				price_id: "pri_flame_monthly",
			},
		});
	});

	it("shows the update-payment message when a past_due plan change is refused", async () => {
		const user = userEvent.setup();
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "past_due",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2026-05-07T00:00:00Z",
			isEntitled: true,
			isPremium: true,
			isFlame: true,
		});
		mockInvoke.mockResolvedValue({
			data: null,
			error: new Error("Edge Function returned a non-2xx status code"),
			response: new Response(
				JSON.stringify({
					error: "payment_past_due",
					code: "payment_past_due",
					message:
						"Your last payment failed. Update your payment method before changing your plan.",
				}),
				{ status: 409 },
			),
		});

		renderWithProviders(<PricingPlans />);
		await user.click(screen.getByRole("button", { name: /downgrade/i }));
		await user.click(screen.getByRole("button", { name: /^downgrade$/i }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				"Your last payment failed. Update your payment method before changing your plan.",
			);
		});
		expect(mockOpenCheckout).not.toHaveBeenCalled();
	});

	it("lets a past_due user cancel and reports immediate cancellation", async () => {
		const user = userEvent.setup();
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "past_due",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2026-05-07T00:00:00Z",
			isEntitled: true,
			isPremium: true,
			isFlame: true,
		});
		mockInvoke.mockResolvedValue({
			data: {
				success: true,
				cancelAtPeriodEnd: false,
				canceledImmediately: true,
			},
			error: null,
		});

		renderWithProviders(<PricingPlans />);
		await user.click(
			screen.getByRole("button", { name: /cancel subscription/i }),
		);
		expect(
			screen.getByText(/canceling ends your paid access immediately/i),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /yes, cancel/i }));

		expect(mockInvoke).toHaveBeenCalledWith("paddle-cancel-subscription");
		await waitFor(() => {
			expect(toast.success).toHaveBeenCalledWith(
				"Subscription canceled. Your paid access has ended.",
			);
		});
	});

	it("offers a lower paid tier as a downgrade instead of included", () => {
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "active",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2999-04-17T00:00:00Z",
			isEntitled: true,
			isPremium: true,
			isFlame: true,
		});

		renderWithProviders(<PricingPlans />);

		expect(
			screen.getByRole("button", { name: /downgrade/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByText(/included in your plan/i),
		).not.toBeInTheDocument();
	});

	it("submits downgrade requests with tier, billing interval, and fallback price id", async () => {
		const user = userEvent.setup();
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "active",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2999-04-17T00:00:00Z",
			isEntitled: true,
			isPremium: true,
			isFlame: true,
		});

		renderWithProviders(<PricingPlans />);
		await user.click(screen.getByRole("button", { name: /downgrade/i }));
		await user.click(screen.getByRole("button", { name: /^downgrade$/i }));

		expect(mockInvoke).toHaveBeenCalledWith("paddle-update-subscription", {
			body: {
				tier: "EMBER",
				billing_interval: "monthly",
				price_id: "pri_ember_monthly",
			},
		});
	});

	it("offers a billing-cycle switch when the selected price differs", async () => {
		const user = userEvent.setup();
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "active",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2999-04-17T00:00:00Z",
			isEntitled: true,
			isPremium: true,
			isFlame: true,
		});

		renderWithProviders(<PricingPlans />);
		await user.click(screen.getByRole("switch", { name: /annual billing/i }));

		expect(
			screen.getByRole("button", { name: /switch billing/i }),
		).toBeInTheDocument();
	});

	it("refreshes billing state after checkout completes", async () => {
		const user = userEvent.setup();
		mockOpenCheckout.mockImplementationOnce(async ({ onSuccess }) => {
			onSuccess?.({
				name: "checkout.completed",
				data: { transaction_id: "txn_01h00000000000000000000000" },
			});
		});
		mockInvoke.mockImplementation((name: string) => {
			if (name === "paddle-refresh-subscription") {
				return Promise.resolve({
					data: {
						status: "refreshed",
						subscription: {
							tier: "FLAME",
							status: "active",
							priceId: "pri_flame_monthly",
							currentPeriodEnd: "2999-04-17T00:00:00Z",
							cancelAtPeriodEnd: false,
						},
					},
					error: null,
				});
			}
			return Promise.resolve({ data: { success: true }, error: null });
		});

		renderWithProviders(<PricingPlans />);
		const subscribeButtons = screen.getAllByRole("button", {
			name: /subscribe/i,
		});
		expect(subscribeButtons).toHaveLength(3);
		await user.click(subscribeButtons[1]);

		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("paddle-refresh-subscription", {
				body: { transaction_id: "txn_01h00000000000000000000000" },
			});
		});
	});

	describe("when the webhook is slow", () => {
		const TXN = "txn_01h00000000000000000000000";
		const BANNER = "checkout-activation-pending";
		const refreshCalls = () =>
			mockInvoke.mock.calls.filter(
				([name]) => name === "paddle-refresh-subscription",
			).length;
		const banner = () => screen.queryByTestId(BANNER);
		const entitledFlame = (
			overrides: Partial<typeof mockSubscription.current> = {},
		) =>
			setSubscription({
				tier: "FLAME",
				rawTier: "FLAME",
				status: "active",
				priceId: "pri_flame_monthly",
				currentPeriodEnd: "2999-04-17T00:00:00Z",
				isEntitled: true,
				isPremium: true,
				isFlame: true,
				...overrides,
			});

		function completeCheckoutOnOpen() {
			mockOpenCheckout.mockImplementation(async ({ onSuccess }) => {
				onSuccess?.({
					name: "checkout.completed",
					data: { transaction_id: TXN },
				});
			});
		}

		function refreshReturnsNothing() {
			mockInvoke.mockImplementation(() =>
				Promise.resolve({ data: { status: "no_subscription" }, error: null }),
			);
		}

		/** Render, buy Flame monthly, and step through all 5 reconciliation attempts. */
		async function buyFlameAndExhaustReconciliation() {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			const view = renderWithProviders(<PricingPlans />);
			await user.click(
				screen.getAllByRole("button", { name: /subscribe/i })[1],
			);
			await waitFor(() => expect(refreshCalls()).toBe(1));
			for (let attempt = 2; attempt <= 5; attempt++) {
				await vi.advanceTimersByTimeAsync(1500);
				await waitFor(() => expect(refreshCalls()).toBe(attempt));
			}
			return { ...view, user };
		}

		beforeEach(() => {
			completeCheckoutOnOpen();
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
			mockAuth.current = { id: "user-1", email: "user@example.com" };
		});

		it("shows a pending-activation banner only after the last attempt and clears it on the matching realtime update", async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			refreshReturnsNothing();

			const { rerender } = renderWithProviders(<PricingPlans />);
			await user.click(
				screen.getAllByRole("button", { name: /subscribe/i })[1],
			);

			await waitFor(() => expect(refreshCalls()).toBe(1));
			expect(banner()).not.toBeInTheDocument();

			// Attempts 2-4: no banner while reconciliation is still running.
			for (let attempt = 2; attempt <= 4; attempt++) {
				await vi.advanceTimersByTimeAsync(1500);
				await waitFor(() => expect(refreshCalls()).toBe(attempt));
				expect(banner()).not.toBeInTheDocument();
			}

			// The fifth and final attempt also comes back without the plan.
			await vi.advanceTimersByTimeAsync(1500);
			const shown = await screen.findByTestId(BANNER);
			expect(refreshCalls()).toBe(5);
			expect(shown).toHaveAttribute("role", "status");
			expect(shown).toHaveTextContent(
				"Payment received — activation can take a minute. This page updates automatically.",
			);

			// Persistent: time passing alone neither clears it nor re-runs checkout
			// reconciliation.
			await vi.advanceTimersByTimeAsync(60_000);
			expect(banner()).toBeInTheDocument();
			expect(refreshCalls()).toBe(5);

			// Same tier but a different price (interval) is not the plan just paid for.
			entitledFlame({ priceId: "pri_flame_annual" });
			rerender(<PricingPlans />);
			expect(banner()).toBeInTheDocument();

			// Matching tier+price that is not entitled (e.g. period ended) doesn't count.
			entitledFlame({ tier: "FREE", isEntitled: false });
			rerender(<PricingPlans />);
			expect(banner()).toBeInTheDocument();

			// Simulated realtime `subscriptions` update: the purchased plan is live.
			entitledFlame();
			rerender(<PricingPlans />);
			expect(banner()).not.toBeInTheDocument();
		});

		it("still shows the banner when every refresh call errors", async () => {
			mockInvoke.mockImplementation(() =>
				Promise.resolve({ data: null, error: new Error("boom") }),
			);
			vi.spyOn(console, "warn").mockImplementation(() => {});

			await buyFlameAndExhaustReconciliation();

			expect(await screen.findByTestId(BANNER)).toBeInTheDocument();
			expect(refreshCalls()).toBe(5);
		});

		it("never shows the banner when the realtime update lands mid-reconciliation", async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			refreshReturnsNothing();

			const { rerender } = renderWithProviders(<PricingPlans />);
			await user.click(
				screen.getAllByRole("button", { name: /subscribe/i })[1],
			);
			await waitFor(() => expect(refreshCalls()).toBe(1));

			// Webhook lands (realtime) before reconciliation gives up.
			entitledFlame();
			rerender(<PricingPlans />);

			await vi.advanceTimersByTimeAsync(10_000);
			expect(refreshCalls()).toBe(5);
			expect(banner()).not.toBeInTheDocument();
		});

		it("disables Subscribe for the just-paid price while activation is pending", async () => {
			refreshReturnsNothing();

			await buyFlameAndExhaustReconciliation();
			await screen.findByTestId(BANNER);

			expect(
				screen.getByRole("button", { name: /activating/i }),
			).toBeDisabled();
			// Only the other tiers remain purchasable.
			expect(
				screen.getAllByRole("button", { name: /^subscribe$/i }),
			).toHaveLength(2);
		});

		it("polls the subscription while pending so a missed realtime event still clears the banner", async () => {
			refreshReturnsNothing();
			const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");

			await buyFlameAndExhaustReconciliation();
			await screen.findByTestId(BANNER);
			invalidate.mockClear();

			await vi.advanceTimersByTimeAsync(20_000);
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: ["subscription", "user-1"],
			});
		});

		it("clears the banner when a new checkout starts", async () => {
			refreshReturnsNothing();

			const { user } = await buyFlameAndExhaustReconciliation();
			await screen.findByTestId(BANNER);

			// Checkout for a different plan: open it but never complete.
			mockOpenCheckout.mockImplementation(async () => {});
			await user.click(
				screen.getAllByRole("button", { name: /^subscribe$/i })[0],
			);

			await waitFor(() => expect(banner()).not.toBeInTheDocument());
		});

		it("does not carry the banner over to a different signed-in user", async () => {
			refreshReturnsNothing();

			const { rerender } = await buyFlameAndExhaustReconciliation();
			await screen.findByTestId(BANNER);

			mockAuth.current = { id: "user-2", email: "other@example.com" };
			rerender(<PricingPlans />);

			expect(banner()).not.toBeInTheDocument();
		});

		it("does not show the banner when reconciliation confirms the plan", async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
			mockInvoke.mockImplementation(() =>
				Promise.resolve({
					data: {
						status: "refreshed",
						subscription: {
							tier: "FLAME",
							status: "active",
							priceId: "pri_flame_monthly",
							currentPeriodEnd: "2999-04-17T00:00:00Z",
							cancelAtPeriodEnd: false,
						},
					},
					error: null,
				}),
			);

			renderWithProviders(<PricingPlans />);
			await user.click(
				screen.getAllByRole("button", { name: /subscribe/i })[1],
			);

			await waitFor(() => expect(refreshCalls()).toBe(1));
			// Well past the full 5-attempt window.
			await vi.advanceTimersByTimeAsync(10_000);
			expect(refreshCalls()).toBe(1);
			expect(banner()).not.toBeInTheDocument();
		});
	});

	it("offers Inferno checkout when price IDs are configured", () => {
		renderWithProviders(<PricingPlans />);

		expect(screen.getAllByRole("button", { name: /subscribe/i })).toHaveLength(
			3,
		);
		expect(
			screen.queryByRole("button", { name: /coming soon/i }),
		).not.toBeInTheDocument();
	});

	it("shows Unavailable for Inferno when price IDs are empty", () => {
		mockPricing.TIER_PRICING[2].paddleMonthlyPriceId = "";
		mockPricing.TIER_PRICING[2].paddleAnnualPriceId = "";

		renderWithProviders(<PricingPlans />);

		expect(screen.getByRole("button", { name: /unavailable/i })).toBeDisabled();
		expect(
			screen.queryByRole("button", { name: /coming soon/i }),
		).not.toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: /subscribe/i })).toHaveLength(
			2,
		);
	});

	it("shows retry instead of Subscribe when billing status fails to load", () => {
		setSubscription({ isError: true, tier: "FREE" });

		renderWithProviders(<PricingPlans />);

		expect(screen.getByTestId("billing-status-error")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /subscribe/i }),
		).not.toBeInTheDocument();
	});
});
