import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProgressionWorkbenchModel } from "@/lib/progression-workbench";
import { renderWithProviders } from "@/test/test-utils";
import MobileProgressTab from "./MobileProgressTab";
import ProgressTab from "./ProgressTab";
import { buildPhaseMetricSummary } from "./phaseStatisticsTransforms";

/**
 * PR 38 acceptance: `session_phase_statistics` is INFERNO-gated in RLS
 * (20260920003800_inferno_read_policies.sql), so a FLAME user's
 * `phaseStatisticsTrendOptions` query succeeds and returns **zero rows** —
 * there is no error to render. The phase panels must show their empty state
 * for that, not a failure and not a zeroed-out grid of fake metrics.
 */

const emptySummary = buildPhaseMetricSummary([]);

const emptyProgressionModel: ProgressionWorkbenchModel = {
	exercises: [],
	selectedExercise: null,
	emptyReason: "No progression data yet",
};

describe("phase panels with zero phase-statistics rows (FLAME, INFERNO-gated)", () => {
	it("buildPhaseMetricSummary reports no rows rather than throwing", () => {
		expect(emptySummary.rowCount).toBe(0);
	});

	it("ProgressTab renders the empty phase state, not an error", () => {
		renderWithProviders(
			<ProgressTab
				unit="kg"
				strengthEChartsOption={null}
				volumeAreaOption={null}
				prCount={0}
				daysSinceLastPR={null}
				strengthExercises={[]}
				insights={[]}
				phaseFilter="all"
				onPhaseFilterChange={() => {}}
				phaseMetricSummary={emptySummary}
				progressionModel={emptyProgressionModel}
				onSelectProgressionExercise={() => {}}
			/>,
		);

		expect(
			screen.getByText(/no phase statistics for this period/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/0 sessions with phase samples/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
		// The metric panels must not render zeroed placeholders as if they
		// were real readings.
		expect(screen.queryByText("Velocity")).not.toBeInTheDocument();
		expect(screen.queryByText("Power")).not.toBeInTheDocument();
	});

	it("MobileProgressTab renders the empty phase state, not an error", () => {
		renderWithProviders(
			<MobileProgressTab
				unit="kg"
				mobileStrengthData={[]}
				mobileVolumeData={[]}
				prCount={0}
				daysSinceLastPR={null}
				phaseFilter="all"
				onPhaseFilterChange={() => {}}
				phaseMetricSummary={emptySummary}
				progressionModel={emptyProgressionModel}
				onSelectProgressionExercise={() => {}}
			/>,
		);

		expect(
			screen.getByText(/no phase statistics for this period/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
	});
});
