import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommunityPercentileAtlas } from "@/app/components/analytics/CommunityPercentileAtlas";
import { DataFreshnessStrip } from "@/app/components/analytics/DataFreshnessStrip";
import { ProgressionWorkbench } from "@/app/components/analytics/ProgressionWorkbench";
import type { RankingItem } from "@/app/components/CommunityRankings";
import { ReplayAnnotationOverlay } from "@/app/components/session-replay/ReplayAnnotationOverlay";
import { ReplayIntelligencePanel } from "@/app/components/session-replay/ReplayIntelligencePanel";
import type { FreshnessState } from "@/lib/freshness";
import type { ProgressionWorkbenchModel } from "@/lib/progression-workbench";
import type { ReplayIntelligence } from "@/lib/replay-intelligence";
import { renderWithProviders } from "@/test/test-utils";

vi.mock("@/app/components/charts/CommunityDistribution", () => ({
	CommunityDistribution: () => <div data-testid="distribution-chart" />,
}));

const freshState: FreshnessState = {
	status: "live",
	label: "Up to date",
	description: "Last updated 12:00 PM.",
	flags: [],
	lastUpdatedLabel: "12:00 PM",
};

const partialFreshState: FreshnessState = {
	status: "partial",
	label: "Partial data",
	description: "Some telemetry is missing.",
	flags: ["Partial telemetry", "Processing unavailable"],
	lastUpdatedLabel: null,
};

const replayIntelligence: ReplayIntelligence = {
	status: "ready",
	partialReason: null,
	repCount: 3,
	repInsights: [
		{
			repNumber: 1,
			startMs: 0,
			endMs: 1200,
			meanVelocityMps: 0.6,
			peakVelocityMps: 0.8,
			peakForceN: 900,
			velocityLossPct: 0,
			consistencyPct: 88,
			stickingPoint: null,
		},
		{
			repNumber: 2,
			startMs: 1500,
			endMs: 2700,
			meanVelocityMps: 0.48,
			peakVelocityMps: 0.65,
			peakForceN: 990,
			velocityLossPct: 20,
			consistencyPct: 88,
			stickingPoint: {
				repNumber: 2,
				timestampMs: 2100,
				positionMm: 175,
				velocityMps: 0.18,
				forceN: 990,
			},
		},
		{
			repNumber: 3,
			startMs: 3000,
			endMs: 4300,
			meanVelocityMps: 0.39,
			peakVelocityMps: 0.55,
			peakForceN: 980,
			velocityLossPct: 35,
			consistencyPct: 88,
			stickingPoint: null,
		},
	],
	stickingPoints: [
		{
			repNumber: 2,
			timestampMs: 2100,
			positionMm: 175,
			velocityMps: 0.18,
			forceN: 990,
		},
	],
	velocityLossPct: 35,
	fatigueSlopePctPerRep: -11.7,
	repConsistencyPct: 88,
	forcePeakN: 990,
	durationMs: 4300,
};

const percentileRankings: RankingItem[] = [
	{
		label: "Total Volume",
		percentile: 8,
		value: 18_500,
		unit: "kg",
		rank: 4,
		totalUsers: 50,
		color: "#FF6B35",
		percentiles: { p10: 1000, p50: 8000, p90: 20000 },
	},
];

const progressionModel: ProgressionWorkbenchModel = {
	emptyReason: null,
	exercises: [
		{
			exerciseName: "Squat",
			currentOneRm: 162,
			currentOneRmKg: 162,
			gainRatePctPer30Days: 21.8,
			plateauRisk: "low",
			phasePrCount: 1,
			lastProgressAt: new Date("2026-06-05T00:00:00Z"),
			lastPrAt: new Date("2026-06-05T00:00:00Z"),
			recommendation: {
				kind: "load",
				label: "Add 2.5 kg",
				description: "Recent trend supports testing about 130.5 kg next time.",
			},
			points: [
				{
					date: "May 25",
					oneRm: 150,
					oneRmKg: 150,
					volume: 3000,
					maxWeight: 120,
				},
				{
					date: "Jun 5",
					oneRm: 162,
					oneRmKg: 162,
					volume: 3400,
					maxWeight: 128,
				},
			],
		},
		{
			exerciseName: "Bench Press",
			currentOneRm: 100.5,
			currentOneRmKg: 100.5,
			gainRatePctPer30Days: 0.2,
			plateauRisk: "high",
			phasePrCount: 1,
			lastProgressAt: new Date("2026-05-20T00:00:00Z"),
			lastPrAt: new Date("2026-04-15T00:00:00Z"),
			recommendation: {
				kind: "variation",
				label: "Rotate stimulus",
				description: "Progress has flattened.",
			},
			points: [],
		},
	],
	selectedExercise: null,
};
progressionModel.selectedExercise = progressionModel.exercises[0];

