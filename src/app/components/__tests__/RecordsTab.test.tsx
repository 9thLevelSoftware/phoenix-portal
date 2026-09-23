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

const emptyInfiniteResult = () => ({
	data: undefined as unknown[] | undefined,
	isPending: true,
	isError: false,
	error: null as unknown,
	refetch: () => Promise.resolve(),
	fetchNextPage: () => Promise.resolve(),
	hasNextPage: false,
	isFetchingNextPage: false,
});

const mockQuery = vi.hoisted(() => ({
	result: {
		data: undefined as unknown[] | undefined,
		isPending: true,
		isError: false,
		error: null as unknown,
		refetch: () => Promise.resolve(),
		fetchNextPage: () => Promise.resolve(),
		hasNextPage: false,
		isFetchingNextPage: false,
	},
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useInfiniteQuery: () => mockQuery.result,
	};
});

describe("RecordsTab", () => {
	beforeEach(() => {
		mockQuery.result = emptyInfiniteResult();
	});

	it("shows an error, not the athlete-empty copy, when records fail to load", () => {
		mockQuery.result = {
			...emptyInfiniteResult(),
			isPending: false,
			isError: true,
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
			...emptyInfiniteResult(),
			data: [],
			isPending: false,
		};
		renderWithProviders(<RecordsTab unit="kg" />);
		expect(screen.getByText(/no personal records yet/i)).toBeInTheDocument();
		expect(
			screen.queryByText(/couldn't load personal records/i),
		).not.toBeInTheDocument();
	});

	it("offers the next history page in the grouped view", () => {
		mockQuery.result = {
			...emptyInfiniteResult(),
			data: [
				{
					id: "record-1",
					exercise_id: "exercise-1",
					exercise_name: "Bench Press",
					muscle_group: "Chest",
					value: 100,
					unit: "kg",
					record_type: "MAX_WEIGHT",
					achieved_at: new Date("2026-09-01T00:00:00Z"),
					workout_phase: null,
				},
			],
			isPending: false,
			hasNextPage: true,
		};
		renderWithProviders(<RecordsTab unit="kg" />);
		expect(
			screen.getByRole("button", { name: /load older records/i }),
		).toBeInTheDocument();
	});
});
