import type { TelemetryPointRow } from "@/schemas/telemetry";
import type { ReplayIntelligence } from "./replay-intelligence";
import { getThemeTokens, type ThemeTokens, withAlpha } from "./theme-tokens";

interface RenderOptions {
	width: number;
	height: number;
	data: TelemetryPointRow[];
	currentTimeMs: number;
	repBoundaries: number[];
	intelligence?: ReplayIntelligence | null;
	/** Theme snapshot; defaults to the active theme. */
	tokens?: ThemeTokens;
}

const MARGIN = { top: 20, right: 20, bottom: 40, left: 50 };

function getPlotArea(width: number, height: number) {
	return {
		x: MARGIN.left,
		y: MARGIN.top,
		width: width - MARGIN.left - MARGIN.right,
		height: height - MARGIN.top - MARGIN.bottom,
	};
}

function drawRepBands(
	ctx: CanvasRenderingContext2D,
	plotArea: ReturnType<typeof getPlotArea>,
	repBoundaries: number[],
	maxTime: number,
	{ cableA }: ThemeTokens,
) {
	if (repBoundaries.length === 0 || maxTime === 0) return;

	const xScale = plotArea.width / maxTime;

	for (let i = 0; i < repBoundaries.length; i++) {
		if (i % 2 === 1) {
			const startX = plotArea.x + repBoundaries[i - 1] * xScale;
			const endX = plotArea.x + repBoundaries[i] * xScale;
			ctx.fillStyle = withAlpha(cableA, 0.08);
			ctx.fillRect(startX, plotArea.y, endX - startX, plotArea.height);
		}
	}
}

function drawPlayhead(
	ctx: CanvasRenderingContext2D,
	plotArea: ReturnType<typeof getPlotArea>,
	currentTimeMs: number,
	maxTime: number,
	{ foreground }: ThemeTokens,
) {
	if (maxTime === 0) return;

	const xScale = plotArea.width / maxTime;
	const x = plotArea.x + currentTimeMs * xScale;

	ctx.strokeStyle = withAlpha(foreground, 0.7);
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 4]);
	ctx.beginPath();
	ctx.moveTo(x, plotArea.y);
	ctx.lineTo(x, plotArea.y + plotArea.height);
	ctx.stroke();
	ctx.setLineDash([]);
}

function drawReplayIntelligence(
	ctx: CanvasRenderingContext2D,
	plotArea: ReturnType<typeof getPlotArea>,
	intelligence: ReplayIntelligence | null | undefined,
	maxTime: number,
	currentTimeMs: number,
	{ danger, accent }: ThemeTokens,
) {
	if (!intelligence || intelligence.status === "empty" || maxTime === 0) return;

	const xScale = plotArea.width / maxTime;
	const clampTime = (timestampMs: number) =>
		Math.max(0, Math.min(timestampMs, maxTime));

	for (const rep of intelligence.repInsights) {
		if (rep.velocityLossPct < 20) continue;
		const startX = plotArea.x + clampTime(rep.startMs) * xScale;
		const endX = plotArea.x + clampTime(rep.endMs) * xScale;
		if (endX <= startX) continue;
		ctx.fillStyle = withAlpha(danger, 0.08);
		ctx.fillRect(startX, plotArea.y, endX - startX, plotArea.height);
	}

	for (const point of intelligence.stickingPoints) {
		if (point.timestampMs > currentTimeMs) continue;
		const x = plotArea.x + clampTime(point.timestampMs) * xScale;
		ctx.fillStyle = accent;
		ctx.beginPath();
		ctx.arc(x, plotArea.y + 12, 4, 0, Math.PI * 2);
		ctx.fill();
	}
}

