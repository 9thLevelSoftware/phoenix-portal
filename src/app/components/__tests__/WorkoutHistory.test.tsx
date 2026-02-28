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

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);

describe("WorkoutHistory", () => {
	it("renders without crashing", () => {
		const { container } = renderWithProviders(<WorkoutHistory />);
		// Component renders without crashing (loading state with skeletons)
		expect(container.firstChild).toBeTruthy();
	});
});
