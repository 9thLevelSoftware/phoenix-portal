import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FatigueAnalysis } from "@/lib/fatigue-detection";
import type { RepQualityResult } from "@/lib/rep-quality";
import { renderWithProviders } from "@/test/test-utils";
import { FatigueSummary } from "../session-replay/FatigueSummary";
import { PlaybackControls } from "../session-replay/PlaybackControls";
import { QualityBadge } from "../session-replay/QualityBadge";
import { SessionReplay } from "../session-replay/SessionReplay";
import { SetNavigation } from "../session-replay/SetNavigation";

// --- Auth mock ---
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

// --- Router mocks ---
const mockNavigate = vi.fn();
const mockParams = vi.hoisted(() => ({
	current: {} as Record<string, string | undefined>,
}));
vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return {
		...actual,
		useNavigate: () => mockNavigate,
		useParams: () => mockParams.current,
	};
});

// --- Supabase mock ---
vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: () => Promise.resolve({ data: null, error: null }),
					order: () => Promise.resolve({ data: [], error: null }),
					single: () =>
						Promise.resolve({ data: null, error: { message: "not found" } }),
				}),
			}),
		}),
		channel: () => ({
			on: () => ({ subscribe: () => ({}) }),
		}),
		removeChannel: vi.fn(),
	},
}));

// --- useSubscription mock ---
const mockUseSubscription = vi.hoisted(() => {
	const fn = vi.fn();
	return { useSubscription: fn, type: { SubscriptionTier: {} } };
});
vi.mock("@/hooks/useSubscription", () => mockUseSubscription);

// --- UpgradePrompt mock ---
vi.mock("@/app/components/UpgradePrompt", () => ({
	UpgradePrompt: ({
		requiredTier,
	}: {
		requiredTier: string;
		currentTier: string;
		featureName?: string;
	}) => <div data-testid="upgrade-prompt">{requiredTier}</div>,
}));

// --- usePlayback mock (avoid animation frame issues) ---
vi.mock("@/hooks/usePlayback", () => ({
	usePlayback: vi.fn(),
}));

// --- useIsMobile mock ---
vi.mock("@/app/hooks/useIsMobile", () => ({
	useIsMobile: () => false,
}));

// --- ReplayCanvas mock (avoid canvas rendering in jsdom) ---
vi.mock("@/app/components/session-replay/ReplayCanvas", () => ({
	ReplayCanvas: () => <div data-testid="replay-canvas">Canvas</div>,
}));

// --- Replay store mock ---
const mockReplayStore = vi.hoisted(() => {
	const store = {
		currentSetIndex: 0,
		activeChart: "force" as const,
		setActiveChart: vi.fn(),
		isPlaying: false,
		currentTimeMs: 0,
		reset: vi.fn(),
		speed: 1,
		togglePlayPause: vi.fn(),
		setSpeed: vi.fn(),
		viewMode: "set" as const,
		setViewMode: vi.fn(),
		nextSet: vi.fn(),
		prevSet: vi.fn(),
		seek: vi.fn(),
		pause: vi.fn(),
		play: vi.fn(),
	};
	return store;
});

vi.mock("@/stores/useReplayStore", () => ({
	useReplayStore: (selector?: (state: typeof mockReplayStore) => unknown) =>
		selector ? selector(mockReplayStore) : mockReplayStore,
}));

function setupSubscription(tier: string) {
	mockUseSubscription.useSubscription.mockReturnValue({
		tier,
		rawTier: tier,
		status: tier === "FREE" ? "none" : "active",
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		isLoading: false,
		isPremium: tier !== "FREE",
		isFlame: tier === "FLAME" || tier === "INFERNO",
		isInferno: tier === "INFERNO",
	});
}

