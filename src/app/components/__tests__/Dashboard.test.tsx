import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { Dashboard } from "../Dashboard";

const mockRecentPr = vi.hoisted(() => ({
	record: {
		id: "00000000-0000-4000-8000-000000000001",
		user_id: "00000000-0000-4000-8000-000000000999",
		exercise_name: "Bench Press",
		exercise_id: null,
		muscle_group: "Chest",
		record_type: "MAX_WEIGHT",
		value: 125,
		unit: "kg",
		achieved_at: new Date(),
		previous_value: null,
		workout_phase: "Concentric",
		local_profile_id: null,
	},
}));

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
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQueries: vi.fn(() => []),
		useQuery: vi.fn((options: { queryKey?: unknown[] }) => {
			const key = options.queryKey ?? [];
			if (key[0] === "records" && key[1] === "recent") {
				return {
					data: [mockRecentPr.record],
					isPending: false,
					isLoading: false,
					isError: false,
				};
			}
			if (key[0] === "workouts" && key[1] === "dashboard-stats") {
				return {
					data: [
						{
							started_at: new Date().toISOString(),
							total_volume: 500,
							duration_seconds: 1800,
							pr_count: 1,
							estimated_calories: 120,
							form_score: 90,
						},
					],
					isPending: false,
					isLoading: false,
					isError: false,
				};
			}
			if (key[0] === "workouts" && key[1] === "list") {
				return {
					data: [
						{
							id: "00000000-0000-4000-8000-000000000010",
							user_id: "00000000-0000-4000-8000-000000000999",
							name: "Strength Session",
							started_at: new Date(),
							duration_seconds: 30,
							total_volume: 1000,
							set_count: 3,
							exercise_count: 1,
							pr_count: 1,
							routine_name: null,
							workout_mode: "Old School",
							notes: null,
						},
					],
					isPending: false,
					isLoading: false,
					isError: false,
				};
			}
			if (key[0] === "profile" && key[1] === "badges") {
				return {
					data: [],
					isPending: false,
					isLoading: false,
					isError: false,
				};
			}
			if (key[0] === "profile") {
				return {
					data: { display_name: "Test User", weight_unit: "kg" },
					isPending: false,
					isLoading: false,
					isError: false,
				};
			}
			return {
				data: [],
				isPending: false,
				isLoading: false,
				isError: false,
			};
		}),
	};
});

describe("Dashboard", () => {
	it("renders without crashing", () => {
		renderWithProviders(<Dashboard />);
		expect(
			screen.getAllByRole("heading", { name: /welcome back/i }).length,
		).toBeGreaterThan(0);
	});

	it("shows workout phase on recent PR cards", () => {
		renderWithProviders(<Dashboard />);

		expect(screen.getByText("Bench Press")).toBeInTheDocument();
		expect(screen.getByText("Concentric")).toBeInTheDocument();
	});
});
