import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { useMemo } from "react";
import { calculatePower } from "@/lib/biomechanics";
import type { RepSummary } from "@/schemas/telemetry";
import { CHART_COLORS, CHART_MARGINS, FONT_SIZES } from "./shared/ChartTheme";
import { ChartTooltipContent, useChartTooltip } from "./shared/ChartTooltip";

export interface PowerOutputProps {
	repSummaries: RepSummary[];
	height?: number;
	highlightPeak?: boolean;
}

interface PowerRep {
	repNumber: number;
	watts: number;
	force: number;
	velocity: number;
}

function PowerOutputInner({
	repSummaries,
	height = 250,
	highlightPeak = true,
	width,
}: PowerOutputProps & { width: number }) {
	const {
		showTooltip,
		hideTooltip,
		tooltipData,
		tooltipLeft,
		tooltipTop,
		tooltipOpen,
	} = useChartTooltip();

	const margin = CHART_MARGINS;
	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	const powerData = useMemo<PowerRep[]>(
		() =>
			repSummaries.map((rep, i) => {
				const watts =
					rep.power_watts && rep.power_watts > 0
						? rep.power_watts
						: calculatePower(rep.mean_force_n, rep.mean_velocity_mps);
				return {
					repNumber: i + 1,
					watts,
					force: rep.mean_force_n,
					velocity: rep.mean_velocity_mps,
				};
			}),
		[repSummaries],
	);

	const peakIndex = useMemo(() => {
		if (powerData.length === 0) return -1;
		let maxIdx = 0;
		for (let i = 1; i < powerData.length; i++) {
			if (powerData[i].watts > powerData[maxIdx].watts) maxIdx = i;
		}
		return maxIdx;
	}, [powerData]);

	const repLabels = useMemo(
		() => powerData.map((d) => String(d.repNumber)),
		[powerData],
	);

	const xScale = useMemo(
		() =>
			scaleBand<string>({
				domain: repLabels,
				range: [0, innerWidth],
				padding: 0.3,
			}),
		[repLabels, innerWidth],
	);

	const maxWatts = useMemo(() => {
		if (powerData.length === 0) return 100;
		return Math.max(...powerData.map((d) => d.watts)) * 1.2; // headroom for labels
	}, [powerData]);

	const yScale = useMemo(
		() =>
			scaleLinear<number>({
				domain: [0, maxWatts],
				range: [innerHeight, 0],
				nice: true,
			}),
		[maxWatts, innerHeight],
	);

	if (repSummaries.length === 0) {
		return (
			<div
				className="flex items-center justify-center text-gray-500"
				style={{ height }}
			>
				No power data available
			</div>
		);
	}

	return (
		<div style={{ position: "relative" }}>
			<svg width={width} height={height}>
				<Group left={margin.left} top={margin.top}>
					{powerData.map((d, i) => {
						const label = String(d.repNumber);
						const barX = xScale(label) ?? 0;
						const barWidth = xScale.bandwidth();
						const barHeight = innerHeight - (yScale(d.watts) ?? 0);
						const barY = yScale(d.watts) ?? 0;

						const isPeak = highlightPeak && i === peakIndex;
						const barColor = isPeak
							? CHART_COLORS.secondary
							: CHART_COLORS.primary;
						const barOpacity = highlightPeak && !isPeak ? 0.6 : 1;

						return (
							<Group key={i}>
								<Bar
									x={barX}
									y={barY}
									width={barWidth}
									height={barHeight}
									fill={barColor}
									opacity={barOpacity}
									rx={2}
									onMouseMove={(event) => {
										const svgRect = (
											event.currentTarget.ownerSVGElement as SVGSVGElement
										).getBoundingClientRect();
										showTooltip({
											tooltipData: {
												label: `Rep ${d.repNumber}${isPeak ? " (Peak)" : ""}`,
												value: `${d.watts}W | ${d.force.toFixed(0)}N x ${d.velocity.toFixed(2)}m/s`,
												color: barColor,
											},
											tooltipLeft: event.clientX - svgRect.left,
											tooltipTop: event.clientY - svgRect.top - 10,
										});
									}}
									onMouseLeave={() => hideTooltip()}
								/>

								{/* Watt label above bar */}
								<text
									x={barX + barWidth / 2}
									y={barY - 6}
									textAnchor="middle"
									fill={isPeak ? CHART_COLORS.secondary : CHART_COLORS.axisText}
									fontSize={10}
									fontWeight={isPeak ? 700 : 500}
								>
									{d.watts}W
								</text>
							</Group>
						);
					})}

					<AxisBottom
						top={innerHeight}
						scale={xScale}
						label="Rep"
						labelProps={{
							fill: CHART_COLORS.axisText,
							fontSize: FONT_SIZES.label,
							textAnchor: "middle",
						}}
						tickLabelProps={() => ({
							fill: CHART_COLORS.axisText,
							fontSize: FONT_SIZES.axis,
							textAnchor: "middle" as const,
						})}
						stroke={CHART_COLORS.gridLine}
						tickStroke={CHART_COLORS.gridLine}
					/>

					<AxisLeft
						scale={yScale}
						label="Power (W)"
						labelProps={{
							fill: CHART_COLORS.axisText,
							fontSize: FONT_SIZES.label,
							textAnchor: "middle",
						}}
						tickLabelProps={() => ({
							fill: CHART_COLORS.axisText,
							fontSize: FONT_SIZES.axis,
							textAnchor: "end" as const,
						})}
						stroke={CHART_COLORS.gridLine}
						tickStroke={CHART_COLORS.gridLine}
						numTicks={5}
					/>
				</Group>
			</svg>

			{tooltipOpen && tooltipData && (
				<ChartTooltipContent
					data={tooltipData}
					top={tooltipTop ?? 0}
					left={tooltipLeft ?? 0}
				/>
			)}
		</div>
	);
}

export function PowerOutput(props: PowerOutputProps) {
	return (
		<ParentSize>
			{({ width }) =>
				width > 0 ? <PowerOutputInner {...props} width={width} /> : null
			}
		</ParentSize>
	);
}