// ===================================================================
// SessionReplay (parent component)
// ===================================================================
describe("SessionReplay", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParams.current = { sessionId: "test-session-123" };
		mockReplayStore.currentSetIndex = 0;
		mockReplayStore.isPlaying = false;
		mockReplayStore.currentTimeMs = 0;
	});

	// ---------------------------------------------------------------
	// Smoke - FLAME+ users
	// ---------------------------------------------------------------
	it("renders without crashing for FLAME users", () => {
		setupSubscription("FLAME");
		renderWithProviders(<SessionReplay />);
		expect(screen.getByText("Session Replay")).toBeInTheDocument();
	});

	it("renders without crashing for INFERNO users", () => {
		setupSubscription("INFERNO");
		renderWithProviders(<SessionReplay />);
		expect(screen.getByText("Session Replay")).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Subscription gate blocks below FLAME
	// ---------------------------------------------------------------
	it("shows upgrade prompt for FREE users", () => {
		setupSubscription("FREE");
		renderWithProviders(<SessionReplay />);
		expect(screen.getByTestId("upgrade-prompt")).toBeInTheDocument();
	});

	it("shows upgrade prompt for EMBER users", () => {
		setupSubscription("EMBER");
		renderWithProviders(<SessionReplay />);
		expect(screen.getByTestId("upgrade-prompt")).toBeInTheDocument();
	});

	it("does not show upgrade prompt for FLAME users", () => {
		setupSubscription("FLAME");
		renderWithProviders(<SessionReplay />);
		expect(screen.queryByTestId("upgrade-prompt")).not.toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// No session ID
	// ---------------------------------------------------------------
	it("shows error message when no session ID is provided", () => {
		setupSubscription("FLAME");
		mockParams.current = {};
		renderWithProviders(<SessionReplay />);
		expect(screen.getByText(/no session id provided/i)).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Loading state
	// ---------------------------------------------------------------
	it("shows loading skeletons while data loads", () => {
		setupSubscription("FLAME");
		const { container } = renderWithProviders(<SessionReplay />);
		// Skeleton uses bg-[#1a1a1a] class from custom Skeleton component
		const skeletons = container.querySelectorAll(
			".rounded-lg.bg-\\[\\#1a1a1a\\]",
		);
		expect(skeletons.length).toBeGreaterThan(0);
	});

	// ---------------------------------------------------------------
	// Go back button
	// ---------------------------------------------------------------
	it("renders go back button", () => {
		setupSubscription("FLAME");
		renderWithProviders(<SessionReplay />);
		expect(
			screen.getByRole("button", { name: /go back/i }),
		).toBeInTheDocument();
	});

	// ---------------------------------------------------------------
	// Reset on mount
	// ---------------------------------------------------------------
	it("resets playback state on mount", () => {
		setupSubscription("FLAME");
		renderWithProviders(<SessionReplay />);
		expect(mockReplayStore.reset).toHaveBeenCalled();
	});
});

// ===================================================================
// FatigueSummary
// ===================================================================
describe("FatigueSummary", () => {
	const noFatigue: FatigueAnalysis = {
		isFatigued: false,
		fatigueStartRepIndex: null,
		velocityDropPercent: 5,
		insight: null,
		perRepDrops: [0, 3, 5],
		severity: "none",
	};

	const moderateFatigue: FatigueAnalysis = {
		isFatigued: true,
		fatigueStartRepIndex: 3,
		velocityDropPercent: 22,
		insight: "Velocity dropped 22% on rep 5 -- consider stopping earlier",
		perRepDrops: [0, 5, 12, 20, 22],
		severity: "moderate",
	};

	const highFatigue: FatigueAnalysis = {
		isFatigued: true,
		fatigueStartRepIndex: 2,
		velocityDropPercent: 35,
		insight:
			"Velocity dropped 35% on rep 4 -- consider stopping at rep 2 next time",
		perRepDrops: [0, 10, 25, 35],
		severity: "high",
	};

	it("renders nothing when no fatigue detected", () => {
		const { container } = renderWithProviders(
			<FatigueSummary fatigue={noFatigue} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("renders moderate fatigue warning with correct data", () => {
		renderWithProviders(<FatigueSummary fatigue={moderateFatigue} />);
		expect(screen.getByText("Fatigue Detected")).toBeInTheDocument();
		// "22%" appears in both the insight and the Max drop span - use getAllByText
		expect(screen.getAllByText(/22%/).length).toBeGreaterThanOrEqual(1);
		expect(screen.getByRole("alert")).toBeInTheDocument();
	});

	it("renders high fatigue warning with actionable insight", () => {
		renderWithProviders(<FatigueSummary fatigue={highFatigue} />);
		expect(screen.getByText("Fatigue Detected")).toBeInTheDocument();
		// "35%" appears in both the insight and the Max drop span
		expect(screen.getAllByText(/35%/).length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText(/consider stopping at rep 2/i)).toBeInTheDocument();
	});

	it("shows fatigue start rep index", () => {
		renderWithProviders(<FatigueSummary fatigue={moderateFatigue} />);
		// fatigueStartRepIndex = 3, display as "Rep 4" (1-indexed)
		// Appears in the "Started: Rep 4" section
		expect(screen.getAllByText(/Rep 4/).length).toBeGreaterThanOrEqual(1);
	});
});

// ===================================================================
// PlaybackControls
// ===================================================================
describe("PlaybackControls", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReplayStore.isPlaying = false;
	});

	it("renders play button when not playing", () => {
		renderWithProviders(<PlaybackControls />);
		expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
	});

	it("renders pause button when playing", () => {
		mockReplayStore.isPlaying = true;
		renderWithProviders(<PlaybackControls />);
		expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
	});

	it("calls togglePlayPause when button is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<PlaybackControls />);

		const playBtn = screen.getByRole("button", { name: /play/i });
		await user.click(playBtn);

		expect(mockReplayStore.togglePlayPause).toHaveBeenCalled();
	});

	it("renders speed control options", () => {
		renderWithProviders(<PlaybackControls />);
		for (const speed of ["0.25x", "0.5x", "1x", "2x", "4x"]) {
			expect(screen.getByText(speed)).toBeInTheDocument();
		}
	});

	it("disables controls when disabled prop is true", () => {
		renderWithProviders(<PlaybackControls disabled={true} />);
		const playBtn = screen.getByRole("button", { name: /play/i });
		expect(playBtn).toBeDisabled();
	});
});

// ===================================================================
// SetNavigation
// ===================================================================
describe("SetNavigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("displays current set position", () => {
		renderWithProviders(<SetNavigation currentSetIndex={2} totalSets={5} />);
		expect(screen.getByText("Set 3 of 5")).toBeInTheDocument();
	});

	it("disables Previous button on first set", () => {
		renderWithProviders(<SetNavigation currentSetIndex={0} totalSets={5} />);
		const prevBtn = screen.getByRole("button", { name: /previous set/i });
		expect(prevBtn).toBeDisabled();
	});

	it("disables Next button on last set", () => {
		renderWithProviders(<SetNavigation currentSetIndex={4} totalSets={5} />);
		const nextBtn = screen.getByRole("button", { name: /next set/i });
		expect(nextBtn).toBeDisabled();
	});

	it("enables both buttons for middle sets", () => {
		renderWithProviders(<SetNavigation currentSetIndex={2} totalSets={5} />);
		expect(
			screen.getByRole("button", { name: /previous set/i }),
		).not.toBeDisabled();
		expect(
			screen.getByRole("button", { name: /next set/i }),
		).not.toBeDisabled();
	});

	it("calls nextSet when Next button is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<SetNavigation currentSetIndex={1} totalSets={5} />);

		const nextBtn = screen.getByRole("button", { name: /next set/i });
		await user.click(nextBtn);
		expect(mockReplayStore.nextSet).toHaveBeenCalled();
	});

	it("calls prevSet when Previous button is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<SetNavigation currentSetIndex={2} totalSets={5} />);

		const prevBtn = screen.getByRole("button", { name: /previous set/i });
		await user.click(prevBtn);
		expect(mockReplayStore.prevSet).toHaveBeenCalled();
	});

	it("renders Set and Session view mode toggle", () => {
		renderWithProviders(<SetNavigation currentSetIndex={0} totalSets={3} />);
		expect(screen.getByText("Set")).toBeInTheDocument();
		expect(screen.getByText("Session")).toBeInTheDocument();
	});
});

