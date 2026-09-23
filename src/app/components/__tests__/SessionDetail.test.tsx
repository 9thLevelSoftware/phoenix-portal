import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { SessionDetail } from "../SessionDetail";

const SESSION_ID = "00000000-0000-4000-8000-000000000010";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockSub = vi.hoisted(() => ({
	isFlame: true,
}));

const mockParams = vi.hoisted(() => ({
	current: {
		sessionId: "00000000-0000-4000-8000-000000000010",
	} as Record<string, string | undefined>,
}));

const mockDetail = vi.hoisted(() => ({
	exercises: [] as unknown[],
	heaviest_lift_kg: null as number | null,
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
vi.mock("react-router", async () => {
	const actual = await vi.importActual("react-router");
	return {
		...actual,
		useParams: () => mockParams.current,
		useNavigate: () => vi.fn(),
	};
});
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: (options: { queryKey?: unknown[] }) => {
			const key = options.queryKey ?? [];
			if (key[0] === "workouts" && key[1] === "detail") {
				return {
					data: {
						id: "00000000-0000-4000-8000-000000000010",
						user_id: "00000000-0000-4000-8000-000000000999",
						name: "Strength Session",
						started_at: new Date(),
						duration_seconds: 1800,
						total_volume: 1000,
						set_count: 0,
						exercise_count: 0,
						pr_count: 0,
						routine_name: null,
						workout_mode: "Old School",
						notes: null,
						heaviest_lift_kg: mockDetail.heaviest_lift_kg,
						exercises: mockDetail.exercises,
					},
					isPending: false,
					isError: false,
					error: null,
					refetch: () => Promise.resolve(),
				};
			}
			if (key[0] === "profile") {
				return {
					data: { weight_unit: "kg" },
					isPending: false,
					isError: false,
					error: null,
					refetch: () => Promise.resolve(),
				};
			}
			return {
				data: [],
				isPending: false,
				isError: false,
				error: null,
				refetch: () => Promise.resolve(),
			};
		},
	};
});

describe("SessionDetail", () => {
	beforeEach(() => {
		mockSub.isFlame = true;
		mockParams.current = { sessionId: SESSION_ID };
		mockDetail.exercises = [];
		mockDetail.heaviest_lift_kg = null;
	});

	function exerciseWith(id: string, cableCount: 1 | 2 | null) {
		return {
			id,
			session_id: SESSION_ID,
			name: "Bench Press",
			muscle_group: "Chest",
			order_index: 0,
			cable_count: cableCount,
			hasPR: false,
			sets: [
				{
					id: `${id}-set`,
					exercise_id: id,
					set_number: 1,
					target_reps: 10,
					actual_reps: 10,
					weight_kg: 20,
					rpe: null,
					is_pr: false,
					notes: null,
				},
			],
		};
	}

	it("shows set weight per cable first with the total for 2 cables", () => {
		mockDetail.exercises = [
			exerciseWith("00000000-0000-4000-8000-0000000000e1", 2),
		];
		renderWithProviders(<SessionDetail />);
		expect(
			screen.getByText("20 kg per cable · 40 kg total"),
		).toBeInTheDocument();
	});

	it("never doubles a single-cable set", () => {
		mockDetail.exercises = [
			exerciseWith("00000000-0000-4000-8000-0000000000e2", 1),
		];
		renderWithProviders(<SessionDetail />);
		expect(
			screen.getByText("20 kg per cable · 20 kg total"),
		).toBeInTheDocument();
	});

	it("shows per cable only when the cable count is unknown", () => {
		mockDetail.exercises = [
			exerciseWith("00000000-0000-4000-8000-0000000000e3", null),
		];
		mockDetail.heaviest_lift_kg = 30;
		renderWithProviders(<SessionDetail />);
		expect(screen.getByText("20 kg per cable")).toBeInTheDocument();
		expect(screen.getByText("30 kg per cable")).toBeInTheDocument();
		expect(screen.queryByText(/total/)).not.toBeInTheDocument();
	});

	it("shows Flame Compare and Session Replay entries", () => {
		renderWithProviders(<SessionDetail />);
		expect(screen.getByRole("button", { name: /compare with/i })).toBeEnabled();
		const replay = screen.getByRole("link", { name: /session replay/i });
		expect(replay).toHaveAttribute("href", `/replay/${SESSION_ID}`);
	});

	it("does not offer Compare or Replay as Ember journeys", () => {
		mockSub.isFlame = false;
		renderWithProviders(<SessionDetail />);
		expect(
			screen.getByRole("button", { name: /compare with/i }),
		).toBeDisabled();
		expect(
			screen.getByRole("button", { name: /session replay/i }),
		).toBeDisabled();
		expect(
			screen.queryByRole("link", { name: /session replay/i }),
		).not.toBeInTheDocument();
	});
});
