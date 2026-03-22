import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { useTooltip } from "@visx/tooltip";
import { bisector } from "@visx/vendor/d3-array";
import { useCallback } from "react";

import { PHOENIX } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataPoint {
	time: number;
	force: number;
	velocity: number;
}

interface TooltipPayload {
	force: number;
	velocity: number;
	zone: { name: string; color: string };
}

// ---------------------------------------------------------------------------
// Sample data — single bench press rep
// ---------------------------------------------------------------------------

const SAMPLE_DATA: DataPoint[] = [
	{ time: 0.0, force: 0, velocity: 0 },
	{ time: 0.2, force: 22, velocity: 0.35 },
	{ time: 0.4, force: 52, velocity: 0.72 },
	{ time: 0.6, force: 78, velocity: 0.95 },
	{ time: 0.8, force: 91, velocity: 1.08 },
	{ time: 1.0, force: 95, velocity: 0.88 },
	{ time: 1.2, force: 90, velocity: 0.52 },
	{ time: 1.5, force: 82, velocity: 0.15 },
	{ time: 1.8, force: 78, velocity: 0.08 },
	{ time: 2.0, force: 84, velocity: 0.32 },
	{ time: 2.3, force: 87, velocity: 0.55 },
	{ time: 2.6, force: 85, velocity: 0.48 },
	{ time: 3.0, force: 78, velocity: 0.32 },
	{ time: 3.3, force: 58, velocity: 0.22 },
	{ time: 3.6, force: 28, velocity: 0.12 },
	{ time: 3.8, force: 8, velocity: 0.05 },
	{ time: 4.0, force: 0, velocity: 0 },
];

// Phase divider — approximate transition from concentric to eccentric
const PHASE_DIVIDER_TIME = 1.8;

// ---------------------------------------------------------------------------
// Velocity zone classification (parity-critical with project spec)
// ---------------------------------------------------------------------------

function getVelocityZone(v: number): { name: string; color: string } {
	const abs = Math.abs(v);
	if (abs >= 1.0) return { name: "Explosive", color: PHOENIX.ember };
	if (abs >= 0.75) return { name: "Fast", color: PHOENIX.gold };
	if (abs >= 0.5) return { name: "Moderate", color: PHOENIX.forgeGreen };
	if (abs >= 0.25) return { name: "Slow", color: PHOENIX.ashGray };
	return { name: "Grind", color: PHOENIX.moltenSteel };
}

// ---------------------------------------------------------------------------
// Chart margins & accessors
// ---------------------------------------------------------------------------

const MARGINS = { top: 16, right: 16, bottom: 36, left: 44 };

const getTime = (d: DataPoint) => d.time;
const getForce = (d: DataPoint) => d.force;

const bisectTime = bisector<DataPoint, number>((d) => d.time).left;

// ---------------------------------------------------------------------------
// Axis style constants
// ---------------------------------------------------------------------------

const AXIS_TEXT_COLOR = "#9CA3AF";
const GRID_LINE_COLOR = "#1A1A2E";
const AXIS_FONT_SIZE = 10;
const LABEL_FONT_SIZE = 11;

// ---------------------------------------------------------------------------
// Inner Chart component (exported for testing)
// ---------------------------------------------------------------------------

