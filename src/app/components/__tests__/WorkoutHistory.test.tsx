import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
		isFlame: false,
		isPremium: true,
		tier: "EMBER",
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
	it("renders without crashing", () => {
		mockInfinite.result = {
			...mockInfinite.result,
			isPending: true,
			isError: false,
			data: undefined,
		};
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
});
