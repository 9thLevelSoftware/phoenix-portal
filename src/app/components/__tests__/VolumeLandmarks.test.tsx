import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Recommendation } from "@/lib/recommendations";
import { VOLUME_LANDMARKS } from "@/lib/volume-landmarks";
import { VolumeLandmarks } from "../analytics/VolumeLandmarks";

// VolumeLandmarks has no auth/query deps — plain render is sufficient.

const FULL_VOLUME: Record<string, number> = {
	Chest: 14,
	Back: 16,
	Shoulders: 12,
	Legs: 10,
	Arms: 8,
	Core: 6,
};

const ABOVE_MRV_RECO: Recommendation = {
	id: "volume_above_mrv_Chest",
	priority: "critical",
	signal: "volume_above_mrv",
	muscleGroup: "Chest",
	title: "Chest volume exceeds MRV",
	action: "Reduce by 2 sets next week",
};

const BELOW_MEV_RECO: Recommendation = {
	id: "volume_below_mev_Arms",
	priority: "actionable",
	signal: "volume_below_mev",
	muscleGroup: "Arms",
	title: "Arms below MEV",
	action: "Add 4 sets to maintain progress",
};

describe("VolumeLandmarks", () => {
	it("renders without crashing with valid props", () => {
		const { container } = render(
			<VolumeLandmarks weeklyVolume={FULL_VOLUME} selectedMuscleGroup={null} />,
		);
		expect(container.firstChild).toBeTruthy();
	});

	it('shows "No workouts this week" when weeklyVolume is empty', () => {
		render(<VolumeLandmarks weeklyVolume={{}} selectedMuscleGroup={null} />);
		expect(screen.getByText(/no workouts this week/i)).toBeInTheDocument();
	});

	it('shows "No workouts this week" when all volumes are 0', () => {
		const zeroVolume = Object.fromEntries(
			VOLUME_LANDMARKS.map((l) => [l.muscleGroup, 0]),
		);
		render(
			<VolumeLandmarks weeklyVolume={zeroVolume} selectedMuscleGroup={null} />,
		);
		expect(screen.getByText(/no workouts this week/i)).toBeInTheDocument();
	});

	it("renders all 6 muscle group bars when data is present", () => {
		render(
			<VolumeLandmarks weeklyVolume={FULL_VOLUME} selectedMuscleGroup={null} />,
		);
		for (const { muscleGroup } of VOLUME_LANDMARKS) {
			expect(
				screen.getByTestId(`muscle-row-${muscleGroup.toLowerCase()}`),
			).toBeInTheDocument();
		}
	});

	it("shows inline recommendation callouts when provided", () => {
		render(
			<VolumeLandmarks
				weeklyVolume={FULL_VOLUME}
				selectedMuscleGroup={null}
				recommendations={[ABOVE_MRV_RECO, BELOW_MEV_RECO]}
			/>,
		);
		expect(screen.getByTestId("volume-recommendations")).toBeInTheDocument();
		expect(screen.getByText("Chest volume exceeds MRV")).toBeInTheDocument();
		expect(screen.getByText("Arms below MEV")).toBeInTheDocument();
	});

	it("does not render recommendation callouts for non-volume signals", () => {
		const sraReco: Recommendation = {
			id: "sra_fatigued_Back",
			priority: "info",
			signal: "sra_fatigued",
			muscleGroup: "Back",
			title: "Back is still fatigued",
			action: "Allow 24h more recovery",
		};
		render(
			<VolumeLandmarks
				weeklyVolume={FULL_VOLUME}
				selectedMuscleGroup={null}
				recommendations={[sraReco]}
			/>,
		);
		expect(
			screen.queryByTestId("volume-recommendations"),
		).not.toBeInTheDocument();
	});

	it("shows disclaimer banner when totalSessions < 3", () => {
		render(
			<VolumeLandmarks
				weeklyVolume={FULL_VOLUME}
				selectedMuscleGroup={null}
				totalSessions={2}
			/>,
		);
		expect(
			screen.getByText(/accuracy improves with more training history/i),
		).toBeInTheDocument();
	});

	it("does not show disclaimer when totalSessions >= 3", () => {
		render(
			<VolumeLandmarks
				weeklyVolume={FULL_VOLUME}
				selectedMuscleGroup={null}
				totalSessions={5}
			/>,
		);
		expect(
			screen.queryByText(/accuracy improves with more training history/i),
		).not.toBeInTheDocument();
	});

	it("dims non-selected rows when selectedMuscleGroup is set", () => {
		render(
			<VolumeLandmarks
				weeklyVolume={FULL_VOLUME}
				selectedMuscleGroup="Chest"
			/>,
		);
		const backRow = screen.getByTestId("muscle-row-back");
		expect(backRow).toHaveStyle({ opacity: "0.5" });

		const chestRow = screen.getByTestId("muscle-row-chest");
		expect(chestRow).toHaveStyle({ opacity: "1" });
	});
});
