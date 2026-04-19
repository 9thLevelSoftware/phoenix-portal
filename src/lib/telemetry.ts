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
	if (raw.length <= targetPoints) return raw;

	const downsample = metric === "force" ? forceLTTB : velocityLTTB;
	return downsample(raw, targetPoints) as TelemetryPoint[];
}

/**
 * Normalize rep timestamps to 0-100 range for overlay comparisons.
 */
export function normalizeRepTime(
	points: TelemetryPoint[],
): (TelemetryPoint & { normalizedTime: number })[] {
	if (points.length === 0) return [];

	const minTime = points[0].timestamp_ms;
	const maxTime = points[points.length - 1].timestamp_ms;
	const duration = maxTime - minTime;

	if (duration === 0) {
		return points.map((p) => ({ ...p, normalizedTime: 0 }));
	}

	return points.map((p) => ({
		...p,
		normalizedTime: ((p.timestamp_ms - minTime) / duration) * 100,
	}));
}
