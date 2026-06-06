import { describe, expect, it } from "vitest";
import {
	buildCommunityPercentileRankings,
	buildEstimatedCommunityPercentileRankings,
	type CommunityBenchmarkRow,
} from "@/lib/community-atlas";
import type { UserRanking } from "@/queries/leaderboard";

const benchmarks: CommunityBenchmarkRow[] = [
	{
		id: "bench-volume",
		metric_type: "leaderboard",
		metric_key: "total_volume_kg",
		percentile_values: { p10: 1000, p50: 8000, p90: 20000 },
		total_users: 50,
		updated_at: "2026-06-01T00:00:00Z",
	},
	{
		id: "bench-workouts",
		metric_type: "leaderboard",
		metric_key: "workout_count",
		percentile_values: { "10": 2, "50": 12, "90": 35 },
		total_users: 48,
		updated_at: "2026-06-01T00:00:00Z",
	},
	{
		id: "bench-bad",
		metric_type: "leaderboard",
		metric_key: "malformed",
		percentile_values: { p50: "not-a-number" },
		total_users: 48,
		updated_at: "2026-06-01T00:00:00Z",
	},
];

const rankings: UserRanking[] = [
	{
		metric: "totalVolume",
		rank: 4,
		value: 18_500,
		percentile: 92,
		totalUsers: 50,
	},
	{
		metric: "workoutCount",
		rank: 10,
		value: 28,
		percentile: 81,
		totalUsers: 48,
	},
];

describe("buildCommunityPercentileRankings", () => {
	it("maps benchmark rows and user rankings into Top X% cards", () => {
		const cards = buildCommunityPercentileRankings({
			benchmarks,
			userRankings: rankings,
			unit: "kg",
		});

		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({
			label: "Total Volume",
			percentile: 8,
			value: 18500,
			unit: "kg",
			rank: 4,
			totalUsers: 50,
			percentiles: { p10: 1000, p50: 8000, p90: 20000 },
		});
		expect(cards[1]).toMatchObject({
			label: "Workout Count",
			percentile: 19,
			unit: "sessions",
		});
	});

	it("skips malformed benchmark payloads without dropping valid rankings", () => {
		const cards = buildCommunityPercentileRankings({
			benchmarks,
			userRankings: [
				...rankings,
				{
					metric: "malformed",
					rank: 1,
					value: 1,
					percentile: 99,
					totalUsers: 48,
				},
			],
			unit: "kg",
		});

		expect(cards.map((card) => card.label)).toEqual([
			"Total Volume",
			"Workout Count",
		]);
	});
});

describe("buildEstimatedCommunityPercentileRankings", () => {
	it("estimates Top X% cards from benchmark cutoffs and owner stats", () => {
		const cards = buildEstimatedCommunityPercentileRankings({
			benchmarks,
			userStats: {
				total_volume_kg: 18_500,
				total_workouts: 28,
				longest_streak: null,
				current_streak: null,
			},
			unit: "kg",
		});

		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({
			label: "Total Volume",
			estimated: true,
			unit: "kg",
			value: 18500,
			totalUsers: 50,
		});
		expect(cards[0].percentile).toBeGreaterThan(1);
		expect(cards[0].percentile).toBeLessThan(20);
		expect(cards[1]).toMatchObject({
			label: "Workout Count",
			estimated: true,
			unit: "sessions",
		});
	});
});
