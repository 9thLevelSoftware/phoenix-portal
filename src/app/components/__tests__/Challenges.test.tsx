import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { Challenges } from "../Challenges";

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

describe("Challenges", () => {
	it("renders without crashing", () => {
		const { container } = renderWithProviders(<Challenges />);
		// Component renders loading skeletons while queries are pending
		expect(container.firstChild).toBeTruthy();
	});
});
