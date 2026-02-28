import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { bisector } from "@visx/vendor/d3-array";
import { useCallback, useMemo } from "react";

import {
	downsampleTelemetry,
	normalizeRepTime,
	type TelemetryPoint,
} from "@/lib/telemetry";
import {
	CHART_COLORS,
	CHART_MARGINS,
	FONT_SIZES,
	REP_COLORS,
} from "./shared/ChartTheme";
import { ChartTooltipContent, useChartTooltip } from "./shared/ChartTooltip";

interface RepData {
	repNumber: number;
	points: TelemetryPoint[];
}

export interface ForceCurveProps {
	repData: RepData[];
	width?: number;
	height?: number;
	normalized?: boolean;
	showTooltip?: boolean;
	selectedRep?: number | null;
}

/** Processed rep data after downsampling and optional normalization */
interface ProcessedRep {
	repNumber: number;
	points: Array<{ x: number; force_n: number }>;
	colorIndex: number;
}

const bisectX = bisector<{ x: number; force_n: number }, number>(
	(d) => d.x,
).left;

function ForceCurveInner({
	repData,
	width,
	height = 300,
	normalized = false,
	showTooltip: showTooltipProp = true,
	selectedRep = null,
}: ForceCurveProps & { width: number }) {
	const {
		showTooltip,
		hideTooltip,
		tooltipData,
		tooltipLeft,
		tooltipTop,
		tooltipOpen,
	} = useChartTooltip();

	const margins = CHART_MARGINS;

	// Downsample and optionally normalize each rep
	const processedReps: ProcessedRep[] = useMemo(() => {
		return repData.map((rep, index) => {
			const downsampled = downsampleTelemetry(rep.points, "force", 750);

			if (normalized) {
				const normalizedPoints = normalizeRepTime(downsampled);
				return {
					repNumber: rep.repNumber,
					points: normalizedPoints.map((p) => ({
						x: p.normalizedTime,
						force_n: p.force_n,
					})),
					colorIndex: index,
				};
			}

			return {
				repNumber: rep.repNumber,
				points: downsampled.map((p) => ({
					x: p.timestamp_ms,
					force_n: p.force_n,
				})),
				colorIndex: index,
			};
		});
	}, [repData, normalized]);

	// Compute axis scales
	const xScale = useMemo(() => {
		if (normalized) {
			return scaleLinear({
				domain: [0, 100],
				range: [margins.left, width - margins.right],
			});
		}

		const allX = processedReps.flatMap((r) => r.points.map((p) => p.x));
		const maxX = allX.length > 0 ? Math.max(...allX) : 1;

		return scaleLinear({
			domain: [0, maxX],
			range: [margins.left, width - margins.right],
		});
	}, [processedReps, normalized, width]);

	const yScale = useMemo(() => {
		const allForce = processedReps.flatMap((r) =>
			r.points.map((p) => p.force_n),
		);
		const maxForce = allForce.length > 0 ? Math.max(...allForce) : 1;

		return scaleLinear({
			domain: [0, maxForce * 1.1],
			range: [height - margins.bottom, margins.top],
			nice: true,
		});
	}, [processedReps, height]);

	// Tooltip handler: find nearest point across all reps
	const handleMouseMove = useCallback(
		(event: React.MouseEvent<SVGSVGElement>) => {
			if (!showTooltipProp) return;

			const point = localPoint(event);
			if (!point) return;

			const x0 = xScale.invert(point.x);
			let closestRep: ProcessedRep | null = null;
			let closestPoint: { x: number; force_n: number } | null = null;
			let closestDist = Infinity;

			for (const rep of processedReps) {
				if (rep.points.length === 0) continue;

				const idx = bisectX(rep.points, x0, 1);
				const d0 = rep.points[idx - 1];
				const d1 = rep.points[idx];

				let nearest = d0;
				if (d1 && d0) {
					nearest = x0 - d0.x > d1.x - x0 ? d1 : d0;
				}

				if (nearest) {
					const dist = Math.abs(nearest.x - x0);
					if (dist < closestDist) {
						closestDist = dist;
						closestRep = rep;
						closestPoint = nearest;
					}
				}
			}

			if (closestRep && closestPoint) {
				const xLabel = normalized ? "Time (%)" : "Time (ms)";
				showTooltip({
					tooltipData: {
						label: `Rep ${closestRep.repNumber} · ${xLabel}: ${Math.round(closestPoint.x)}`,
						value: `${closestPoint.force_n.toFixed(1)} N`,
						color: REP_COLORS[closestRep.colorIndex % REP_COLORS.length],
					},
					tooltipLeft: xScale(closestPoint.x),
					tooltipTop: yScale(closestPoint.force_n),
				});
			}
		},
		[processedReps, xScale, yScale, showTooltipProp, normalized, showTooltip],
	);

	const getX = (d: { x: number }) => d.x;
	const getY = (d: { force_n: number }) => d.force_n;

	return (
		<div style={{ position: "relative" }}>
			<svg
				width={width}
				height={height}
				onMouseMove={handleMouseMove}
				onMouseLeave={() => hideTooltip()}
			>
				{/* Gradient definitions for each rep */}
				{processedReps.map((rep) => {
					const color = REP_COLORS[rep.colorIndex % REP_COLORS.length];
					return (
						<LinearGradient
							key={`gradient-${rep.repNumber}`}
							id={`force-gradient-${rep.repNumber}`}
							from={color}
							to={color}
							fromOpacity={0.3}
							toOpacity={0}
							vertical
						/>
					);
				})}

				{/* Render each rep: area fill + line stroke */}
				{processedReps.map((rep) => {
					const color = REP_COLORS[rep.colorIndex % REP_COLORS.length];
					const isSelected =
						selectedRep === null || selectedRep === rep.repNumber;
					const opacity = isSelected ? 1 : 0.2;

					return (
						<g key={`rep-${rep.repNumber}`} opacity={opacity}>
							<AreaClosed
								data={rep.points}
								x={(d) => xScale(getX(d)) ?? 0}
								y={(d) => yScale(getY(d)) ?? 0}
								yScale={yScale}
								curve={curveMonotoneX}
								fill={`url(#force-gradient-${rep.repNumber})`}
								shapeRendering="optimizeSpeed"
							/>
							<LinePath
								data={rep.points}
								x={(d) => xScale(getX(d)) ?? 0}
								y={(d) => yScale(getY(d)) ?? 0}
								curve={curveMonotoneX}
								stroke={color}
								strokeWidth={2}
								shapeRendering="optimizeSpeed"
							/>
						</g>
					);
				})}

				{/* Axes */}
				<AxisBottom
					top={height - margins.bottom}
					scale={xScale}
					label={normalized ? "Time (%)" : "Time (ms)"}
					labelProps={{
						fill: CHART_COLORS.axisText,
						fontSize: FONT_SIZES.label,
						textAnchor: "middle",
					}}
					tickLabelProps={{
						fill: CHART_COLORS.axisText,
						fontSize: FONT_SIZES.axis,
						textAnchor: "middle",
					}}
					stroke={CHART_COLORS.gridLine}
					tickStroke={CHART_COLORS.gridLine}
				/>
				<AxisLeft
					left={margins.left}
					scale={yScale}
					label="Force (N)"
					labelProps={{
						fill: CHART_COLORS.axisText,
						fontSize: FONT_SIZES.label,
						textAnchor: "middle",
					}}
					tickLabelProps={{
						fill: CHART_COLORS.axisText,
						fontSize: FONT_SIZES.axis,
						textAnchor: "end",
					}}
					stroke={CHART_COLORS.gridLine}
					tickStroke={CHART_COLORS.gridLine}
				/>
			</svg>

			{/* Tooltip */}
			{tooltipOpen &&
				tooltipData &&
				tooltipLeft != null &&
				tooltipTop != null && (
					<ChartTooltipContent
						data={tooltipData}
						left={tooltipLeft}
						top={tooltipTop}
					/>
				)}
		</div>
	);
}