describe("DataFreshnessStrip", () => {
	it("renders live and partial freshness states", () => {
		const { rerender } = renderWithProviders(
			<DataFreshnessStrip state={freshState} />,
		);

		expect(screen.getByText("Up to date")).toBeInTheDocument();
		expect(screen.getByText(/last updated 12:00 pm/i)).toBeInTheDocument();

		rerender(<DataFreshnessStrip state={partialFreshState} />);

		expect(screen.getByText("Partial data")).toBeInTheDocument();
		expect(screen.getByText("Processing unavailable")).toBeInTheDocument();
	});
});

describe("ReplayIntelligencePanel", () => {
	it("renders selected rep details and sticking-point context", () => {
		renderWithProviders(
			<ReplayIntelligencePanel
				intelligence={replayIntelligence}
				currentRepIndex={1}
			/>,
		);

		expect(screen.getByText("Replay Intelligence")).toBeInTheDocument();
		expect(screen.getByText("35%")).toBeInTheDocument();
		expect(screen.getByText("Rep 2")).toBeInTheDocument();
		expect(screen.getByText(/sticking point/i)).toBeInTheDocument();
	});

	it("renders no-telemetry and partial states", () => {
		const { rerender } = renderWithProviders(
			<ReplayIntelligencePanel
				intelligence={{ ...replayIntelligence, status: "empty", repCount: 0 }}
				currentRepIndex={0}
			/>,
		);

		expect(screen.getByText(/no telemetry intelligence/i)).toBeInTheDocument();

		rerender(
			<ReplayIntelligencePanel
				intelligence={{
					...replayIntelligence,
					status: "partial",
					partialReason: "Using rep summaries.",
				}}
				currentRepIndex={0}
			/>,
		);

		expect(screen.getByText(/using rep summaries/i)).toBeInTheDocument();
	});
});

describe("ReplayAnnotationOverlay", () => {
	it("clamps rep and sticking-point annotations to the plot width", () => {
		const { container } = renderWithProviders(
			<ReplayAnnotationOverlay
				intelligence={{
					...replayIntelligence,
					durationMs: 1000,
					repInsights: [
						{
							...replayIntelligence.repInsights[0],
							startMs: 0,
							endMs: 2000,
						},
					],
					stickingPoints: [
						{
							...replayIntelligence.stickingPoints[0],
							timestampMs: 2000,
						},
					],
				}}
				currentRepIndex={0}
				width={200}
				height={120}
			/>,
		);

		expect(container.querySelector("rect")?.getAttribute("width")).toBe("130");
		expect(container.querySelector("line")?.getAttribute("x1")).toBe("180");
		expect(container.querySelector("circle")?.getAttribute("cx")).toBe("180");
	});
});

describe("CommunityPercentileAtlas", () => {
	it("renders populated, loading, and empty states", () => {
		const { rerender } = renderWithProviders(
			<CommunityPercentileAtlas
				rankings={percentileRankings}
				loading={false}
				error={false}
			/>,
		);

		expect(screen.getByText("Community Percentile Atlas")).toBeInTheDocument();
		expect(screen.getByText("Top 8%")).toBeInTheDocument();
		expect(screen.getByTestId("distribution-chart")).toBeInTheDocument();

		rerender(
			<CommunityPercentileAtlas rankings={[]} loading={true} error={false} />,
		);
		expect(screen.getByText(/loading percentile atlas/i)).toBeInTheDocument();

		rerender(
			<CommunityPercentileAtlas rankings={[]} loading={false} error={false} />,
		);
		expect(screen.getByText(/no percentile data/i)).toBeInTheDocument();
	});
});

describe("ProgressionWorkbench", () => {
	it("renders the selected exercise and lets users switch exercises", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();

		renderWithProviders(
			<ProgressionWorkbench
				model={progressionModel}
				unit="kg"
				onSelectExercise={onSelect}
			/>,
		);

		expect(screen.getByText("Progression Workbench")).toBeInTheDocument();
		expect(screen.getAllByText("Squat").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText("Add 2.5 kg")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /bench press/i }));
		expect(onSelect).toHaveBeenCalledWith("Bench Press");
	});

	it("renders no-history state", () => {
		renderWithProviders(
			<ProgressionWorkbench
				model={{
					exercises: [],
					selectedExercise: null,
					emptyReason: "No exercise progress history is available yet.",
				}}
				unit="kg"
				onSelectExercise={vi.fn()}
			/>,
		);

		expect(
			screen.getByText(/no exercise progress history/i),
		).toBeInTheDocument();
	});
});
