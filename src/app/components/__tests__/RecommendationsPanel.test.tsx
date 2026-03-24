import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Recommendation } from "@/lib/recommendations";
import { renderWithProviders } from "@/test/test-utils";
import { RecommendationsPanel } from "../analytics/RecommendationsPanel";

// --- useSubscription mock ---

const mockUseSubscription = vi.hoisted(() => {
	const fn = vi.fn();
	return { useSubscription: fn };
});
vi.mock("@/hooks/useSubscription", () => mockUseSubscription);

// --- Helpers ---

function setupSubscription(isInferno: boolean) {
	mockUseSubscription.useSubscription.mockReturnValue({
		tier: isInferno ? "INFERNO" : "FLAME",
		rawTier: isInferno ? "INFERNO" : "FLAME",
		status: "active",
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		isLoading: false,
		isPremium: true,
		isFlame: true,
		isInferno,
	});
}

// --- Fixtures ---

const RECOMMENDATIONS: Recommendation[] = [
	{
		id: "volume_above_mrv_Back",
		priority: "critical",
		signal: "volume_above_mrv",
		muscleGroup: "Back",
		title: "Back volume exceeds MRV",
		action: "Reduce by 2 sets next week",
		metric: { current: 22, threshold: 20, unit: "sets" },
	},
	{
		id: "volume_below_mev_Arms",
		priority: "actionable",
		signal: "volume_below_mev",
		muscleGroup: "Arms",
		title: "Arms below MEV",
		action: "Add 2 sets to maintain progress",
	},
	{
		id: "sra_fatigued_Chest",
		priority: "info",
		signal: "sra_fatigued",
		muscleGroup: "Chest",
		title: "Chest is still fatigued",
		action: "Allow ~10h more recovery before the next session",
	},
	{
		id: "sra_recovered_Legs",
		priority: "positive",
		signal: "sra_recovered",
		muscleGroup: "Legs",
		title: "Legs is recovered and ready to train",
		action: "Include this muscle group in your next session",
	},
];

// 9 recommendations to test "show all" threshold (> MAX_INITIAL=8)
const MANY_RECOMMENDATIONS: Recommendation[] = Array.from(
	{ length: 9 },
	(_, i) => ({
		id: `reco_${i}`,
		priority: "info" as const,
		signal: "sra_fatigued",
		muscleGroup: `Muscle${i}`,
		title: `Recommendation ${i}`,
		action: "Some action",
	}),
);

// ---------------------------------------------------------------