/**
 * Per-rep force curve visualization with gradient fill, smooth interpolation,
 * and optional multi-rep overlay. Uses LTTB downsampling for performance
 * and ParentSize for responsive sizing.
 */
export function ForceCurve(props: ForceCurveProps) {
	const repCount = props.repData.length;
	const peakForces = props.repData.map((rep) =>
		rep.points.length > 0
			? Math.max(...rep.points.map((p) => p.force_n))
			: 0,
	);
	const maxForce = peakForces.length > 0 ? Math.max(...peakForces) : 0;

	return (
		<div
			role="img"
			aria-label={`Force curve chart showing ${repCount} rep${repCount !== 1 ? "s" : ""}. Peak force: ${maxForce.toFixed(0)} Newtons.`}
		>
			<div aria-hidden="true">
				{props.width ? (
					<ForceCurveInner {...props} width={props.width} />
				) : (
					<ParentSize>
						{({ width }) => {
							if (width <= 0) return null;
							return <ForceCurveInner {...props} width={width} />;
						}}
					</ParentSize>
				)}
			</div>
			<table className="sr-only">
				<caption>Force curve data by rep</caption>
				<thead>
					<tr>
						<th>Rep</th>
						<th>Peak Force (N)</th>
					</tr>
				</thead>
				<tbody>
					{props.repData.map((rep, i) => (
						<tr key={rep.repNumber}>
							<td>Rep {rep.repNumber}</td>
							<td>{peakForces[i]?.toFixed(1)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
