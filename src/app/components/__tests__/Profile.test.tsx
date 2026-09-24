import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionTier } from "@/hooks/useSubscription";
import { renderWithProviders } from "@/test/test-utils";
import { formatProfileVolume, Profile } from "../Profile";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockData = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: (options: { queryKey?: unknown[] }) => {
			const key = options.queryKey ?? [];
			const data = !mockData.enabled
				? undefined
				: key[1] === "stats"
					? { totalWorkouts: 3, totalVolume: 1500, bestStreak: 1, prCount: 0 }
					: key[1] === "gamification"
						? { total_volume_kg: 99000, total_workouts: 3, total_reps: 10 }
						: undefined;
			return {
				data,
				isPending: false,
				isError: false,
				error: null,
				refetch: () => Promise.resolve(),
			};
		},
	};
});

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
		mockData.enabled = false;
		const { container } = renderWithProviders(<Profile />);
		expect(container.firstChild).toBeTruthy();
	});

	it("opens the tab named in ?tab= (the sidebar's Settings link)", () => {
		mockData.enabled = false;
		render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter initialEntries={["/profile?tab=settings"]}>
					<Profile />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("falls back to the stats tab for an unknown ?tab=", () => {
		mockData.enabled = false;
		render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter initialEntries={["/profile?tab=nope"]}>
					<Profile />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		expect(screen.getByRole("tab", { name: "Public Stats" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("formats profile volume per cable", () => {
		expect(formatProfileVolume(1500, "kg")).toBe("1.5K kg per cable");
		expect(formatProfileVolume(null, "kg")).toBe("0 kg per cable");
	});

	it("shows only the session-derived per-cable volume, never the device total", () => {
		mockData.enabled = true;
		renderWithProviders(<Profile />);
		expect(screen.getAllByText("1.5K kg per cable").length).toBeGreaterThan(0);
		expect(screen.queryByText(/99\.0K/)).not.toBeInTheDocument();
		mockData.enabled = false;
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

	it("associates the display name label with its input", async () => {
		const user = userEvent.setup();
		renderWithProviders(<Profile />);
		await user.click(screen.getByRole("tab", { name: "Settings" }));
		expect(screen.getByLabelText("Display Name")).toHaveAttribute(
			"id",
			"profile-display-name",
		);
	});
});
