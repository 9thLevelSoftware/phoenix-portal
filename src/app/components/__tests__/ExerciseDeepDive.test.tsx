import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { ExerciseDeepDive } from "../analytics/ExerciseDeepDive";

// ---------------------------------------------------------------------------
// Mock TanStack Query hooks so no real network calls are made.
// The component calls useQuery twice — for exerciseProgress and
// personalRecords. We intercept at the module boundary.
// ---------------------------------------------------------------------------

const mockQueryData = vi.hoisted(() => ({
	progress: [] as unknown[],
	records: [] as unknown[],
}));

vi.mock("@/queries/progress", () => ({
	exerciseProgressOptions: (
		userId: string,
		exerciseName: string,
		profileId?: string | null,
	) => ({
		queryKey: ["progress", userId, exerciseName, profileId],
		queryFn: async () => mockQueryData.progress,
	}),
	exerciseListOptions: (userId: string, profileId?: string | null) => ({
		queryKey: ["progress-list", userId, profileId],
		queryFn: async () => [],
	}),
}));

vi.mock("@/queries/records", () => ({
	personalRecordsOptions: (userId: string, profileId?: string | null) => ({
		queryKey: ["records", userId, profileId],
		queryFn: async () => mockQueryData.records,
	}),
}));

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const EXERCISES = [
	{ name: "Bench Press", sessionCount: 12 },
	{ name: "Chest Fly", sessionCount: 7 },
	{ name: "Push Up", sessionCount: 3 },
];

const BASE_PROPS = {
	muscleGroup: "Chest",
	exercises: EXERCISES,
	userId: "test-user-id",
	unit: "kg" as const,
	profileId: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExerciseDeepDive", () => {
	beforeEach(() => {
		mockQueryData.progress = [];
		mockQueryData.records = [];
	});

	it("renders without crashing with valid props", () => {
		const { container } = renderWithProviders(
			<ExerciseDeepDive {...BASE_PROPS} />,
		);
		expect(container.firstChild).toBeTruthy();
	});

	it("shows exercise list with correct items", () => {
		renderWithProviders(<ExerciseDeepDive {...BASE_PROPS} />);
		const list = screen.getByTestId("exercise-list");
		// All three exercises should appear inside the list
		for (const ex of EXERCISES) {
			expect(list.textContent).toContain(ex.name);
		}
	});

	it("shows exercises sorted by session count descending", () => {
		renderWithProviders(<ExerciseDeepDive {...BASE_PROPS} />);
		const list = screen.getByTestId("exercise-list");
		const buttons = list.querySelectorAll("button");
		const names = Array.from(buttons).map((b) =>
			b.textContent?.split("\n")[0]?.trim(),
		);
		// Bench Press (12) should appear before Chest Fly (7)
		const benchIdx = names.findIndex((n) => n?.includes("Bench Press"));
		const flyIdx = names.findIndex((n) => n?.includes("Chest Fly"));
		expect(benchIdx).toBeLessThan(flyIdx);
	});

	it("shows activation profile for the selected (first) exercise", () => {
		renderWithProviders(<ExerciseDeepDive {...BASE_PROPS} />);
		const profile = screen.getByTestId("activation-profile");
		// "Bench Press" maps to Chest primary + Anterior Deltoid + Triceps secondary
		expect(profile.textContent).toContain("100%");
		expect(profile).toBeInTheDocument();
	});

	it("shows stats row", () => {
		renderWithProviders(<ExerciseDeepDive {...BASE_PROPS} />);
		expect(screen.getByTestId("stats-row")).toBeInTheDocument();
	});

	it("breaks PR counts down by workout phase", async () => {
		mockQueryData.records = [
			{
				exercise_name: "Bench Press",
				achieved_at: new Date(),
				workout_phase: "Concentric",
			},
			{
				exercise_name: "Bench Press",
				achieved_at: new Date(),
				workout_phase: "Eccentric",
			},
			{
				exercise_name: "Bench Press",
				achieved_at: new Date(),
				workout_phase: "Eccentric",
			},
			{
				exercise_name: "Chest Fly",
				achieved_at: new Date(),
				workout_phase: "Concentric",
			},
		];

		renderWithProviders(<ExerciseDeepDive {...BASE_PROPS} />);

		const breakdown = await screen.findByTestId("phase-pr-breakdown");
		expect(breakdown).toHaveTextContent("Concentric: 1");
		expect(breakdown).toHaveTextContent("Eccentric: 2");
		expect(breakdown).not.toHaveTextContent("Chest Fly");
	});

	it("shows empty state when exercise list is empty", () => {
		renderWithProviders(<ExerciseDeepDive {...BASE_PROPS} exercises={[]} />);
		expect(
			screen.getByText(/no exercises found for chest/i),
		).toBeInTheDocument();
	});

	it("shows 'Not enough data for 1RM estimate' when progress data is empty", () => {
		// Query mocks return [] by default so empty state should render
		renderWithProviders(<ExerciseDeepDive {...BASE_PROPS} />);
		expect(screen.getByTestId("empty-state")).toBeInTheDocument();
	});

	it("renders without crashing with lbs unit", () => {
		const { container } = renderWithProviders(
			<ExerciseDeepDive {...BASE_PROPS} unit="lbs" />,
		);
		expect(container.firstChild).toBeTruthy();
	});

	it("renders without crashing with a profileId", () => {
		const { container } = renderWithProviders(
			<ExerciseDeepDive {...BASE_PROPS} profileId="profile-123" />,
		);
		expect(container.firstChild).toBeTruthy();
	});
});
