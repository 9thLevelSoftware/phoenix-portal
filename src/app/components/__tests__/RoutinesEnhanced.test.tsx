import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { RoutinesEnhanced } from "../RoutinesEnhanced";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockQuery = vi.hoisted(() => ({
	result: {
		data: undefined as unknown[] | undefined,
		isPending: true,
		isError: false,
		refetch: () => Promise.resolve(),
	},
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: () => mockQuery.result,
	};
});

describe("RoutinesEnhanced", () => {
	beforeEach(() => {
		mockQuery.result = {
			data: undefined,
			isPending: true,
			isError: false,
			refetch: () => Promise.resolve(),
		};
	});

	it("renders without crashing", () => {
		renderWithProviders(<RoutinesEnhanced />);
		expect(screen.getAllByText(/my routines/i).length).toBeGreaterThan(0);
	});

	it("shows an error, not the athlete-empty copy, when the list query fails", () => {
		mockQuery.result = {
			data: undefined,
			isPending: false,
			isError: true,
			refetch: () => Promise.resolve(),
		};
		renderWithProviders(<RoutinesEnhanced />);
		expect(
			screen.getByText(/couldn't load your routines/i),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
		expect(
			screen.queryByText(/build your first routine/i),
		).not.toBeInTheDocument();
	});

	it("shows the empty state only after a successful zero-row fetch", () => {
		mockQuery.result = {
			data: [],
			isPending: false,
			isError: false,
			refetch: () => Promise.resolve(),
		};
		renderWithProviders(<RoutinesEnhanced />);
		expect(screen.getByText(/build your first routine/i)).toBeInTheDocument();
		expect(
			screen.queryByText(/couldn't load your routines/i),
		).not.toBeInTheDocument();
	});
});
