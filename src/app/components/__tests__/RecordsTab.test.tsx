import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import RecordsTab from "../analytics/RecordsTab";

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

describe("RecordsTab", () => {
	beforeEach(() => {
		mockQuery.result = {
			data: undefined,
			isPending: true,
			isError: false,
			refetch: () => Promise.resolve(),
		};
	});

	it("shows an error, not the athlete-empty copy, when records fail to load", () => {
		mockQuery.result = {
			data: undefined,
			isPending: false,
			isError: true,
			refetch: () => Promise.resolve(),
		};
		renderWithProviders(<RecordsTab unit="kg" />);
		expect(
			screen.getByText(/couldn't load personal records/i),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
		expect(
			screen.queryByText(/no personal records yet/i),
		).not.toBeInTheDocument();
	});

	it("shows the empty state only after a successful zero-row fetch", () => {
		mockQuery.result = {
			data: [],
			isPending: false,
			isError: false,
			refetch: () => Promise.resolve(),
		};
		renderWithProviders(<RecordsTab unit="kg" />);
		expect(screen.getByText(/no personal records yet/i)).toBeInTheDocument();
		expect(
			screen.queryByText(/couldn't load personal records/i),
		).not.toBeInTheDocument();
	});
});