// ===================================================================
// QualityBadge
// ===================================================================
describe("QualityBadge", () => {
	const goodQuality: RepQualityResult = {
		score: 85,
		factors: {
			velocityConsistency: 90,
			romScore: 80,
			asymmetryPenalty: 85,
			tutScore: 82,
		},
		isLowQuality: false,
	};

	const lowQuality: RepQualityResult = {
		score: 45,
		factors: {
			velocityConsistency: 40,
			romScore: 50,
			asymmetryPenalty: 45,
			tutScore: 48,
		},
		isLowQuality: true,
	};

	it("displays quality score", () => {
		renderWithProviders(
			<QualityBadge qualityResult={goodQuality} repNumber={1} />,
		);
		expect(screen.getByText("85")).toBeInTheDocument();
		expect(screen.getByText("Rep 1")).toBeInTheDocument();
	});

	it("has correct aria label", () => {
		renderWithProviders(
			<QualityBadge qualityResult={goodQuality} repNumber={3} />,
		);
		expect(screen.getByLabelText("Rep 3 quality: 85")).toBeInTheDocument();
	});

	it("displays low quality score", () => {
		renderWithProviders(
			<QualityBadge qualityResult={lowQuality} repNumber={5} />,
		);
		expect(screen.getByText("45")).toBeInTheDocument();
		expect(screen.getByText("Rep 5")).toBeInTheDocument();
	});

	it("shows quality factor details when clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<QualityBadge qualityResult={goodQuality} repNumber={1} />,
		);

		const badge = screen.getByLabelText("Rep 1 quality: 85");
		await user.click(badge);

		await waitFor(() => {
			expect(screen.getByText("Rep 1 Quality")).toBeInTheDocument();
			expect(screen.getByText("Velocity Consistency")).toBeInTheDocument();
			expect(screen.getByText("ROM Score")).toBeInTheDocument();
			expect(screen.getByText("Balance")).toBeInTheDocument();
			expect(screen.getByText("Time Under Tension")).toBeInTheDocument();
		});
	});

	it("shows factor values as percentages in popover", async () => {
		const user = userEvent.setup();
		renderWithProviders(
			<QualityBadge qualityResult={goodQuality} repNumber={1} />,
		);

		const badge = screen.getByLabelText("Rep 1 quality: 85");
		await user.click(badge);

		await waitFor(() => {
			expect(screen.getByText("90%")).toBeInTheDocument();
			expect(screen.getByText("80%")).toBeInTheDocument();
		});
	});
});
