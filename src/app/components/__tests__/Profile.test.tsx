import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionTier } from "@/hooks/useSubscription";
import { renderWithProviders } from "@/test/test-utils";
import { Profile } from "../Profile";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);

const mockSubscription = vi.hoisted(() => ({
	current: {
		tier: "FREE" as SubscriptionTier,
		rawTier: "FREE" as SubscriptionTier,
		status: "none",
		priceId: null as string | null,
		currentPeriodEnd: null as string | null,
		cancelAtPeriodEnd: false,
		isEntitled: false,
		billingAction: "checkout" as "manage" | "refresh" | "checkout",
		needsPaymentUpdate: false,
		isStale: false,
		isLoading: false,
		isError: false,
		error: null,
		refetch: vi.fn(),
		isPremium: false,
		isFlame: false,
		isInferno: false,
	},
}));

vi.mock("@/hooks/useSubscription", () => ({
	useSubscription: () => mockSubscription.current,
}));

function setSubscription(
	overrides: Partial<typeof mockSubscription.current> = {},
) {
	mockSubscription.current = { ...mockSubscription.current, ...overrides };
}

describe("Profile", () => {
	beforeEach(() => {
		setSubscription({
			tier: "FREE",
			rawTier: "FREE",
			status: "none",
			priceId: null,
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			isEntitled: false,
			billingAction: "checkout",
			needsPaymentUpdate: false,
			isStale: false,
			isPremium: false,
			isFlame: false,
			isInferno: false,
		});
	});

	it("renders without crashing", () => {
		const { container } = renderWithProviders(<Profile />);
		expect(container.firstChild).toBeTruthy();
	});

	it("tells a past_due subscriber their payment failed DURING the retry window", () => {
		// `isStale` stays false for a past_due row until
		// PAST_DUE_REFRESH_AFTER_DAYS past the period end — precisely the
		// dunning window the notice exists for — so it must not be the gate
		// (plan-alignment R-41).
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "past_due",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2026-05-07T00:00:00Z",
			isEntitled: true,
			billingAction: "manage",
			needsPaymentUpdate: true,
			isStale: false,
			isPremium: true,
			isFlame: true,
		});

		renderWithProviders(<Profile />);

		expect(screen.getByTestId("profile-past-due-notice")).toHaveTextContent(
			/your last payment failed — update your card to keep your plan/i,
		);
		// The CTA says what to do, and points at the page that owns the
		// update-payment flow.
		const cta = screen.getByRole("link", { name: /update payment/i });
		expect(cta).toHaveAttribute("href", "/pricing");
	});

	it("shows no past-due notice for a healthy subscription", () => {
		setSubscription({
			tier: "FLAME",
			rawTier: "FLAME",
			status: "active",
			priceId: "pri_flame_monthly",
			currentPeriodEnd: "2999-05-07T00:00:00Z",
			isEntitled: true,
			billingAction: "manage",
			needsPaymentUpdate: false,
			isPremium: true,
			isFlame: true,
		});

		renderWithProviders(<Profile />);

		expect(
			screen.queryByTestId("profile-past-due-notice"),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /manage plan/i }),
		).toBeInTheDocument();
	});
});
