export interface PhaseStatisticsTrendRow {
	concentric_kg_avg: number | null;
	concentric_kg_max: number | null;
	concentric_vel_avg: number | null;
	concentric_vel_max: number | null;
	concentric_watt_avg: number | null;
	concentric_watt_max: number | null;
	eccentric_kg_avg: number | null;
	eccentric_kg_max: number | null;
	eccentric_vel_avg: number | null;
	eccentric_vel_max: number | null;
	eccentric_watt_avg: number | null;
	eccentric_watt_max: number | null;
}

export interface PhaseMetricPair {
	concentricAvg: number;
	concentricMax: number;
	eccentricAvg: number;
	eccentricMax: number;
}

export interface PhaseMetricSummary {
	load: PhaseMetricPair;
	velocity: PhaseMetricPair;
	power: PhaseMetricPair;
	rowCount: number;
}

interface MetricKeys {
	concentricAvg: keyof PhaseStatisticsTrendRow;
	concentricMax: keyof PhaseStatisticsTrendRow;
	eccentricAvg: keyof PhaseStatisticsTrendRow;
	eccentricMax: keyof PhaseStatisticsTrendRow;
}

function roundMetric(value: number): number {
	return Math.round(value * 100) / 100;
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return roundMetric(
		values.reduce((sum, value) => sum + value, 0) / values.length,
	);
}

function max(values: number[]): number {
	if (values.length === 0) return 0;
	return roundMetric(Math.max(...values));
}

function numbersFor(
	rows: PhaseStatisticsTrendRow[],
	key: keyof PhaseStatisticsTrendRow,
): number[] {
	return rows
		.map((row) => row[key])
		.filter((value): value is number => typeof value === "number");
}

function summarizeMetric(
	rows: PhaseStatisticsTrendRow[],
	keys: MetricKeys,
): PhaseMetricPair {
	return {
		concentricAvg: average(numbersFor(rows, keys.concentricAvg)),
		concentricMax: max(numbersFor(rows, keys.concentricMax)),
		eccentricAvg: average(numbersFor(rows, keys.eccentricAvg)),
		eccentricMax: max(numbersFor(rows, keys.eccentricMax)),
	};
}

export function buildPhaseMetricSummary(
	rows: PhaseStatisticsTrendRow[],
): PhaseMetricSummary {
	return {
		load: summarizeMetric(rows, {
			concentricAvg: "concentric_kg_avg",
			concentricMax: "concentric_kg_max",
			eccentricAvg: "eccentric_kg_avg",
			eccentricMax: "eccentric_kg_max",
		}),
		velocity: summarizeMetric(rows, {
			concentricAvg: "concentric_vel_avg",
			concentricMax: "concentric_vel_max",
			eccentricAvg: "eccentric_vel_avg",
			eccentricMax: "eccentric_vel_max",
		}),
		power: summarizeMetric(rows, {
			concentricAvg: "concentric_watt_avg",
			concentricMax: "concentric_watt_max",
			eccentricAvg: "eccentric_watt_avg",
			eccentricMax: "eccentric_watt_max",
		}),
		rowCount: rows.length,
	};
}
