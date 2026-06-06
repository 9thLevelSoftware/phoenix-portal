import type { RepSummary, TelemetryPointRow } from "@/schemas/telemetry";

export interface ReplayStickingPoint {
	repNumber: number;
	timestampMs: number;
	positionMm: number;
	velocityMps: number;
	forceN: number;
}

export interface ReplayRepInsight {
	repNumber: number;
	startMs: number;
	endMs: number;
	meanVelocityMps: number;
	peakVelocityMps: number;
	peakForceN: number;
	velocityLossPct: number;
	consistencyPct: number;
	stickingPoint: ReplayStickingPoint | null;
}

export interface ReplayIntelligenceInput {
	telemetry: TelemetryPointRow[];
	repSummaries: RepSummary[];
	repBoundaries: number[];
}

export interface ReplayIntelligence {
	status: "empty" | "partial" | "ready";
	partialReason: string | null;
	repCount: number;
	repInsights: ReplayRepInsight[];
	stickingPoints: ReplayStickingPoint[];
	velocityLossPct: number;
	fatigueSlopePctPerRep: number;
	repConsistencyPct: number;
	forcePeakN: number;
	durationMs: number;
}

function round(value: number, digits = 1): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
	if (values.length < 2) return 0;
	const avg = mean(values);
	const variance = mean(values.map((value) => (value - avg) ** 2));
	return Math.sqrt(variance);
}

function getRepWindow(
	index: number,
	repBoundaries: number[],
	telemetry: TelemetryPointRow[],
	repSummaries: RepSummary[],
): { startMs: number; endMs: number } {
	const startMs =
		repBoundaries[index] ??
		repSummaries
			.slice(0, index)
			.reduce((sum, rep) => sum + rep.tut_ms + 500, 0);
	const maxTelemetryMs =
		telemetry.length > 0
			? Math.max(...telemetry.map((point) => point.timestamp_ms))
			: startMs + (repSummaries[index]?.tut_ms ?? 0);
	const endMs =
		repBoundaries[index + 1] ??
		Math.max(startMs + (repSummaries[index]?.tut_ms ?? 0), maxTelemetryMs);
	return { startMs, endMs };
}

function findStickingPoint(
	rep: RepSummary,
	points: TelemetryPointRow[],
): ReplayStickingPoint | null {
	if (points.length === 0 || rep.mean_velocity_mps <= 0) return null;

	const velocityThreshold = rep.mean_velocity_mps * 0.45;
	const forceThreshold = rep.peak_force_n * 0.9;
	const candidates = points.filter(
		(point) =>
			point.velocity_mps <= velocityThreshold &&
			point.force_n >= forceThreshold,
	);

	if (candidates.length === 0) return null;

	const point = [...candidates].sort((a, b) => {
		const forceDelta = b.force_n - a.force_n;
		if (forceDelta !== 0) return forceDelta;
		return a.velocity_mps - b.velocity_mps;
	})[0];

	return {
		repNumber: rep.rep_number,
		timestampMs: point.timestamp_ms,
		positionMm: point.position_mm,
		velocityMps: point.velocity_mps,
		forceN: point.force_n,
	};
}

export function buildReplayIntelligence({
	telemetry,
	repSummaries,
	repBoundaries,
}: ReplayIntelligenceInput): ReplayIntelligence {
	if (repSummaries.length === 0 && telemetry.length === 0) {
		return {
			status: "empty",
			partialReason: null,
			repCount: 0,
			repInsights: [],
			stickingPoints: [],
			velocityLossPct: 0,
			fatigueSlopePctPerRep: 0,
			repConsistencyPct: 0,
			forcePeakN: 0,
			durationMs: 0,
		};
	}

	const velocities = repSummaries.map((rep) => rep.mean_velocity_mps);
	const firstVelocity = velocities[0] ?? 0;
	const lastVelocity = velocities[velocities.length - 1] ?? firstVelocity;
	const velocityLossPct =
		firstVelocity > 0
			? ((firstVelocity - lastVelocity) / firstVelocity) * 100
			: 0;
	const fatigueSlopePctPerRep =
		firstVelocity > 0 && velocities.length > 1
			? ((lastVelocity - firstVelocity) /
					(velocities.length - 1) /
					firstVelocity) *
				100
			: 0;
	const avgVelocity = mean(velocities);
	const repConsistencyPct =
		avgVelocity > 0
			? Math.max(
					0,
					Math.min(
						100,
						100 - (standardDeviation(velocities) / avgVelocity) * 100,
					),
				)
			: 0;
	const forcePeakN = Math.max(
		0,
		...repSummaries.map((rep) => rep.peak_force_n),
		...telemetry.map((point) => point.force_n),
	);
	const durationMs =
		telemetry.length > 0
			? Math.max(...telemetry.map((point) => point.timestamp_ms))
			: repSummaries.reduce((sum, rep) => sum + rep.tut_ms, 0);

	const repInsights = repSummaries.map((rep, index): ReplayRepInsight => {
		const { startMs, endMs } = getRepWindow(
			index,
			repBoundaries,
			telemetry,
			repSummaries,
		);
		const points = telemetry.filter(
			(point) => point.timestamp_ms >= startMs && point.timestamp_ms < endMs,
		);
		const stickingPoint = findStickingPoint(rep, points);
		const lossFromFirst =
			firstVelocity > 0
				? ((firstVelocity - rep.mean_velocity_mps) / firstVelocity) * 100
				: 0;

		return {
			repNumber: rep.rep_number,
			startMs,
			endMs,
			meanVelocityMps: rep.mean_velocity_mps,
			peakVelocityMps: rep.peak_velocity_mps,
			peakForceN: rep.peak_force_n,
			velocityLossPct: round(Math.max(0, lossFromFirst), 1),
			consistencyPct: round(repConsistencyPct, 1),
			stickingPoint,
		};
	});

	const stickingPoints = repInsights
		.map((rep) => rep.stickingPoint)
		.filter((point): point is ReplayStickingPoint => point !== null);
	const hasSummariesWithoutTelemetry =
		repSummaries.length > 0 && telemetry.length < repSummaries.length * 2;

	return {
		status: hasSummariesWithoutTelemetry ? "partial" : "ready",
		partialReason: hasSummariesWithoutTelemetry
			? "Using rep summaries because telemetry samples are incomplete."
			: null,
		repCount: repSummaries.length,
		repInsights,
		stickingPoints,
		velocityLossPct: round(Math.max(0, velocityLossPct), 1),
		fatigueSlopePctPerRep: round(fatigueSlopePctPerRep, 1),
		repConsistencyPct: round(repConsistencyPct, 1),
		forcePeakN,
		durationMs,
	};
}
