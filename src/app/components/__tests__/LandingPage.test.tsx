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
			/see every rep as data/i,
		);
	});

	it("renders proof row capabilities", () => {
		renderWithProviders(<LandingPage />);
		expect(screen.getByText("Force curves")).toBeInTheDocument();
		expect(screen.getByText("Recovery signals")).toBeInTheDocument();
		expect(screen.getByText("Records")).toBeInTheDocument();
		expect(screen.getByText("Replay")).toBeInTheDocument();
	});

	it("renders product-aligned CTAs", () => {
		renderWithProviders(<LandingPage />);
		const previewBtns = screen.getAllByRole("button", { name: /preview dashboard/i });
		expect(previewBtns.length).toBeGreaterThanOrEqual(1);
		const appLinks = screen.getAllByRole("link", { name: /get the mobile app/i });
		expect(appLinks.length).toBeGreaterThanOrEqual(1);
	});

	it("renders feature cards with correct tier badges", () => {
		renderWithProviders(<LandingPage />);
		const badges = screen.getAllByText(/^(EMBER|FLAME|INFERNO)$/);
		expect(badges.length).toBeGreaterThanOrEqual(6);
		expect(screen.getAllByText("EMBER")).toHaveLength(2);
		expect(screen.getAllByText("FLAME")).toHaveLength(2);
		expect(screen.getAllByText("INFERNO")).toHaveLength(2);
	});

	it("renders section eyebrow labels", () => {
		renderWithProviders(<LandingPage />);
		expect(screen.getByText("FEATURES")).toBeInTheDocument();
		expect(screen.getByText("PRICING")).toBeInTheDocument();
	});
});
