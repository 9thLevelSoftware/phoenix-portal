import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { LandingPage } from "../LandingPage";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: null,
		session: null,
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);

describe("LandingPage", () => {
	it("renders without crashing", () => {
		renderWithProviders(<LandingPage />);
		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
			/project phoenix/i,
		);
	});
});
