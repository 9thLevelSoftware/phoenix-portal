import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, Line, LinePath } from "@visx/shape";
import { Text } from "@visx/text";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { useMemo } from "react";
import type { RepSummary } from "@/schemas/telemetry";
import { CHART_COLORS, CHART_MARGINS } from "./shared/ChartTheme";

// -- Types --
export interface RomTrendProps {
	repSummaries: RepSummary[];
	height?: number;
	showAverage?: boolean;
}

interface RomPoint {
	rep: number;
	rom: number;
}

interface TooltipData {
	rep: number;
	rom: number;
	deviation: number;
}

const GRADIENT_ID = "rom-area-gradient";
const LINE_COLOR = CHART_COLORS.secondary; // Gold
const AVG_LINE_COLOR = CHART_COLORS.axisText;

// -- Main Chart --
function RomChart({
	data,
	average,
	showAverage,
	width,
	height,
}: {
	data: RomPoint[];
	average: number;
	showAverage: boolean;
	width: number;
	height: number;
}) {
	const {
		tooltipOpen,
		tooltipData,
		tooltipLeft,
		tooltipTop,
		showTooltip,
		hideTooltip,
	} = useTooltip<TooltipData>();

	const margin = { ...CHART_MARGINS, right: 30 };
	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	const romValues = data.map((d) => d.rom);
	const minRom = Math.min(...romValues);
	const maxRom = Math.max(...romValues);

	const xScale = useMemo(
		() =>
			scaleLinear<number>({
				domain: [1, data.length],
				range: [0, innerWidth],
			}),
		[data.length, innerWidth],
	);

	const yScale = useMemo(
		() =>
			scaleLinear<number>({
				domain: [minRom * 0.9, maxRom * 1.1],
				range: [innerHeight, 0],
				nice: true,
			}),
		[minRom, maxRom, innerHeight],
	);

	const getX = (d: RomPoint) => xScale(d.rep);
	const getY = (d: RomPoint) => yScale(d.rom);

	return (
		<>
			<svg width={width} height={height}>
				<LinearGradient
					id={GRADIENT_ID}
					from={LINE_COLOR}
					to={LINE_COLOR}
					fromOpacity={0.3}
					toOpacity={0.02}
				/>

				<Group left={margin.left} top={margin.top}>
					{/* Area fill */}
					<AreaClosed<RomPoint>
						data={data}
						x={getX}
						y={getY}
						yScale={yScale}
						curve={curveMonotoneX}
						fill={`url(#${GRADIENT_ID})`}
					/>

					{/* Line */}
					<LinePath<RomPoint>
						data={data}
						x={getX}
						y={getY}
						curve={curveMonotoneX}
						stroke={LINE_COLOR}
						strokeWidth={2}
					/>

					{/* Average line */}
					{showAverage && (
						<>
							<Line
								from={{ x: 0, y: yScale(average) }}
								to={{ x: innerWidth, y: yScale(average) }}
								stroke={AVG_LINE_COLOR}
								strokeWidth={1}
								strokeDasharray="6,4"
								opacity={0.7}
							/>
							<Text
								x={innerWidth + 4}
								y={yScale(average)}
								fill={AVG_LINE_COLOR}
								fontSize={10}
								verticalAnchor="middle"
								fontFamily="system-ui"
							>
								Avg: {average.toFixed(0)}mm
							</Text>
						</>
					)}

					{/* Data point circles + invisible hit areas */}
					{data.map((d) => (
						<circle
							key={d.rep}
							cx={getX(d)}
							cy={getY(d)}
							r={4}
							fill={LINE_COLOR}
							stroke={CHART_COLORS.background}
							strokeWidth={1.5}
							style={{ cursor: "pointer" }}
							onMouseMove={(e) => {
								const point = localPoint(e);
								showTooltip({
									tooltipData: {
										rep: d.rep,
										rom: d.rom,
										deviation: d.rom - average,
									},
									tooltipLeft: (point?.x ?? 0) + margin.left,
									tooltipTop: (point?.y ?? 0) + margin.top,
								});
							}}
							onMouseLeave={hideTooltip}
						/>
					))}

					{/* Axes */}
					<AxisBottom
						top={innerHeight}
						scale={xScale}
						numTicks={Math.min(data.length, 10)}
						tickFormat={(v) => `${v as number}`}
						label="Rep"
						labelProps={{
							fill: CHART_COLORS.axisText,
							fontSize: 11,
							textAnchor: "middle" as const,
							fontFamily: "system-ui",
						}}
						stroke={CHART_COLORS.axisText}
						tickStroke={CHART_COLORS.axisText}
						tickLabelProps={() => ({
							fill: CHART_COLORS.axisText,
							fontSize: 10,
							textAnchor: "middle" as const,
							fontFamily: "system-ui",
						})}
					/>
					<AxisLeft
						scale={yScale}
						numTicks={5}
						tickFormat={(v) => `${v as number}`}
						label="ROM (mm)"
						labelProps={{
							fill: CHART_COLORS.axisText,
							fontSize: 11,
							textAnchor: "middle" as const,
							fontFamily: "system-ui",
						}}
						stroke={CHART_COLORS.axisText}
						tickStroke={CHART_COLORS.axisText}
						tickLabelProps={() => ({
							fill: CHART_COLORS.axisText,
							fontSize: 10,
							textAnchor: "end" as const,
							fontFamily: "system-ui",
							dx: -4,
						})}
					/>
				</Group>
			</svg>

			{/* Tooltip */}
			{tooltipOpen && tooltipData && (
				<TooltipWithBounds
					left={tooltipLeft}
					top={tooltipTop}
					style={{
						background: CHART_COLORS.tooltipBg,
						color: "#FFFFFF",
						border: `1px solid ${CHART_COLORS.tooltipBorder}`,
						borderRadius: 6,
						padding: "8px 12px",
						fontSize: 12,
						fontFamily: "system-ui",
						lineHeight: 1.5,
						boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
					}}
				>
					<div style={{ fontWeight: 600, marginBottom: 4 }}>
						Rep {tooltipData.rep}
					</div>
					<div>ROM: {tooltipData.rom.toFixed(1)} mm</div>
					<div
						style={{
							color:
								tooltipData.deviation >= 0
									? CHART_COLORS.success
									: CHART_COLORS.danger,
						}}
					>
						{tooltipData.deviation >= 0 ? "+" : ""}
						{tooltipData.deviation.toFixed(1)} mm from avg
					</div>
				</TooltipWithBounds>
			)}
		</>
	);
}

// -- Exported Component --
export function RomTrend({
	repSummaries,
	height = 250,
	showAverage = true,
}: RomTrendProps) {
	if (!repSummaries || repSummaries.length === 0) {
		return (
			<div
				className="flex items-center justify-center text-sm"
				style={{ height, color: CHART_COLORS.axisText }}
			>
				No ROM data available
			</div>
		);
	}

	const data: RomPoint[] = repSummaries.map((rep, i) => ({
		rep: rep.rep_number ?? i + 1,
		rom: rep.rom_mm,
	}));

	const average = data.reduce((sum, d) => sum + d.rom, 0) / data.length;

	return (
		<div style={{ position: "relative", height }}>
			<ParentSize>
				{({ width }) =>
					width > 0 ? (
						<RomChart
							data={data}
							average={average}
							showAverage={showAverage}
							width={width}
							height={height}
						/>
					) : null
				}
			</ParentSize>
		</div>
	);
}
