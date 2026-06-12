import type { RepSummary, TelemetryPointRow } from "@/schemas/telemetry";

export type ReplayPhase = "concentric" | "eccentric";
export type ReplayPhaseAnalyticsStatus = "empty" | "partial" | "ready";

export interface ReplayPhaseSegment {
	phase: ReplayPhase;
	startMs: number;
	endMs: number;
	startPositionMm: number;
	endPositionMm: number;
	deltaMm: number;
	avgForceN: number;
	avgVelocityMps: number;
	energyJ: number;
	repNumber: number | null;
}

export interface ReplayEnergySummary {
	totalEnergyJ: number;
	concentricEnergyJ: number;
	eccentricEnergyJ: number;
	concentricSharePct: number;
	eccentricSharePct: number;
	segmentCount: number;
}

export interface ReplayPhaseAnalytics {
	status: ReplayPhaseAnalyticsStatus;
	partialReason: string | null;
	segments: ReplayPhaseSegment[];
	summary: ReplayEnergySummary;
}

export interface ReplayPhaseAnalyticsInput {
	telemetry: TelemetryPointRow[];
	repSummaries: RepSummary[];
	repBoundaries: number[];
}

interface TimestampSample {
	timestampMs: number;
	forceN: number;
	velocityMps: number;
	positionMm: number;
}

const MIN_POSITION_DELTA_MM = 1;

function round(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupTelemetryByTimestamp(
	telemetry: TelemetryPointRow[],
): TimestampSample[] {
	const grouped = new Map<number, TelemetryPointRow[]>();
	for (const point of telemetry) {
		const rows = grouped.get(point.timestamp_ms) ?? [];
		rows.push(point);
		grouped.set(point.timestamp_ms, rows);
	}

	return [...grouped.entries()]
		.map(([timestampMs, rows]) => ({
			timestampMs,
			forceN: rows.reduce((sum, row) => sum + row.force_n, 0),
			velocityMps: mean(rows.map((row) => row.velocity_mps)),
			positionMm: mean(rows.map((row) => row.position_mm)),
		}))
		.sort((a, b) => a.timestampMs - b.timestampMs);
}

function repNumberForTimestamp(
	timestampMs: number,
	repBoundaries: number[],
	repSummaries: RepSummary[],
): number | null {
	if (repBoundaries.length === 0 || repSummaries.length === 0) return null;
	let index = 0;
	for (let i = 0; i < repBoundaries.length; i++) {
		if (timestampMs >= repBoundaries[i]) index = i;
	}
	return repSummaries[index]?.rep_number ?? index + 1;
}

function emptySummary(): ReplayEnergySummary {
	return {
		totalEnergyJ: 0,
		concentricEnergyJ: 0,
		eccentricEnergyJ: 0,
		concentricSharePct: 0,
		eccentricSharePct: 0,
		segmentCount: 0,
	};
}

export function buildReplayPhaseAnalytics({
	telemetry,
	repSummaries,
	repBoundaries,
}: ReplayPhaseAnalyticsInput): ReplayPhaseAnalytics {
	if (telemetry.length === 0) {
		return {
			status: repSummaries.length > 0 ? "partial" : "empty",
			partialReason:
				repSummaries.length > 0
					? "Dense position telemetry is unavailable for phase analytics."
					: null,
			segments: [],
			summary: emptySummary(),
		};
	}

	const samples = groupTelemetryByTimestamp(telemetry);
	const segments: ReplayPhaseSegment[] = [];

	let lastProcessed = samples[0];
	for (let index = 1; index < samples.length; index++) {
		const current = samples[index];
		const deltaMm = current.positionMm - lastProcessed.positionMm;
		if (Math.abs(deltaMm) < MIN_POSITION_DELTA_MM) continue;

		const avgForceN = mean([lastProcessed.forceN, current.forceN]);
		const avgVelocityMps = mean([
			lastProcessed.velocityMps,
			current.velocityMps,
		]);
		const energyJ = avgForceN * (Math.abs(deltaMm) / 1000);

		segments.push({
			phase: deltaMm > 0 ? "concentric" : "eccentric",
			startMs: lastProcessed.timestampMs,
			endMs: current.timestampMs,
			startPositionMm: round(lastProcessed.positionMm, 1),
			endPositionMm: round(current.positionMm, 1),
			deltaMm: round(deltaMm, 1),
			avgForceN: round(avgForceN, 1),
			avgVelocityMps: round(avgVelocityMps, 3),
			energyJ: round(energyJ, 2),
			repNumber: repNumberForTimestamp(
				lastProcessed.timestampMs,
				repBoundaries,
				repSummaries,
			),
		});
		lastProcessed = current;
	}

	const concentricEnergyJ = segments
		.filter((segment) => segment.phase === "concentric")
		.reduce((sum, segment) => sum + segment.energyJ, 0);
	const eccentricEnergyJ = segments
		.filter((segment) => segment.phase === "eccentric")
		.reduce((sum, segment) => sum + segment.energyJ, 0);
	const totalEnergyJ = concentricEnergyJ + eccentricEnergyJ;
	const hasLowDensityTelemetry =
		repSummaries.length > 0 && samples.length < repSummaries.length * 2;

	return {
		status: hasLowDensityTelemetry
			? "partial"
			: segments.length > 0
				? "ready"
				: "empty",
		partialReason: hasLowDensityTelemetry
			? "Telemetry density is too low to fully segment every rep."
			: null,
		segments,
		summary: {
			totalEnergyJ: round(totalEnergyJ, 2),
			concentricEnergyJ: round(concentricEnergyJ, 2),
			eccentricEnergyJ: round(eccentricEnergyJ, 2),
			concentricSharePct:
				totalEnergyJ > 0
					? round((concentricEnergyJ / totalEnergyJ) * 100, 1)
					: 0,
			eccentricSharePct:
				totalEnergyJ > 0
					? round((eccentricEnergyJ / totalEnergyJ) * 100, 1)
					: 0,
			segmentCount: segments.length,
		},
	};
}
