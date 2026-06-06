import { describe, expect, it, vi } from "vitest";
import type { ReplayIntelligence } from "@/lib/replay-intelligence";
import { renderForceCurve } from "@/lib/replay-renderer";
import type { TelemetryPointRow } from "@/schemas/telemetry";

function createRecordingContext() {
	const fillRects: Array<[number, number, number, number]> = [];
	const arcs: Array<[number, number, number, number, number]> = [];
	const context = {
		beginPath: vi.fn(),
		closePath: vi.fn(),
		createLinearGradient: vi.fn().mockReturnValue({
			addColorStop: vi.fn(),
		}),
		fill: vi.fn(),
		fillRect: vi.fn((x: number, y: number, width: number, height: number) => {
			fillRects.push([x, y, width, height]);
		}),
		lineTo: vi.fn(),
		moveTo: vi.fn(),
		stroke: vi.fn(),
		setLineDash: vi.fn(),
		arc: vi.fn(
			(x: number, y: number, radius: number, start: number, end: number) => {
				arcs.push([x, y, radius, start, end]);
			},
		),
		fillStyle: "",
		lineWidth: 1,
		strokeStyle: "",
	};

	return {
		context: context as unknown as CanvasRenderingContext2D,
		fillRects,
		arcs,
	};
}

const data: TelemetryPointRow[] = [
	{
		timestamp_ms: 0,
		force_n: 100,
		velocity_mps: 0.4,
		position_mm: 0,
		cable: "A",
	},
	{
		timestamp_ms: 1000,
		force_n: 200,
		velocity_mps: 0.5,
		position_mm: 300,
		cable: "A",
	},
];

const intelligence: ReplayIntelligence = {
	status: "ready",
	partialReason: null,
	repCount: 1,
	repInsights: [
		{
			repNumber: 1,
			startMs: 0,
			endMs: 2000,
			meanVelocityMps: 0.4,
			peakVelocityMps: 0.5,
			peakForceN: 200,
			velocityLossPct: 20,
			consistencyPct: 90,
			stickingPoint: null,
		},
	],
	stickingPoints: [
		{
			repNumber: 1,
			timestampMs: 2000,
			positionMm: 200,
			velocityMps: 0.1,
			forceN: 200,
		},
	],
	velocityLossPct: 20,
	fatigueSlopePctPerRep: 0,
	repConsistencyPct: 90,
	forcePeakN: 200,
	durationMs: 2000,
};

describe("renderForceCurve", () => {
	it("clamps replay intelligence highlights to the plot width", () => {
		const { context, fillRects, arcs } = createRecordingContext();

		renderForceCurve(context, {
			width: 200,
			height: 120,
			data,
			currentTimeMs: 2000,
			repBoundaries: [],
			intelligence,
		});

		expect(fillRects[1]).toEqual([50, 20, 130, 60]);
		expect(arcs[0]?.[0]).toBe(180);
	});
});
