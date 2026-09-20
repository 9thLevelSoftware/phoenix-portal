import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { Analytics } from "../Analytics";

const bodyMapLoader = vi.hoisted(() => ({
	loadBodyMuscleAnalytics: vi.fn(),
}));
vi.mock("@/lib/body-muscle-analytics-loader", () => bodyMapLoader);

function renderAnalyticsAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<QueryClientProvider client={new QueryClient()}>
				<Analytics />
			</QueryClientProvider>
		</MemoryRouter>,
	);
}

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockQuery = vi.hoisted(() => ({
	mode: "pending" as "pending" | "error" | "empty",
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: () => {
			if (mockQuery.mode === "pending") {
				return {
					data: undefined,
					isPending: true,
					isFetching: false,
					isError: false,
					error: null,
					dataUpdatedAt: 0,
					refetch: () => Promise.resolve(),
				};
			}
			if (mockQuery.mode === "error") {
				return {
					data: undefined,
					isPending: false,
					isFetching: false,
					isError: true,
					error: new Error("analytics failed"),
					dataUpdatedAt: 0,
					refetch: () => Promise.resolve(),
				};
			}
			return {
				data: undefined,
				isPending: false,
				isFetching: false,
				isError: false,
				error: null,
				dataUpdatedAt: Date.now(),
				refetch: () => Promise.resolve(),
			};
		},
	};
});

describe("Analytics", () => {
	beforeEach(() => {
		mockQuery.mode = "pending";
		bodyMapLoader.loadBodyMuscleAnalytics.mockReset();
		bodyMapLoader.loadBodyMuscleAnalytics.mockResolvedValue({
			buildBodyMuscleFocusModel: vi.fn(() => ({
				muscles: [],
				muscleById: {},
				totalSets: 0,
				totalReps: 0,
				totalVolumeKg: 0,
				totalLoad: 0,
				estimatedExerciseCount: 0,
				unmatchedExerciseCount: 0,
			})),
		});
	});

	it("does not download the body-muscle map outside the Body tab", async () => {
		renderAnalyticsAt("/analytics?tab=overview");
		// Give any effect a chance to run.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(bodyMapLoader.loadBodyMuscleAnalytics).not.toHaveBeenCalled();
	});

	it("downloads the body-muscle map when the Body tab is open", async () => {
		renderAnalyticsAt("/analytics?tab=body");
		await waitFor(() =>
			expect(bodyMapLoader.loadBodyMuscleAnalytics).toHaveBeenCalledTimes(1),
		);
	});

	it("renders without crashing", () => {
		const { container } = renderWithProviders(<Analytics />);
		expect(container.firstChild).toBeTruthy();
	});

	it("shows an error, not the athlete-empty copy, when analytics queries fail", () => {
		mockQuery.mode = "error";
		renderWithProviders(<Analytics />);
		expect(
			screen.getAllByText(/couldn't load analytics/i).length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByRole("button", { name: /retry/i }).length,
		).toBeGreaterThan(0);
		expect(screen.queryByText(/your analytics await/i)).not.toBeInTheDocument();
	});

	it("shows the empty state only after a successful zero-row fetch", () => {
		mockQuery.mode = "empty";
		renderWithProviders(<Analytics />);
		expect(screen.getAllByText(/your analytics await/i).length).toBeGreaterThan(
			0,
		);
		expect(
			screen.queryByText(/couldn't load analytics/i),
		).not.toBeInTheDocument();
	});
});
