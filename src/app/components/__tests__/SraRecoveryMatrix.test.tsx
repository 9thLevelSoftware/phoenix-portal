import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import type { Recommendation } from "@/lib/recommendations";
import type { MuscleRecovery } from "@/lib/sra-recovery";
import { SraRecoveryMatrix } from "../analytics/SraRecoveryMatrix";

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

const RECOVERIES: MuscleRecovery[] = [
	{
		muscleGroup: "Chest",
		status: "FATIGUED",
		hoursSinceLastTrained: 10,
		estimatedRecoveryHours: 60,
		hoursRemaining: 10,
		lastSessionVolume: null,
		lastSessionIntensity: null,
	},
	{
		muscleGroup: "Back",
		status: "RECOVERING",
		hoursSinceLastTrained: 30,
		estimatedRecoveryHours: 60,
		hoursRemaining: 18,
		lastSessionVolume: null,
		lastSessionIntensity: null,
	},
	{
		muscleGroup: "Legs",
		status: "RECOVERED",
		hoursSinceLastTrained: 80,
		estimatedRecoveryHours: 84,
		hoursRemaining: null,
		lastSessionVolume: null,
		lastSessionIntensity: null,
	},
	{
		muscleGroup: "Shoulders",
		status: "SUPERCOMPENSATED",
		hoursSinceLastTrained: 55,
		estimatedRecoveryHours: 42,
		hoursRemaining: null,
		lastSessionVolume: null,
		lastSessionIntensity: null,
	},
];

const ZERO_HOURS_RECOVERY: MuscleRecovery = {
	muscleGroup: "Arms",
	status: "RECOVERED",
	hoursSinceLastTrained: 0,
	estimatedRecoveryHours: 36,
	hoursRemaining: null,
	lastSessionVolume: null,
	lastSessionIntensity: null,
};

const SRA_RECOS: Recommendation[] = [
	{
		id: "sra_supercompensated_Shoulders",
		priority: "positive",
		signal: "sra_supercompensated",
		muscleGroup: "Shoulders",
		title: "Shoulders is in the optimal training window",
		action: "Prioritize this muscle group in today's session",
	},
	{
		id: "sra_fatigued_Chest",
		priority: "info",
		signal: "sra_fatigued",
		muscleGroup: "Chest",
		title: "Chest is still fatigued",
		action: "Allow ~10h more recovery before the next session",
	},
];

const VOLUME_RECO: Recommendation = {
	id: "volume_above_mrv_Back",
	priority: "critical",
	signal: "volume_above_mrv",
	muscleGroup: "Back",
	title: "Back volume exceeds MRV",
	action: "Reduce by 2 sets next week",
};

// ---------------------------------------------------------------

