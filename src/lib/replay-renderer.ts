import type { TelemetryPointRow } from '@/schemas/telemetry';

interface RenderOptions {
  width: number;
  height: number;
  data: TelemetryPointRow[];
  currentTimeMs: number;
  repBoundaries: number[];
}

const MARGIN = { top: 20, right: 20, bottom: 40, left: 50 };
const BACKGROUND_COLOR = '#0D0D0D';
const EMBER_COLOR = '#FF6B35';
const REP_BAND_COLOR = 'rgba(255, 107, 53, 0.08)';
const PLAYHEAD_COLOR = 'rgba(255, 255, 255, 0.7)';

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
  maxTime: number
) {
  if (repBoundaries.length === 0 || maxTime === 0) return;

  const xScale = plotArea.width / maxTime;

  // Draw alternating bands for each rep
  for (let i = 0; i < repBoundaries.length; i++) {
    // Only shade odd-indexed reps for alternating pattern
    if (i % 2 === 1) {
      const startX = plotArea.x + repBoundaries[i - 1] * xScale;
      const endX = plotArea.x + repBoundaries[i] * xScale;
      ctx.fillStyle = REP_BAND_COLOR;
      ctx.fillRect(startX, plotArea.y, endX - startX, plotArea.height);
    }
  }
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  plotArea: ReturnType<typeof getPlotArea>,
  currentTimeMs: number,
  maxTime: number
) {
  if (maxTime === 0) return;

  const xScale = plotArea.width / maxTime;
  const x = plotArea.x + currentTimeMs * xScale;

  ctx.strokeStyle = PLAYHEAD_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, plotArea.y);
  ctx.lineTo(x, plotArea.y + plotArea.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function renderForceCurve(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions
): void {
  const { width, height, data, currentTimeMs, repBoundaries } = options;
  const plotArea = getPlotArea(width, height);

  // Clear canvas with dark background
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);

  if (data.length === 0) return;

  // Calculate scales
  const maxTime = Math.max(...data.map((d) => d.timestamp_ms));
  const maxForce = Math.max(...data.map((d) => d.force_n)) * 1.1;

  if (maxTime === 0 || maxForce === 0) return;

  const xScale = plotArea.width / maxTime;
  const yScale = plotArea.height / maxForce;

  // Draw rep background bands
  drawRepBands(ctx, plotArea, repBoundaries, maxTime);

  // Filter data up to currentTimeMs
  const visibleData = data.filter((d) => d.timestamp_ms <= currentTimeMs);

  if (visibleData.length === 0) {
    drawPlayhead(ctx, plotArea, currentTimeMs, maxTime);
    return;
  }

  // Build path points
  const points = visibleData.map((d) => ({
    x: plotArea.x + d.timestamp_ms * xScale,
    y: plotArea.y + plotArea.height - d.force_n * yScale,
  }));

  // Draw gradient fill under curve
  const gradient = ctx.createLinearGradient(0, plotArea.y, 0, plotArea.y + plotArea.height);
  gradient.addColorStop(0, 'rgba(255, 107, 53, 0.3)');
  gradient.addColorStop(1, 'transparent');

  ctx.beginPath();
  ctx.moveTo(points[0].x, plotArea.y + plotArea.height);
  points.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, plotArea.y + plotArea.height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw stroke line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = EMBER_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw playhead
  drawPlayhead(ctx, plotArea, currentTimeMs, maxTime);
}

export function renderVelocityBars(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions
): void {
  const { width, height, data, currentTimeMs, repBoundaries } = options;
  const plotArea = getPlotArea(width, height);

  // Clear canvas with dark background
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);

  if (data.length === 0) return;

  // Calculate scales
  const maxTime = Math.max(...data.map((d) => d.timestamp_ms));
  const maxVelocity = Math.max(...data.map((d) => d.velocity_mps)) * 1.1;

  if (maxTime === 0 || maxVelocity === 0) return;

  const xScale = plotArea.width / maxTime;
  const yScale = plotArea.height / maxVelocity;

  // Draw rep background bands
  drawRepBands(ctx, plotArea, repBoundaries, maxTime);

  // Filter data up to currentTimeMs
  const visibleData = data.filter((d) => d.timestamp_ms <= currentTimeMs);

  // Calculate bar width based on data density
  const barWidth = Math.max(1, (plotArea.width / data.length) * 0.8);

  // Draw velocity bars
  ctx.fillStyle = EMBER_COLOR;
  visibleData.forEach((d) => {
    const x = plotArea.x + d.timestamp_ms * xScale - barWidth / 2;
    const barHeight = d.velocity_mps * yScale;
    const y = plotArea.y + plotArea.height - barHeight;
    ctx.fillRect(x, y, barWidth, barHeight);
  });

  // Draw playhead
  drawPlayhead(ctx, plotArea, currentTimeMs, maxTime);
}
