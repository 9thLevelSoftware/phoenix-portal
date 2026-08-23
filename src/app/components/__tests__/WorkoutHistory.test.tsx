import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { WorkoutHistory } from "../WorkoutHistory";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockSub = vi.hoisted(() => ({
	isFlame: false,
}));

const sampleWorkout = {
	id: "00000000-0000-4000-8000-000000000010",
	user_id: "00000000-0000-4000-8000-000000000999",
	name: "Strength Session",
	started_at: new Date(),
	duration_seconds: 1800,
	total_volume: 1000,
	set_count: 3,
	exercise_count: 1,
	pr_count: 1,
	routine_name: null,
	workout_mode: "Old School",
	notes: null,
};

const mockInfinite = vi.hoisted(() => ({
	result: {
		data: undefined as { pages: unknown[][] } | undefined,
		fetchNextPage: () => Promise.resolve(),
		hasNextPage: false,
		isFetchingNextPage: false,
		isFetchNextPageError: false,
		isPending: true,
		isError: false,
		refetch: () => Promise.resolve(),
	},
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@/hooks/useSubscription", () => ({
	useSubscription: () => ({
		isFlame: mockSub.isFlame,
		isPremium: true,
		tier: mockSub.isFlame ? "FLAME" : "EMBER",
		isError: false,
		isLoading: false,
	}),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useInfiniteQuery: () => mockInfinite.result,
		useQuery: () => ({
			data: { weight_unit: "kg" },
			isPending: false,
			isError: false,
		}),
	};
});

describe("WorkoutHistory", () => {
	beforeEach(() => {
		mockSub.isFlame = false;
		mockInfinite.result = {
			...mockInfinite.result,
			isPending: true,
			isError: false,
			data: undefined,
			hasNextPage: false,
			isFetchingNextPage: false,
			isFetchNextPageError: false,
		};
	});

	it("renders without crashing", () => {
		const { container } = renderWithProviders(<WorkoutHistory />);
		expect(container.firstChild).toBeTruthy();
	});

	it("shows an error, not the empty welcome, when the list query fails", () => {
		mockInfinite.result = {
			...mockInfinite.result,
			isPending: false,
			isError: true,
			data: undefined,
		};
		renderWithProviders(<WorkoutHistory />);
		expect(
			screen.getByText(/couldn't load your workout history/i),
		).toBeInTheDocument();
		expect(screen.queryByText(/no workouts yet/i)).not.toBeInTheDocument();
	});

	it("shows the empty state only after a successful zero-row fetch", () => {
		mockInfinite.result = {
			...mockInfinite.result,
			isPending: false,
			isError: false,
			data: { pages: [[]] },
		};
		renderWithProviders(<WorkoutHistory />);
		expect(screen.getByText(/no workouts yet/i)).toBeInTheDocument();
		expect(
			screen.queryByText(/couldn't load your workout history/i),
		).not.toBeInTheDocument();
	});

	it("does not present Compare as an Ember journey — Flame badge links to pricing", () => {
		mockSub.isFlame = false;
		mockInfinite.result = {
			...mockInfinite.result,
			isPending: false,
			isError: false,
			data: { pages: [[sampleWorkout]] },
		};
		renderWithProviders(<WorkoutHistory />);
		const compareLink = screen.getByRole("link", { name: /compare/i });
		expect(compareLink).toHaveAttribute("href", "/pricing");
		expect(screen.getByText("FLAME")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /^compare$/i }),
		).not.toBeInTheDocument();
	});

	it("shows the Compare control for Flame, not a pricing upgrade chip", () => {
		mockSub.isFlame = true;
		mockInfinite.result = {
			...mockInfinite.result,
			isPending: false,
			isError: false,
			data: { pages: [[sampleWorkout]] },
		};
		renderWithProviders(<WorkoutHistory />);
		expect(
			screen.getByRole("button", { name: /^compare$/i }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: /compare/i }),
		).not.toBeInTheDocument();
	});
});
