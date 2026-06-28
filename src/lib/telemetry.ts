import { createLTTB } from "downsample";

export interface TelemetryPoint {
	timestamp_ms: number;
	force_n: number;
	velocity_mps: number;
	position_mm: number;
	/**
	 * Canonical cable identifier from BLE (A = left actuator, B = right).
	 * Mobile is authoritative for BLE-captured data per monorepo CLAUDE.md.
	 * For UI display use `cableDisplayName()` from `src/lib/telemetry-display.ts`.
	 * Resolves audit item #4 (2026-04-19).
	 */
	cable: "A" | "B";
}

// Typed LTTB downsamplers for different metrics
const forceLTTB = createLTTB({
	x: "timestamp_ms" as const,
	y: "force_n" as const,
});

const velocityLTTB = createLTTB({
	x: "timestamp_ms" as const,
	y: "velocity_mps" as const,
});

/**
 * Downsample telemetry data using LTTB algorithm.
 * Reduces 3000+ points to targetPoints without losing curve shape.
 */
export function downsampleTelemetry(
	raw: TelemetryPoint[],
	metric: "force" | "velocity",
	targetPoints = 750,
): TelemetryPoint[] {
	// LTTB requires at least 3 target points (it always keeps the first and last
	// and selects buckets in between). Guard against 0/1/2, negative, and
	// non-finite values which would throw or return unusable data.
	if (!Number.isFinite(targetPoints) || targetPoints < 3) {
		return raw;
	}
	if (raw.length <= targetPoints) return raw;

	const downsample = metric === "force" ? forceLTTB : velocityLTTB;
	return downsample(raw, Math.floor(targetPoints)) as TelemetryPoint[];
}

/**
 * Normalize rep timestamps to 0-100 range for overlay comparisons.
 */
export function normalizeRepTime(
	points: TelemetryPoint[],
): (TelemetryPoint & { normalizedTime: number })[] {
	if (points.length === 0) return [];

	// Do not assume the input is sorted by timestamp: compute min/max across all
	// points so unsorted telemetry cannot produce negative or >100 values.
	let minTime = points[0].timestamp_ms;
	let maxTime = points[0].timestamp_ms;
	for (const p of points) {
		if (p.timestamp_ms < minTime) minTime = p.timestamp_ms;
		if (p.timestamp_ms > maxTime) maxTime = p.timestamp_ms;
	}
	const duration = maxTime - minTime;

	if (duration === 0) {
		return points.map((p) => ({ ...p, normalizedTime: 0 }));
	}

	return points.map((p) => ({
		...p,
		normalizedTime: ((p.timestamp_ms - minTime) / duration) * 100,
	}));
}
