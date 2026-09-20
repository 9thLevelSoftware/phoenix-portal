import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { formatProfileVolume, Profile } from "../Profile";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockData = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: (options: { queryKey?: unknown[] }) => {
			const key = options.queryKey ?? [];
			const data = !mockData.enabled
				? undefined
				: key[1] === "stats"
					? { totalWorkouts: 3, totalVolume: 1500, bestStreak: 1, prCount: 0 }
					: key[1] === "gamification"
						? { total_volume_kg: 99000, total_workouts: 3, total_reps: 10 }
						: undefined;
			return {
				data,
				isPending: false,
				isError: false,
				error: null,
				refetch: () => Promise.resolve(),
			};
		},
	};
});

describe("Profile", () => {
	it("renders without crashing", () => {
		mockData.enabled = false;
		const { container } = renderWithProviders(<Profile />);
		expect(container.firstChild).toBeTruthy();
	});

	it("formats profile volume per cable", () => {
		expect(formatProfileVolume(1500, "kg")).toBe("1.5K kg per cable");
		expect(formatProfileVolume(null, "kg")).toBe("0 kg per cable");
	});

	it("shows only the session-derived per-cable volume, never the device total", () => {
		mockData.enabled = true;
		renderWithProviders(<Profile />);
		expect(screen.getAllByText("1.5K kg per cable").length).toBeGreaterThan(0);
		expect(screen.queryByText(/99\.0K/)).not.toBeInTheDocument();
		mockData.enabled = false;
	});
});
