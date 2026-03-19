import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { SubscriptionGate } from "../SubscriptionGate";

// --- Auth mock (required by useSubscription -> useAuth) ---
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

// --- useSubscription mock ---
const mockUseSubscription = vi.hoisted(() => {
	const fn = vi.fn();
	return { useSubscription: fn };
});
vi.mock("@/hooks/useSubscription", () => mockUseSubscription);

// --- UpgradePrompt mock (avoid pulling in pricing module) ---
vi.mock("@/app/components/UpgradePrompt", () => ({
	UpgradePrompt: ({
		requiredTier,
		currentTier,
		featureName,
	}: {
		requiredTier: string;
		currentTier: string;
		featureName?: string;
	}) => (
		<div data-testid="upgrade-prompt">
			<span data-testid="required-tier">{requiredTier}</span>
			<span data-testid="current-tier">{currentTier}</span>
			{featureName && (
				<span data-testid="feature-name">{featureName}</span>
			)}
		</div>
	),
}));

function setupSubscription(overrides: {
	tier?: string;
	isLoading?: boolean;
}) {
	mockUseSubscription.useSubscription.mockReturnValue({
		tier: overrides.tier ?? "FREE",
		rawTier: overrides.tier ?? "FREE",
		status: overrides.tier === "FREE" ? "none" : "active",
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		isLoading: overrides.isLoading ?? false,
		isPremium: (overrides.tier ?? "FREE") !== "FREE",
		isFlame:
			overrides.tier === "FLAME" || overrides.tier === "INFERNO",
		isInferno: overrides.tier === "INFERNO",
	});
}

describe("SubscriptionGate", () => {
	// ---------------------------------------------------------------
	// Smoke
	// ---------------------------------------------------------------
	it("renders without crashing", () => {
		setupSubscription({ tier: "FREE" });
		renderWithProviders(
			<SubscriptionGate requiredTier="EMBER">
				<p>Protected content</p>
			</SubscriptionGate>,
		);
		// Should show upgrade prompt for FREE users gated at EMBER
		expect(screen.getByTestId("upgrade-prompt")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Loading state
	// ---------------------------------------------------------------
	it("renders loading skeleton while subscription is loading", () => {
		setupSubscription({ isLoading: true });
		const { container } = renderWithProviders(
			<SubscriptionGate requiredTier="EMBER">
				<p>Protected</p>
			</SubscriptionGate>,
		);
		// Skeleton renders as a div with rounded-lg and bg-[#1a1a1a] classes
		const skeleton = container.querySelector(".rounded-lg.bg-\\[\\#1a1a1a\\]");
		expect(skeleton).toBeInTheDocument();
		expect(screen.queryByText("Protected")).not.toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Access granted: exact tier match
	// ---------------------------------------------------------------
	it("renders children when user tier matches required tier", () => {
		setupSubscription({ tier: "EMBER" });
		renderWithProviders(
			<SubscriptionGate requiredTier="EMBER">
				<p>Ember content</p>
			</SubscriptionGate>,
		);
		expect(screen.getByText("Ember content")).toBeInTheDocument();
		expect(screen.queryByTestId("upgrade-prompt")).not.toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Access granted: higher tier than required
	// ---------------------------------------------------------------
	it("renders children when user tier exceeds required tier", () => {
		setupSubscription({ tier: "INFERNO" });
		renderWithProviders(
			<SubscriptionGate requiredTier="FLAME">
				<p>Flame content</p>
			</SubscriptionGate>,
		);
		expect(screen.getByText("Flame content")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Access denied: lower tier
	// ---------------------------------------------------------------
	it("shows UpgradePrompt when user tier is below required tier", () => {
		setupSubscription({ tier: "EMBER" });
		renderWithProviders(
			<SubscriptionGate requiredTier="INFERNO" featureName="Session Replay">
				<p>Inferno content</p>
			</SubscriptionGate>,
		);
		expect(screen.queryByText("Inferno content")).not.toBeInTheDocument();
		expect(screen.getByTestId("upgrade-prompt")).toBeInTheDocument();
		expect(screen.getByTestId("required-tier")).toHaveTextContent("INFERNO");
		expect(screen.getByTestId("current-tier")).toHaveTextContent("EMBER");
		expect(screen.getByTestId("feature-name")).toHaveTextContent(
			"Session Replay",
		);
	});

	// ---------------------------------------------------------------
	// Access denied: FREE user, INFERNO required
	// ---------------------------------------------------------------
	it("blocks FREE users from INFERNO-gated content", () => {
		setupSubscription({ tier: "FREE" });
		renderWithProviders(
			<SubscriptionGate requiredTier="INFERNO">
				<p>Premium stuff</p>
			</SubscriptionGate>,
		);
		expect(screen.queryByText("Premium stuff")).not.toBeInTheDocument();
		expect(screen.getByTestId("upgrade-prompt")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Custom fallback
	// ---------------------------------------------------------------
	it("renders custom fallback instead of UpgradePrompt when provided", () => {
		setupSubscription({ tier: "FREE" });
		renderWithProviders(
			<SubscriptionGate
				requiredTier="FLAME"
				fallback={<div data-testid="custom-fallback">Need Flame</div>}
			>
				<p>Flame content</p>
			</SubscriptionGate>,
		);
		expect(screen.queryByText("Flame content")).not.toBeInTheDocument();
		expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
		expect(screen.queryByTestId("upgrade-prompt")).not.toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Tier hierarchy: FLAME user accessing EMBER gate
	// ---------------------------------------------------------------
	it("grants FLAME user access to EMBER-gated content", () => {
		setupSubscription({ tier: "FLAME" });
		renderWithProviders(
			<SubscriptionGate requiredTier="EMBER">
				<p>Lower tier content</p>
			</SubscriptionGate>,
		);
		expect(screen.getByText("Lower tier content")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// featureName is optional
	// ---------------------------------------------------------------
	it("shows UpgradePrompt without featureName when not provided", () => {
		setupSubscription({ tier: "FREE" });
		renderWithProviders(
			<SubscriptionGate requiredTier="EMBER">
				<p>Content</p>
			</SubscriptionGate>,
		);
		expect(screen.getByTestId("upgrade-prompt")).toBeInTheDocument();
		expect(screen.queryByTestId("feature-name")).not.toBeInTheDocument();
	});
});