export function Chart({ width, height }: { width: number; height: number }) {
	const {
		showTooltip,
		hideTooltip,
		tooltipData,
		tooltipLeft,
		tooltipTop,
		tooltipOpen,
	} = useTooltip<TooltipPayload>();

	const innerWidth = width - MARGINS.left - MARGINS.right;
	const innerHeight = height - MARGINS.top - MARGINS.bottom;

	const xScale = scaleLinear({
		domain: [0, 4],
		range: [0, innerWidth],
	});

	const yScale = scaleLinear({
		domain: [0, 110],
		range: [innerHeight, 0],
		nice: true,
	});

	const handleMouseMove = useCallback(
		(event: React.MouseEvent<SVGSVGElement>) => {
			const point = localPoint(event);
			if (!point) return;

			const x0 = xScale.invert(point.x - MARGINS.left);
			const idx = bisectTime(SAMPLE_DATA, x0, 1);
			const d0 = SAMPLE_DATA[idx - 1];
			const d1 = SAMPLE_DATA[idx];

			let nearest = d0;
			if (d1 && d0) {
				nearest = x0 - d0.time > d1.time - x0 ? d1 : d0;
			}

			if (nearest) {
				const zone = getVelocityZone(nearest.velocity);
				showTooltip({
					tooltipData: {
						force: nearest.force,
						velocity: nearest.velocity,
						zone,
					},
					tooltipLeft: xScale(nearest.time) + MARGINS.left,
					tooltipTop: yScale(nearest.force) + MARGINS.top,
				});
			}
		},
		[xScale, yScale, showTooltip],
	);

	const phaseDividerX = xScale(PHASE_DIVIDER_TIME);

	return (
		<div style={{ position: "relative" }}>
			<svg
				width={width}
				height={height}
				role="img"
				aria-label="Force curve chart for a single cable bench press rep"
				onMouseMove={handleMouseMove}
				onMouseLeave={() => hideTooltip()}
			>
				<LinearGradient
					id="force-area-gradient"
					from={PHOENIX.ember}
					to={PHOENIX.ember}
					fromOpacity={0.25}
					toOpacity={0}
					vertical
				/>

				<Group left={MARGINS.left} top={MARGINS.top}>
					{/* Area fill under force curve */}
					<AreaClosed
						data={SAMPLE_DATA}
						x={(d) => xScale(getTime(d))}
						y={(d) => yScale(getForce(d))}
						yScale={yScale}
						curve={curveMonotoneX}
						fill="url(#force-area-gradient)"
					/>

					{/* Force line */}
					<LinePath
						data={SAMPLE_DATA}
						x={(d) => xScale(getTime(d))}
						y={(d) => yScale(getForce(d))}
						curve={curveMonotoneX}
						stroke={PHOENIX.ember}
						strokeWidth={2}
					/>

					{/* Phase divider */}
					<line
						x1={phaseDividerX}
						y1={0}
						x2={phaseDividerX}
						y2={innerHeight}
						stroke="rgba(255, 255, 255, 0.08)"
						strokeDasharray="4 4"
					/>

					{/* Crosshair + indicator circle on hover */}
					{tooltipOpen &&
						tooltipData &&
						tooltipLeft != null &&
						tooltipTop != null && (
							<>
								<line
									x1={tooltipLeft - MARGINS.left}
									y1={0}
									x2={tooltipLeft - MARGINS.left}
									y2={innerHeight}
									stroke="rgba(255, 255, 255, 0.2)"
									strokeWidth={1}
									pointerEvents="none"
								/>
								<circle
									cx={tooltipLeft - MARGINS.left}
									cy={tooltipTop - MARGINS.top}
									r={4}
									fill={PHOENIX.ember}
									stroke={PHOENIX.white}
									strokeWidth={1.5}
									pointerEvents="none"
								/>
							</>
						)}

					{/* Axes */}
					<AxisLeft
						scale={yScale}
						numTicks={5}
						label="Force (kg)"
						labelProps={{
							fill: AXIS_TEXT_COLOR,
							fontSize: LABEL_FONT_SIZE,
							textAnchor: "middle",
						}}
						tickLabelProps={{
							fill: AXIS_TEXT_COLOR,
							fontSize: AXIS_FONT_SIZE,
							textAnchor: "end",
							dx: -4,
						}}
						stroke={GRID_LINE_COLOR}
						tickStroke={GRID_LINE_COLOR}
					/>
					<AxisBottom
						top={innerHeight}
						scale={xScale}
						numTicks={5}
						label="Time (s)"
						labelProps={{
							fill: AXIS_TEXT_COLOR,
							fontSize: LABEL_FONT_SIZE,
							textAnchor: "middle",
						}}
						tickLabelProps={{
							fill: AXIS_TEXT_COLOR,
							fontSize: AXIS_FONT_SIZE,
							textAnchor: "middle",
						}}
						stroke={GRID_LINE_COLOR}
						tickStroke={GRID_LINE_COLOR}
					/>
				</Group>
			</svg>

			{/* Tooltip card */}
			{tooltipOpen &&
				tooltipData &&
				tooltipLeft != null &&
				tooltipTop != null && (
					<div
						style={{
							position: "absolute",
							top: tooltipTop - 60,
							left: tooltipLeft + 12,
							backgroundColor: "#1A1A2E",
							border: "1px solid #2D2D44",
							borderRadius: 6,
							padding: "6px 10px",
							fontSize: 12,
							lineHeight: 1.4,
							color: "#fff",
							pointerEvents: "none",
							boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
							whiteSpace: "nowrap",
						}}
					>
						<div style={{ fontWeight: 500, color: AXIS_TEXT_COLOR }}>
							{tooltipData.force} kg &middot; {tooltipData.velocity.toFixed(2)}{" "}
							m/s
						</div>
						<div
							style={{
								fontWeight: 600,
								color: tooltipData.zone.color,
								marginTop: 2,
							}}
						>
							{tooltipData.zone.name}
						</div>
					</div>
				)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Outer wrapper component
// ---------------------------------------------------------------------------

const CHART_HEIGHT = 220;

export function ForceCurveDemo() {
	return (
		<div className="rounded-lg border border-white/[0.06] bg-surface-2 p-3">
			{/* Header */}
			<div className="mb-2">
				<span className="eyebrow text-primary">LIVE DEMO</span>
				<h3 className="mt-1 text-sm font-medium text-foreground">
					Cable bench press &mdash; single rep
				</h3>
				<p className="text-xs text-muted-foreground">Hover to explore</p>
			</div>

			{/* Chart */}
			<div style={{ height: CHART_HEIGHT }}>
				<ParentSize>
					{({ width }) => {
						if (width <= 0) {
							// Fallback for SSR / test environments where container has no width
							return <Chart width={400} height={CHART_HEIGHT} />;
						}
						return <Chart width={width} height={CHART_HEIGHT} />;
					}}
				</ParentSize>
			</div>

			{/* Phase labels */}
			<div className="mt-1 flex justify-between px-11 text-[10px] text-muted-foreground">
				<span>Concentric</span>
				<span>Eccentric</span>
			</div>

			{/* Explanatory copy */}
			<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
				Force output and velocity zones from a single Vitruvian rep. Every rep
				is captured at millisecond resolution so you can analyze concentric vs
				eccentric phases.
			</p>
		</div>
	);
}
