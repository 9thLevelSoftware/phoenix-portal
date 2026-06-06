import type { RankingItem } from "@/app/components/CommunityRankings";
import { PHOENIX } from "@/lib/colors";
import { convertWeight, type WeightUnit } from "@/lib/units";
import type { UserRanking } from "@/queries/leaderboard";

export interface CommunityBenchmarkRow {
	id: string;
	metric_type: string;
	metric_key: string | null;
	percentile_values: unknown;
	total_users: number;
	updated_at: string | null;
}

interface BuildCommunityPercentileRankingsInput {
	benchmarks: CommunityBenchmarkRow[];
	userRankings: UserRanking[];
	unit: WeightUnit;
}

export interface CommunityAtlasUserStats {
	total_volume_kg: number | null;
	total_workouts: number | null;
	longest_streak: number | null;
	current_streak: number | null;
}

const METRIC_META: Record<
	string,
	{
		label: string;
		unit: string;
		color: string;
		aliases: string[];
		convertWeight?: boolean;
	}
> = {
	totalVolume: {
		label: "Total Volume",
		unit: "kg",
		color: PHOENIX.ember,
		aliases: ["totalvolume", "total_volume", "total_volume_kg", "volume"],
		convertWeight: true,
	},
	workoutCount: {
		label: "Workout Count",
		unit: "sessions",
		color: PHOENIX.gold,
		aliases: ["workoutcount", "workout_count", "total_workouts", "workouts"],
	},
	longestStreak: {
		label: "Longest Streak",
		unit: "days",
		color: PHOENIX.flameRed,
		aliases: ["longeststreak", "longest_streak", "best_streak"],
	},
	currentStreak: {
		label: "Current Streak",
		unit: "days",
		color: PHOENIX.forgeGreen,
		aliases: ["currentstreak", "current_streak"],
	},
	prCount: {
		label: "Phase PRs",
		unit: "PRs",
		color: PHOENIX.ashGray,
		aliases: ["prcount", "pr_count", "personal_records", "prs"],
	},
	exerciseMastery: {
		label: "Exercise Mastery",
		unit: "exercises",
		color: PHOENIX.flameYellow,
		aliases: ["exercisemastery", "exercise_mastery", "mastered_count"],
	},
};

const STAT_FIELD_BY_METRIC: Partial<
	Record<keyof typeof METRIC_META, keyof CommunityAtlasUserStats>
> = {
	totalVolume: "total_volume_kg",
	workoutCount: "total_workouts",
	longestStreak: "longest_streak",
	currentStreak: "current_streak",
};

