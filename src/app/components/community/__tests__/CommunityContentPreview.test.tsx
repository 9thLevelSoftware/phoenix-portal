import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routineExercisesSnapshotSchema } from "@/schemas/community";
import {
	CycleSnapshotPreview,
	RoutineSnapshotPreview,
} from "../CommunityContentPreview";

describe("CommunityContentPreview", () => {
	it("renders full routine exercise details from a snapshot", () => {
		render(
			<RoutineSnapshotPreview
				exercises={[
					{
						name: "Bench Press",
						muscle_group: "Chest",
						sets: 3,
						reps: 8,
						weight: 40,
						rest_seconds: 90,
						duration_seconds: null,
						mode: "OLD_SCHOOL",
						order_index: 0,
						per_set_weights: [40, 42.5, 45],
						per_set_reps: [8, 8, 6],
						per_set_rest: [90, 90, 120],
						is_amrap: false,
						is_bodyweight: false,
						stall_detection: true,
						drop_set_enabled: true,
						drop_set_min_weight_kg: 12.5,
					},
				]}
			/>,
		);

		expect(screen.getByText("Bench Press")).toBeInTheDocument();
		expect(screen.getByText("Drop set")).toBeInTheDocument();
		// Stored per cable and shown per cable, as on the phone (KD-8).
		expect(
			screen.getByText(/3 sets \/ 8 reps \/ 40 kg per cable/i),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Weights per cable: 40 kg, 43 kg, 45 kg/i),
		).toBeInTheDocument();
		// Stored wire mode renders as its display label, not "OLD_SCHOOL".
		expect(screen.getByText("Old School")).toBeInTheDocument();
		expect(screen.queryByText("OLD_SCHOOL")).not.toBeInTheDocument();
		expect(screen.getByText(/Rest: 90s between sets/i)).toBeInTheDocument();
	});

	it("renders routine loads in lbs when requested", () => {
		render(
			<RoutineSnapshotPreview
				unit="lbs"
				exercises={[
					{
						name: "Bench Press",
						muscle_group: "Chest",
						sets: 3,
						reps: 8,
						weight: 40,
						rest_seconds: 90,
						duration_seconds: null,
						mode: "OLD_SCHOOL",
						order_index: 0,
						per_set_weights: [40, 45],
						per_set_reps: [8, 6],
						per_set_rest: [90, 120],
						is_amrap: false,
						is_bodyweight: false,
					},
				]}
			/>,
		);

		expect(
			screen.getByText(/3 sets \/ 8 reps \/ 88.2 lbs per cable/),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Weights per cable: 88.2 lbs, 99.2 lbs/),
		).toBeInTheDocument();
	});

	it("keeps exercise numbering sequential when supersets are rendered", () => {
		render(
			<RoutineSnapshotPreview
				exercises={[
					{
						name: "Back Squat",
						muscle_group: "Legs",
						sets: 3,
						reps: 5,
						weight: 80,
						rest_seconds: 120,
						mode: "OLD_SCHOOL",
						order_index: 0,
					},
					{
						name: "Pull Up",
						muscle_group: "Back",
						sets: 3,
						reps: 8,
						weight: 0,
						rest_seconds: 90,
						mode: "OLD_SCHOOL",
						order_index: 1,
						superset_id: "superset-a",
						superset_order: 0,
					},
					{
						name: "Push Up",
						muscle_group: "Chest",
						sets: 3,
						reps: 12,
						weight: 0,
						rest_seconds: 90,
						mode: "OLD_SCHOOL",
						order_index: 2,
						superset_id: "superset-a",
						superset_order: 1,
					},
					{
						name: "Plank",
						muscle_group: "Core",
						sets: 3,
						reps: 1,
						weight: 0,
						rest_seconds: 60,
						duration_seconds: 45,
						mode: "OLD_SCHOOL",
						order_index: 3,
					},
				]}
			/>,
		);

		expect(
			screen.getAllByText(/^\d\d$/).map((node) => node.textContent),
		).toEqual(["01", "02", "03", "04"]);
	});

	it("renders a legacy snapshot's hex superset colour and labels settings", () => {
		const exercises = routineExercisesSnapshotSchema.parse(
			[0, 1].map((index) => ({
				name: `Ex ${index}`,
				mode: "ECHO",
				order_index: index,
				superset_id: "superset-a",
				superset_order: index,
				superset_color: "#F59E0B",
				eccentric_load: index === 0 ? "LOAD_120" : "heavy",
				echo_level: index === 0 ? "epic" : "high",
				rep_count_timing: "BOTTOM",
				stop_at_position: "Lockout",
			})),
		);
		render(<RoutineSnapshotPreview exercises={exercises} />);

		const group = document.querySelector<HTMLElement>(
			"[style*='border-left-width']",
		);
		expect(group?.style.borderLeftColor).toBe("rgb(245, 158, 11)");
		expect(screen.getByText("Eccentric 120%")).toBeInTheDocument();
		expect(screen.getByText("Echo Epic")).toBeInTheDocument();
		// Legacy words were the phone's defaults, so they don't show as settings.
		expect(screen.queryByText(/heavy|high|Lockout/)).not.toBeInTheDocument();
		expect(screen.getAllByText("Timing Bottom")).toHaveLength(2);
		expect(screen.queryByText("Stop at top")).not.toBeInTheDocument();
	});

	it("renders a colour name (not valid CSS) as its hex", () => {
		render(
			<RoutineSnapshotPreview
				exercises={[0, 1].map((index) => ({
					name: `Ex ${index}`,
					muscle_group: "Arms",
					sets: 3,
					reps: 10,
					weight: 0,
					rest_seconds: 60,
					mode: "OLD_SCHOOL",
					order_index: index,
					superset_id: "superset-a",
					superset_order: index,
					superset_color: "amber",
				}))}
			/>,
		);
		const group = document.querySelector<HTMLElement>(
			"[style*='border-left-width']",
		);
		expect(group?.style.borderLeftColor).toBe("rgb(245, 158, 11)");
	});

	it("renders cycle days, overrides, and embedded routine details", () => {
		render(
			<CycleSnapshotPreview
				snapshot={{
					duration_weeks: 7,
					workout_days: 1,
					rest_days: 1,
					progression_settings: { type: "percentage", amount: 5 },
					deload_settings: null,
					days: [
						{
							day_number: 1,
							day_type: "workout",
							routine_id: "routine-1",
							weight_adjustment: 5,
							rep_modifier: 1,
							rest_override: 120,
							notes: "Push emphasis",
							rest_type: null,
							routine: {
								source_routine_id: "routine-1",
								name: "Push Routine",
								description: "Upper body",
								exercise_count: 1,
								estimated_duration: 150,
								tags: ["Chest"],
								exercises: [
									{
										name: "Bench Press",
										muscle_group: "Chest",
										sets: 3,
										reps: 8,
										weight: 40,
										rest_seconds: 90,
										mode: "OLD_SCHOOL",
										order_index: 0,
									},
								],
							},
						},
						{
							day_number: 2,
							day_type: "rest",
							routine_id: null,
							weight_adjustment: 0,
							rep_modifier: 0,
							rest_override: null,
							notes: null,
							rest_type: "complete",
						},
					],
				}}
			/>,
		);

		expect(screen.getByText("Cycle Details")).toBeInTheDocument();
		expect(screen.getByText("7 weeks")).toBeInTheDocument();
		expect(screen.getByText("Push Routine")).toBeInTheDocument();
		expect(screen.getByText(/1 exercises \/ 3 min/i)).toBeInTheDocument();
		expect(screen.getByText("Push emphasis")).toBeInTheDocument();
		expect(screen.getByText("View Push Routine")).toBeInTheDocument();
		expect(screen.getByText("Rest Day")).toBeInTheDocument();
	});
});
