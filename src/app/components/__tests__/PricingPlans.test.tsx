import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => ({
		user: { id: "user-1", email: "user@example.com" },
	}),
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