function normalizeKey(value: string | null | undefined): string {
	return (value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizePercentiles(value: unknown): Record<string, number> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;

	const normalized: Record<string, number> = {};
	for (const [rawKey, rawValue] of Object.entries(value)) {
		const percentileMatch = rawKey.match(/^p?(\d{1,2})$/i);
		const numericValue =
			typeof rawValue === "number"
				? rawValue
				: typeof rawValue === "string" && rawValue.trim() !== ""
					? Number(rawValue)
					: Number.NaN;
		if (!percentileMatch || !Number.isFinite(numericValue)) continue;
		normalized[`p${percentileMatch[1]}`] = numericValue;
	}

	return Object.keys(normalized).length >= 2 ? normalized : null;
}

function findBenchmarkForMetric(
	benchmarks: CommunityBenchmarkRow[],
	metric: string,
): CommunityBenchmarkRow | undefined {
	const meta = METRIC_META[metric];
	const aliases = new Set([
		normalizeKey(metric),
		...(meta?.aliases ?? []).map(normalizeKey),
	]);

	return benchmarks.find((benchmark) => {
		const key = normalizeKey(benchmark.metric_key);
		const type = normalizeKey(benchmark.metric_type);
		return aliases.has(key) || aliases.has(type);
	});
}

function toTopPercent(percentile: number): number {
	if (!Number.isFinite(percentile)) return 100;
	return Math.max(1, Math.min(100, Math.round(100 - percentile)));
}

function estimatePercentileFromCutoffs(
	percentiles: Record<string, number>,
	value: number,
): number {
	const points = Object.entries(percentiles)
		.map(([key, cutoff]) => ({
			percentile: Number(key.replace(/^p/i, "")),
			cutoff,
		}))
		.filter(
			(point) =>
				Number.isFinite(point.percentile) && Number.isFinite(point.cutoff),
		)
		.sort((a, b) => a.cutoff - b.cutoff);

	if (points.length === 0) return 0;
	if (value <= points[0].cutoff) return points[0].percentile;
	const last = points[points.length - 1];
	if (value >= last.cutoff) return last.percentile;

	for (let index = 1; index < points.length; index += 1) {
		const lower = points[index - 1];
		const upper = points[index];
		if (value > upper.cutoff) continue;
		const range = upper.cutoff - lower.cutoff;
		if (range <= 0) return upper.percentile;
		const ratio = (value - lower.cutoff) / range;
		return lower.percentile + ratio * (upper.percentile - lower.percentile);
	}

	return last.percentile;
}

function convertPercentiles(
	percentiles: Record<string, number>,
	unit: WeightUnit,
	shouldConvert: boolean,
): Record<string, number> {
	if (!shouldConvert) return percentiles;
	return Object.fromEntries(
		Object.entries(percentiles).map(([key, value]) => [
			key,
			Math.round(convertWeight(value, unit) * 10) / 10,
		]),
	);
}

export function buildCommunityPercentileRankings({
	benchmarks,
	userRankings,
	unit,
}: BuildCommunityPercentileRankingsInput): RankingItem[] {
	return userRankings
		.map((ranking): RankingItem | null => {
			const meta = METRIC_META[ranking.metric];
			if (!meta) return null;

			const benchmark = findBenchmarkForMetric(benchmarks, ranking.metric);
			if (!benchmark) return null;

			const normalizedPercentiles = normalizePercentiles(
				benchmark.percentile_values,
			);
			if (!normalizedPercentiles) return null;

			const shouldConvert = meta.convertWeight === true;
			const displayValue = shouldConvert
				? Math.round(convertWeight(ranking.value, unit) * 10) / 10
				: ranking.value;

			return {
				label: meta.label,
				percentile: toTopPercent(ranking.percentile),
				value: displayValue,
				unit: shouldConvert ? unit : meta.unit,
				rank: ranking.rank,
				totalUsers: ranking.totalUsers || benchmark.total_users,
				color: meta.color,
				percentiles: convertPercentiles(
					normalizedPercentiles,
					unit,
					shouldConvert,
				),
			};
		})
		.filter((item): item is RankingItem => item !== null);
}

export function buildEstimatedCommunityPercentileRankings({
	benchmarks,
	userStats,
	unit,
}: {
	benchmarks: CommunityBenchmarkRow[];
	userStats: CommunityAtlasUserStats | null | undefined;
	unit: WeightUnit;
}): RankingItem[] {
	if (!userStats) return [];

	return Object.entries(STAT_FIELD_BY_METRIC)
		.map(([metric, statField]): RankingItem | null => {
			const meta = METRIC_META[metric];
			if (!meta) return null;

			const rawValue = userStats[statField];
			if (rawValue == null || !Number.isFinite(rawValue)) return null;

			const benchmark = findBenchmarkForMetric(benchmarks, metric);
			if (!benchmark) return null;

			const normalizedPercentiles = normalizePercentiles(
				benchmark.percentile_values,
			);
			if (!normalizedPercentiles) return null;

			const estimatedPercentile = estimatePercentileFromCutoffs(
				normalizedPercentiles,
				rawValue,
			);
			const topPercent = toTopPercent(estimatedPercentile);
			const shouldConvert = meta.convertWeight === true;
			const displayValue = shouldConvert
				? Math.round(convertWeight(rawValue, unit) * 10) / 10
				: rawValue;
			const totalUsers = benchmark.total_users;

			return {
				label: meta.label,
				percentile: topPercent,
				value: displayValue,
				unit: shouldConvert ? unit : meta.unit,
				rank: Math.max(1, Math.round((topPercent / 100) * totalUsers)),
				totalUsers,
				color: meta.color,
				percentiles: convertPercentiles(
					normalizedPercentiles,
					unit,
					shouldConvert,
				),
				estimated: true,
			};
		})
		.filter((item): item is RankingItem => item !== null);
}
