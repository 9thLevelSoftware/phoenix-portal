import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/test-utils";
import {
	Analytics,
	buildLocalInsights,
	selectInsightsFeed,
	toWeeklyVolumeSeries,
} from "../Analytics";
import { InsightsFeed, LOCAL_INSIGHTS_LABEL } from "../InsightsFeed";

const bodyMapLoader = vi.hoisted(() => ({
	loadBodyMuscleAnalytics: vi.fn(),
}));
vi.mock("@/lib/body-muscle-analytics-loader", () => bodyMapLoader);

function renderAnalyticsAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<QueryClientProvider client={new QueryClient()}>
				<Analytics />
			</QueryClientProvider>
		</MemoryRouter>,
	);
}

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
		bodyMapLoader.loadBodyMuscleAnalytics.mockReset();
		bodyMapLoader.loadBodyMuscleAnalytics.mockResolvedValue({
			buildBodyMuscleFocusModel: vi.fn(() => ({
				muscles: [],
				muscleById: {},
				totalSets: 0,
				totalReps: 0,
				totalVolumeKg: 0,
				totalLoad: 0,
				estimatedExerciseCount: 0,
				unmatchedExerciseCount: 0,
			})),
		});
	});

	it("does not download the body-muscle map outside the Body tab", async () => {
		renderAnalyticsAt("/analytics?tab=overview");
		// Give any effect a chance to run.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(bodyMapLoader.loadBodyMuscleAnalytics).not.toHaveBeenCalled();
	});

	it("downloads the body-muscle map when the Body tab is open", async () => {
		renderAnalyticsAt("/analytics?tab=body");
		await waitFor(() =>
			expect(bodyMapLoader.loadBodyMuscleAnalytics).toHaveBeenCalledTimes(1),
		);
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

// KD-14: the feed is a fresh server batch OR the browser fallback, never a
// mix. `selectInsightsFeed` is the whole rule; these tests render its output
// so "shows only X" is asserted against the DOM, not just the array.
describe("Analytics insights precedence", () => {
	const NOW = Date.parse("2026-09-20T12:00:00.000Z");
	const FRESH = "2026-09-21T12:00:00.000Z";
	const EXPIRED = "2026-09-19T12:00:00.000Z";

	const serverRow = (title: string, expires_at: string | null) => ({
		id: `server-${title}`,
		title,
		description: `${title} description`,
		insight_type: "success",
		expires_at,
	});

	const localInsights = [
		{
			type: "warning" as const,
			title: "Local Volume Drop",
			description: "local description",
		},
		{
			type: "positive" as const,
			title: "Local Balanced Training",
			description: "local description 2",
		},
	];

	function renderFeed(serverRows: unknown) {
		const { items, source } = selectInsightsFeed(
			serverRows,
			localInsights,
			"kg",
			NOW,
		);
		render(<InsightsFeed insights={items} source={source} />);
		return { items, source };
	}

	it("renders only the server items when a non-expired batch exists", () => {
		const { items, source } = renderFeed([
			serverRow("Server Volume Up", FRESH),
			serverRow("Server Plateau", FRESH),
		]);

		expect(source).toBe("server");
		expect(items).toHaveLength(2);
		expect(screen.getByText("Server Volume Up")).toBeInTheDocument();
		expect(screen.getByText("Server Plateau")).toBeInTheDocument();
		expect(screen.queryByText("Local Volume Drop")).not.toBeInTheDocument();
		expect(
			screen.queryByText("Local Balanced Training"),
		).not.toBeInTheDocument();
		expect(screen.queryByText(LOCAL_INSIGHTS_LABEL)).not.toBeInTheDocument();
		// Server items keep the server row's id, so nothing is duplicated.
		expect(items.map((i) => i.id)).toEqual([
			"server-Server Volume Up",
			"server-Server Plateau",
		]);
	});

	it("renders only the labelled local items when every server row has expired", () => {
		const { source } = renderFeed([
			serverRow("Server Volume Up", EXPIRED),
			serverRow("Server Plateau", null),
		]);

		expect(source).toBe("local");
		expect(screen.getByText("Local Volume Drop")).toBeInTheDocument();
		expect(screen.getByText("Local Balanced Training")).toBeInTheDocument();
		expect(screen.queryByText("Server Volume Up")).not.toBeInTheDocument();
		expect(screen.queryByText("Server Plateau")).not.toBeInTheDocument();
		expect(screen.getByText(LOCAL_INSIGHTS_LABEL)).toBeInTheDocument();
	});

	it("renders local items for an empty or missing result", () => {
		const empty = renderFeed([]);
		expect(empty.source).toBe("local");
		expect(screen.getByText("Local Volume Drop")).toBeInTheDocument();
		expect(screen.getByText(LOCAL_INSIGHTS_LABEL)).toBeInTheDocument();

		expect(selectInsightsFeed(undefined, localInsights, "kg", NOW).source).toBe(
			"local",
		);
		expect(selectInsightsFeed(null, localInsights, "kg", NOW).source).toBe(
			"local",
		);
	});

	it("never interleaves the two sources, so no title is listed twice", () => {
		// Same title on both sides: the mixed rendering would show it twice.
		const shared = [
			{
				type: "warning" as const,
				title: "Volume Trending Down",
				description: "local",
			},
		];
		const rows = [
			{
				id: "server-1",
				title: "Volume Trending Down",
				description: "server",
				insight_type: "warning",
				expires_at: FRESH,
			},
		];
		const { items } = selectInsightsFeed(rows, shared, "kg", NOW);
		render(<InsightsFeed insights={items} source="server" />);

		expect(items).toHaveLength(1);
		expect(screen.getAllByText("Volume Trending Down")).toHaveLength(1);
		expect(screen.getByText("server")).toBeInTheDocument();
		expect(screen.queryByText("local")).not.toBeInTheDocument();
	});

	it("drops only the expired rows when a batch is partially fresh", () => {
		const { items, source } = renderFeed([
			serverRow("Server Fresh", FRESH),
			serverRow("Server Stale", EXPIRED),
		]);
		expect(source).toBe("server");
		expect(items).toHaveLength(1);
		expect(screen.getByText("Server Fresh")).toBeInTheDocument();
		expect(screen.queryByText("Server Stale")).not.toBeInTheDocument();
		expect(screen.queryByText("Local Volume Drop")).not.toBeInTheDocument();
	});
});

// NF-38: the browser fallback runs the shared rule engine, so it fires at the
// engine's thresholds (volume drop below -15%), not the old inline -20%.
describe("buildLocalInsights uses the shared rule engine", () => {
	const rows = (volumes: number[]) =>
		volumes.map((total_volume) => ({ total_volume }));

	it("flags a 17% volume drop that the old inline -20% rule missed", () => {
		const insights = buildLocalInsights(
			{ current: rows([83]), previous: rows([100]) },
			28,
			[],
			"kg",
		);
		expect(insights.map((i) => i.title)).toContain("Volume Trending Down");
		expect(insights.find((i) => i.title === "Volume Trending Down")?.type).toBe(
			"warning",
		);
	});

	it("reports the engine's per-group imbalance warning", () => {
		const insights = buildLocalInsights(
			{ current: rows([100, 100, 100]), previous: rows([100, 100, 100]) },
			7,
			[
				{ name: "Chest", value: 70 },
				{ name: "Legs", value: 10 },
			],
			"kg",
		);
		expect(insights.map((i) => i.title)).toContain("Legs Training Imbalance");
	});

	it("never renders an empty card", () => {
		expect(buildLocalInsights(undefined, 28, [], "kg")).toEqual([
			expect.objectContaining({ title: "Building Your Profile" }),
		]);
		expect(
			buildLocalInsights(
				{ current: rows([100, 100, 100]), previous: rows([100, 100, 100]) },
				7,
				[],
				"kg",
			).map((i) => i.title),
		).toEqual(["Nothing Needs Attention"]);
	});
});