export function renderForceCurve(
	ctx: CanvasRenderingContext2D,
	options: RenderOptions,
): void {
	const { width, height, data, currentTimeMs, repBoundaries, intelligence } =
		options;
	const plotArea = getPlotArea(width, height);
	// Resolved once per frame and handed to the helpers.
	const tokens = options.tokens ?? getThemeTokens();
	const { background, primary } = tokens;

	ctx.fillStyle = background;
	ctx.fillRect(0, 0, width, height);

	if (data.length === 0) return;

	const maxTime = Math.max(...data.map((d) => d.timestamp_ms));
	const maxForce = Math.max(...data.map((d) => d.force_n)) * 1.1;

	if (maxTime === 0 || maxForce === 0) return;

	const xScale = plotArea.width / maxTime;
	const yScale = plotArea.height / maxForce;

	drawRepBands(ctx, plotArea, repBoundaries, maxTime, tokens);
	drawReplayIntelligence(
		ctx,
		plotArea,
		intelligence,
		maxTime,
		currentTimeMs,
		tokens,
	);

	const visibleData = data.filter((d) => d.timestamp_ms <= currentTimeMs);

	if (visibleData.length === 0) {
		drawPlayhead(ctx, plotArea, currentTimeMs, maxTime, tokens);
		return;
	}

	const points = visibleData.map((d) => ({
		x: plotArea.x + d.timestamp_ms * xScale,
		y: plotArea.y + plotArea.height - d.force_n * yScale,
	}));

	const gradient = ctx.createLinearGradient(
		0,
		plotArea.y,
		0,
		plotArea.y + plotArea.height,
	);
	gradient.addColorStop(0, withAlpha(primary, 0.3));
	gradient.addColorStop(1, "transparent");

	ctx.beginPath();
	ctx.moveTo(points[0].x, plotArea.y + plotArea.height);
	points.forEach((p) => {
		ctx.lineTo(p.x, p.y);
	});
	ctx.lineTo(points[points.length - 1].x, plotArea.y + plotArea.height);
	ctx.closePath();
	ctx.fillStyle = gradient;
	ctx.fill();

	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	points.slice(1).forEach((p) => {
		ctx.lineTo(p.x, p.y);
	});
	ctx.strokeStyle = primary;
	ctx.lineWidth = 2;
	ctx.stroke();

	drawPlayhead(ctx, plotArea, currentTimeMs, maxTime, tokens);
}

export function renderVelocityBars(
	ctx: CanvasRenderingContext2D,
	options: RenderOptions,
): void {
	const { width, height, data, currentTimeMs, repBoundaries, intelligence } =
		options;
	const plotArea = getPlotArea(width, height);
	// Resolved once per frame and handed to the helpers.
	const tokens = options.tokens ?? getThemeTokens();
	const { background, primary } = tokens;

	ctx.fillStyle = background;
	ctx.fillRect(0, 0, width, height);

	if (data.length === 0) return;

	const maxTime = Math.max(...data.map((d) => d.timestamp_ms));
	const maxVelocity = Math.max(...data.map((d) => d.velocity_mps)) * 1.1;

	if (maxTime === 0 || maxVelocity === 0) return;

	const xScale = plotArea.width / maxTime;
	const yScale = plotArea.height / maxVelocity;

	drawRepBands(ctx, plotArea, repBoundaries, maxTime, tokens);
	drawReplayIntelligence(
		ctx,
		plotArea,
		intelligence,
		maxTime,
		currentTimeMs,
		tokens,
	);

	const visibleData = data.filter((d) => d.timestamp_ms <= currentTimeMs);

	if (visibleData.length === 0) {
		drawPlayhead(ctx, plotArea, currentTimeMs, maxTime, tokens);
		return;
	}

	const points = visibleData.map((d) => ({
		x: plotArea.x + d.timestamp_ms * xScale,
		y: plotArea.y + plotArea.height - d.velocity_mps * yScale,
	}));

	const gradient = ctx.createLinearGradient(
		0,
		plotArea.y,
		0,
		plotArea.y + plotArea.height,
	);
	gradient.addColorStop(0, withAlpha(primary, 0.2));
	gradient.addColorStop(1, "transparent");

	ctx.beginPath();
	ctx.moveTo(points[0].x, plotArea.y + plotArea.height);
	points.forEach((p) => {
		ctx.lineTo(p.x, p.y);
	});
	ctx.lineTo(points[points.length - 1].x, plotArea.y + plotArea.height);
	ctx.closePath();
	ctx.fillStyle = gradient;
	ctx.fill();

	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	points.slice(1).forEach((p) => {
		ctx.lineTo(p.x, p.y);
	});
	ctx.strokeStyle = primary;
	ctx.lineWidth = 2;
	ctx.stroke();

	drawPlayhead(ctx, plotArea, currentTimeMs, maxTime, tokens);
}
