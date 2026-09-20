import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { Goals } from "../Goals";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockQuery = vi.hoisted(() => ({
	goals: {
		data: undefined as unknown[] | undefined,
		isPending: true,
		isError: false,
		refetch: () => Promise.resolve(),
	},
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@/hooks/useSubscription", () => ({
	useSubscription: () => ({
		isPremium: true,
		isFlame: false,
		isInferno: false,
		tier: "EMBER",
		isError: false,
		isLoading: false,
	}),
}));
vi.mock("@/mutations/goals", () => ({
	useCreateGoal: () => ({ mutate: vi.fn(), isPending: false }),
	useUpdateGoal: () => ({ mutate: vi.fn(), isPending: false }),
	useArchiveGoal: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: (options: { queryKey?: unknown[] }) => {
			const key = options.queryKey ?? [];
			if (key[0] === "goals") {
				return mockQuery.goals;
			}
			return {
				data: [],
				isPending: false,
				isError: false,
				refetch: () => Promise.resolve(),
			};
		},
	};
});

describe("Goals page", () => {
	beforeEach(() => {
		mockQuery.goals = {
			data: undefined,
			isPending: true,
			isError: false,
			refetch: () => Promise.resolve(),
		};
	});

	it("shows an error, not the athlete-empty copy, when goals fail to load", () => {
		mockQuery.goals = {
			data: undefined,
			isPending: false,
			isError: true,
			refetch: () => Promise.resolve(),
		};
		renderWithProviders(<Goals />);
		expect(screen.getByText(/couldn't load your goals/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
		expect(screen.queryByText(/no active goals/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/upgrade to set goals/i)).not.toBeInTheDocument();
	});

	it("labels PR-goal targets per cable on the goal card and in the form", async () => {
		mockQuery.goals = {
			data: [
				{
					id: "00000000-0000-4000-8000-0000000000a1",
					user_id: "test-user-id",
					goal_type: "pr",
					target_value: 40,
					target_unit: "kg",
					exercise_name: "Squat",
					exercise_id: null,
					deadline: null,
					period: "weekly",
					status: "active",
					completed_at: null,
					created_at: new Date(),
					updated_at: new Date(),
				},
			],
			isPending: false,
			isError: false,
			refetch: () => Promise.resolve(),
		};
		renderWithProviders(<Goals />);
		expect(
			screen.getAllByText("Squat: 40 kg per cable").length,
		).toBeGreaterThan(0);
		expect(screen.queryByText(/Squat: 80 kg/)).not.toBeInTheDocument();

		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /new goal/i }));
		await user.click(screen.getByRole("tab", { name: /PR/ }));
		expect(
			screen.getByLabelText("Target weight (per cable, kg)"),
		).toBeInTheDocument();
	});

	it("shows the empty state only after a successful zero-row fetch", () => {
		mockQuery.goals = {
			data: [],
			isPending: false,
			isError: false,
			refetch: () => Promise.resolve(),
		};
		renderWithProviders(<Goals />);
		expect(screen.getByText(/no active goals/i)).toBeInTheDocument();
		expect(
			screen.queryByText(/couldn't load your goals/i),
		).not.toBeInTheDocument();
	});
});
