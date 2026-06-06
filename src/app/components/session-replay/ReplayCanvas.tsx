import { useEffect, useRef } from "react";
import type { ReplayIntelligence } from "@/lib/replay-intelligence";
import { renderForceCurve, renderVelocityBars } from "@/lib/replay-renderer";
import type { TelemetryPointRow } from "@/schemas/telemetry";
import { useReplayStore } from "@/stores/useReplayStore";

interface ReplayCanvasProps {
	data: TelemetryPointRow[];
	repBoundaries: number[];
	width: number;
	height: number;
	intelligence?: ReplayIntelligence | null;
}

export function ReplayCanvas({
	data,
	repBoundaries,
	width,
	height,
	intelligence,
}: ReplayCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const currentTimeMs = useReplayStore((state) => state.currentTimeMs);
	const activeChart = useReplayStore((state) => state.activeChart);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Handle high-DPI displays
		const dpr = window.devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.scale(dpr, dpr);

		// Render based on active chart type
		const renderOptions = {
			width,
			height,
			data,
			currentTimeMs,
			repBoundaries,
			intelligence,
		};

		if (activeChart === "force") {
			renderForceCurve(ctx, renderOptions);
		} else {
			renderVelocityBars(ctx, renderOptions);
		}
	}, [
		data,
		currentTimeMs,
		width,
		height,
		activeChart,
		repBoundaries,
		intelligence,
	]);

	return (
		<canvas
			ref={canvasRef}
			className="rounded-lg"
			style={{ width, height }}
			role="img"
			aria-label="Session replay visualization chart"
		/>
	);
}
