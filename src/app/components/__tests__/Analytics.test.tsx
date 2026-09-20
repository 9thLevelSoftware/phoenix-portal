import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import { Analytics, toWeeklyVolumeSeries } from "../Analytics";

const mockAuth = vi.hoisted(() => ({
	useAuth: () => ({
		user: { id: "test-user-id", email: "test@example.com" },
		session: { user: { id: "test-user-id" }, access_token: "test-token" },
		loading: false,
		signOut: () => Promise.resolve(),
	}),
}));

const mockQuery = vi.hoisted(() => ({
	mode: "pending" as "pending" | "error" | "empty",
}));

vi.mock("@/app/hooks/useAuth", () => mockAuth);
vi.mock("@/providers/AuthProvider", () => mockAuth);
vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: () => {
			if (mockQuery.mode === "pending") {
				return {
					data: undefined,
					isPending: true,
					isFetching: false,
					isError: false,
					error: null,
					dataUpdatedAt: 0,
					refetch: () => Promise.resolve(),
				};
			}
			if (mockQuery.mode === "error") {
				return {
					data: undefined,
					isPending: false,
					isFetching: false,
					isError: true,
					error: new Error("analytics failed"),
					dataUpdatedAt: 0,
					refetch: () => Promise.resolve(),
				};
			}
			return {
				data: undefined,
				isPending: false,
				isFetching: false,
				isError: false,
				error: null,
				dataUpdatedAt: Date.now(),
				refetch: () => Promise.resolve(),
			};
		},
	};
});

describe("Analytics", () => {
	beforeEach(() => {
		mockQuery.mode = "pending";
	});

	it("renders without crashing", () => {
		const { container } = renderWithProviders(<Analytics />);
		expect(container.firstChild).toBeTruthy();
	});

	it("shows an error, not the athlete-empty copy, when analytics queries fail", () => {
		mockQuery.mode = "error";
		renderWithProviders(<Analytics />);
		expect(
			screen.getAllByText(/couldn't load analytics/i).length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByRole("button", { name: /retry/i }).length,
		).toBeGreaterThan(0);
		expect(screen.queryByText(/your analytics await/i)).not.toBeInTheDocument();
	});

	it("shows the empty state only after a successful zero-row fetch", () => {
		mockQuery.mode = "empty";
		renderWithProviders(<Analytics />);
		expect(screen.getAllByText(/your analytics await/i).length).toBeGreaterThan(
			0,
		);
		expect(
			screen.queryByText(/couldn't load analytics/i),
		).not.toBeInTheDocument();
	});
});

describe("toWeeklyVolumeSeries", () => {
	it("keys weeks by week_start so the same week in different years stays split", () => {
		// The previous client-side bucketing keyed weeks by a "Mar 2"-style label,
		// which silently merged the same calendar week across years on "ALL".
		const series = toWeeklyVolumeSeries(
			[
				{ week_start: "2025-03-03", sessions: 2, total_volume: 1000 },
				{ week_start: "2026-03-02", sessions: 3, total_volume: 1500 },
			],
			"all",
		);

		expect(series).toHaveLength(2);
		expect(series.map((row) => row.key)).toEqual(["2025-03-03", "2026-03-02"]);
		expect(new Set(series.map((row) => row.date)).size).toBe(2);
		expect(series[0].volume).toBe(1000);
		expect(series[0].workouts).toBe(2);
	});

	it("labels the week start as a local calendar day", () => {
		const [row] = toWeeklyVolumeSeries(
			[{ week_start: "2026-03-02", sessions: 1, total_volume: 10 }],
			"4w",
		);
		// "2026-03-02" must not slip to Mar 1 in negative-offset zones.
		expect(row.date).toBe("Mar 2");
	});
});