describe("RecommendationsPanel", () => {
	// --- Smoke ---

	it("renders without crashing with recommendations", () => {
		setupSubscription(true);
		const { container } = renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);
		expect(container.firstChild).toBeTruthy();
	});

	// --- Collapsed state shows header + badge ---

	it("shows recommendation count badge in collapsed header", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		// Default state is collapsed — badge should be visible
		const badge = screen.getByTestId("recommendation-count-badge");
		expect(badge).toBeInTheDocument();
		expect(badge).toHaveTextContent("4");
	});

	it("does not show badge when there are no recommendations", () => {
		setupSubscription(true);
		renderWithProviders(<RecommendationsPanel recommendations={[]} />);

		expect(
			screen.queryByTestId("recommendation-count-badge"),
		).not.toBeInTheDocument();
	});

	// --- Expand / collapse ---

	it("does not show recommendation list when collapsed (default)", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		expect(
			screen.queryByTestId("recommendations-list"),
		).not.toBeInTheDocument();
	});

	it("shows recommendation list when header button is clicked", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /training recommendations/i }));
		expect(screen.getByTestId("recommendations-list")).toBeInTheDocument();
	});

	// --- Sort by priority ---

	it("sorts displayed items by priority (critical first)", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		// Expand
		fireEvent.click(screen.getByRole("button", { name: /training recommendations/i }));

		const list = screen.getByTestId("recommendations-list");
		const titles = list.querySelectorAll("p.font-medium.text-white");
		const titleTexts = Array.from(titles).map((el) => el.textContent);

		// critical should appear before actionable, info, positive
		const criticalIdx = titleTexts.findIndex((t) =>
			t?.includes("Back volume exceeds MRV"),
		);
		const actionableIdx = titleTexts.findIndex((t) =>
			t?.includes("Arms below MEV"),
		);
		const infoIdx = titleTexts.findIndex((t) =>
			t?.includes("Chest is still fatigued"),
		);
		const positiveIdx = titleTexts.findIndex((t) =>
			t?.includes("Legs is recovered"),
		);

		expect(criticalIdx).toBeLessThan(actionableIdx);
		expect(actionableIdx).toBeLessThan(infoIdx);
		expect(infoIdx).toBeLessThan(positiveIdx);
	});

	// --- Max 8 + "Show all" ---

	it("shows max 8 items and displays Show all button when more exist", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={MANY_RECOMMENDATIONS} />,
		);

		// Expand
		fireEvent.click(screen.getByRole("button", { name: /training recommendations/i }));

		const list = screen.getByTestId("recommendations-list");
		// Each card has a role="alert"
		const cards = list.querySelectorAll("[role='alert']");
		expect(cards).toHaveLength(8);

		const showAllBtn = screen.getByTestId("show-all-button");
		expect(showAllBtn).toBeInTheDocument();
		expect(showAllBtn).toHaveTextContent("Show all (9)");
	});

	it("shows all items after clicking Show all", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={MANY_RECOMMENDATIONS} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /training recommendations/i }));
		fireEvent.click(screen.getByTestId("show-all-button"));

		const list = screen.getByTestId("recommendations-list");
		const cards = list.querySelectorAll("[role='alert']");
		expect(cards).toHaveLength(9);
		expect(
			screen.queryByTestId("show-all-button"),
		).not.toBeInTheDocument();
	});

	it("does NOT show Show all button when 8 or fewer recommendations", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /training recommendations/i }));

		expect(
			screen.queryByTestId("show-all-button"),
		).not.toBeInTheDocument();
	});

	// --- Empty state ---

	it("shows empty state when no recommendations", () => {
		setupSubscription(true);
		renderWithProviders(<RecommendationsPanel recommendations={[]} />);

		fireEvent.click(screen.getByRole("button", { name: /training recommendations/i }));

		expect(
			screen.getByText(/all looking good/i),
		).toBeInTheDocument();
	});

	// --- Metric display ---

	it("shows metric data when present on a recommendation", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={[RECOMMENDATIONS[0]]} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /training recommendations/i }));

		// The metric row shows "Current: 22 sets / Threshold: 20 sets"
		expect(screen.getByText(/Current:/)).toBeInTheDocument();
		expect(screen.getByText(/Threshold:/)).toBeInTheDocument();
	});

	// --- INFERNO gating ---

	it("shows blurred overlay for non-INFERNO users", () => {
		setupSubscription(false);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		const overlay = screen.getByRole("region", {
			name: "Premium feature preview",
		});
		expect(overlay).toBeInTheDocument();
		expect(
			screen.getByText("Unlock Training Recommendations"),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Get prioritized, actionable training advice based on your data.",
			),
		).toBeInTheDocument();
		expect(screen.getByText("Upgrade to Inferno")).toBeInTheDocument();
	});

	it("does NOT show overlay for INFERNO users", () => {
		setupSubscription(true);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		expect(
			screen.queryByRole("region", { name: "Premium feature preview" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText("Unlock Training Recommendations"),
		).not.toBeInTheDocument();
	});

	it("still renders header beneath the overlay for non-INFERNO users", () => {
		setupSubscription(false);
		renderWithProviders(
			<RecommendationsPanel recommendations={RECOMMENDATIONS} />,
		);

		// Panel header text is in DOM (blurred but present)
		expect(screen.getByText("Training Recommendations")).toBeInTheDocument();
	});
});
