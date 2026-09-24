import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Leaderboard } from "../Leaderboard";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
	supabase: { functions: { invoke } },
}));

vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/app/hooks/usePreferredWeightUnit", () => ({
	usePreferredWeightUnit: () => "kg",
}));

function renderLeaderboard(
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<Leaderboard />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("Leaderboard", () => {
	beforeEach(() => invoke.mockReset());

	it("reports a rankings outage as unavailable, with a retry, not as an empty board", async () => {
		invoke.mockResolvedValue({ data: null, error: new Error("boom") });
		renderLeaderboard();

		expect(
			await screen.findByRole("heading", { name: "Rankings unavailable" }),
		).toBeInTheDocument();
		expect(screen.queryByText(/start climbing/i)).not.toBeInTheDocument();

		invoke.mockClear();
		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(invoke).toHaveBeenCalledWith("compute-rankings", {
			body: { type: "global" },
		});
	});

	it("keeps showing the last good board when a background refresh fails", async () => {
		const entry = {
			userId: "user-2",
			displayName: "Ada",
			avatarUrl: null,
			rank: 1,
			value: 12,
			percentile: 99,
		};
		const board = {
			totalVolume: [entry],
			workoutCount: [entry],
			longestStreak: [entry],
			currentStreak: [entry],
			prCount: [entry],
			exerciseMastery: [entry],
		};
		invoke.mockResolvedValue({ data: board, error: null });
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		renderLeaderboard(client);
		expect(await screen.findByText("Most Workouts")).toBeInTheDocument();

		// e.g. a window-focus refetch that hits a 429
		invoke.mockResolvedValue({ data: null, error: new Error("429") });
		await client.refetchQueries();

		expect(screen.getByText("Most Workouts")).toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Rankings unavailable" }),
		).not.toBeInTheDocument();
	});

	it("keeps the empty personal ranking copy for a user with no rankings", async () => {
		invoke.mockImplementation(
			(_name: string, options?: { body?: { type?: string } }) =>
				Promise.resolve(
					options?.body?.type === "user"
						? { data: [], error: null }
						: { data: null, error: new Error("not under test") },
				),
		);
		renderLeaderboard();

		await userEvent.click(screen.getByRole("tab", { name: /my rankings/i }));
		expect(
			await screen.findByRole("heading", { name: "Build your ranking" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(/sync workouts from the phoenix mobile app/i),
		).toBeInTheDocument();
	});
});
