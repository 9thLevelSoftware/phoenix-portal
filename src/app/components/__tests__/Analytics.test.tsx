import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { Analytics } from "../Analytics";

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

describe("Analytics", () => {
	it("renders without crashing", () => {
		const { container } = renderWithProviders(<Analytics />);
		// Component renders without crashing (loading state with skeletons)
		expect(container.firstChild).toBeTruthy();
	});
});