describe("SraRecoveryMatrix", () => {
	// --- Smoke ---

	it("renders without crashing", () => {
		setupSubscription(true);
		const { container } = renderWithProviders(
			<SraRecoveryMatrix recoveries={RECOVERIES} />,
		);
		expect(container.firstChild).toBeTruthy();
	});

	// --- Status labels for each muscle group ---

	it("renders all muscle group cards with correct status labels", () => {
		setupSubscription(true);
		renderWithProviders(<SraRecoveryMatrix recoveries={RECOVERIES} />);

		expect(screen.getByTestId("sra-card-chest")).toBeInTheDocument();
		expect(screen.getByTestId("sra-card-back")).toBeInTheDocument();
		expect(screen.getByTestId("sra-card-legs")).toBeInTheDocument();
		expect(screen.getByTestId("sra-card-shoulders")).toBeInTheDocument();

		expect(screen.getByText("Fatigued")).toBeInTheDocument();
		expect(screen.getByText("Recovering")).toBeInTheDocument();
		expect(screen.getByText("Recovered")).toBeInTheDocument();
		expect(screen.getByText("Supercompensated")).toBeInTheDocument();
	});

	// --- Blurred overlay for non-INFERNO users ---

	it("shows blurred overlay when user is not INFERNO", () => {
		setupSubscription(false);
		renderWithProviders(<SraRecoveryMatrix recoveries={RECOVERIES} />);

		const overlay = screen.getByRole("region", { name: "Premium feature preview" });
		expect(overlay).toBeInTheDocument();
		expect(screen.getByText("Unlock Training Intelligence")).toBeInTheDocument();
		expect(screen.getByText("Upgrade to Inferno")).toBeInTheDocument();
	});

	// --- No overlay for INFERNO users ---

	it("does NOT show overlay when user is INFERNO", () => {
		setupSubscription(true);
		renderWithProviders(<SraRecoveryMatrix recoveries={RECOVERIES} />);

		expect(
			screen.queryByRole("region", { name: "Premium feature preview" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText("Unlock Training Intelligence"),
		).not.toBeInTheDocument();
	});

	// --- Content still rendered beneath overlay ---

	it("still renders muscle group data beneath the overlay for non-INFERNO users", () => {
		setupSubscription(false);
		renderWithProviders(<SraRecoveryMatrix recoveries={RECOVERIES} />);

		// Cards are still in the DOM (blurred, but present for preview)
		expect(screen.getByTestId("sra-card-chest")).toBeInTheDocument();
	});

	// --- "No data" for zero-hours muscle groups ---

	it('shows "No data" for muscle groups with zero hoursSinceLastTrained', () => {
		setupSubscription(true);
		renderWithProviders(
			<SraRecoveryMatrix recoveries={[ZERO_HOURS_RECOVERY]} />,
		);

		expect(screen.getByTestId("sra-card-arms")).toBeInTheDocument();
		expect(screen.getByText("No data")).toBeInTheDocument();
	});

	// --- hoursRemaining shown for FATIGUED/RECOVERING ---

	it("shows hours remaining for FATIGUED status", () => {
		setupSubscription(true);
		renderWithProviders(
			<SraRecoveryMatrix recoveries={[RECOVERIES[0]]} />, // Chest: FATIGUED, 10h remaining
		);
		expect(screen.getByText(/~10h remaining/i)).toBeInTheDocument();
	});

	it("shows hours remaining for RECOVERING status", () => {
		setupSubscription(true);
		renderWithProviders(
			<SraRecoveryMatrix recoveries={[RECOVERIES[1]]} />, // Back: RECOVERING, 18h remaining
		);
		expect(screen.getByText(/~18h remaining/i)).toBeInTheDocument();
	});

	it("does NOT show hours remaining for RECOVERED status", () => {
		setupSubscription(true);
		renderWithProviders(
			<SraRecoveryMatrix recoveries={[RECOVERIES[2]]} />, // Legs: RECOVERED
		);
		expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
	});

	// --- Inline recommendation callouts ---

	it("renders inline SRA recommendation callouts", () => {
		setupSubscription(true);
		renderWithProviders(
			<SraRecoveryMatrix
				recoveries={RECOVERIES}
				recommendations={SRA_RECOS}
			/>,
		);

		expect(screen.getByTestId("sra-recommendations")).toBeInTheDocument();
		expect(
			screen.getByText("Shoulders is in the optimal training window"),
		).toBeInTheDocument();
		expect(screen.getByText("Chest is still fatigued")).toBeInTheDocument();
	});

	it("does NOT render callouts for non-SRA signals", () => {
		setupSubscription(true);
		renderWithProviders(
			<SraRecoveryMatrix
				recoveries={RECOVERIES}
				recommendations={[VOLUME_RECO]}
			/>,
		);

		expect(
			screen.queryByTestId("sra-recommendations"),
		).not.toBeInTheDocument();
	});

	it("does not render recommendations section when no SRA recommendations provided", () => {
		setupSubscription(true);
		renderWithProviders(<SraRecoveryMatrix recoveries={RECOVERIES} />);

		expect(
			screen.queryByTestId("sra-recommendations"),
		).not.toBeInTheDocument();
	});

	// --- Empty state ---

	it("shows empty state when no recoveries provided", () => {
		setupSubscription(true);
		renderWithProviders(<SraRecoveryMatrix recoveries={[]} />);

		expect(
			screen.getByText(/no recovery data/i),
		).toBeInTheDocument();
	});
});
