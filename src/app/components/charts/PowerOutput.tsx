import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { useMemo } from "react";
import { authoritativeRepPower } from "@/lib/biomechanics";
import { useRerenderOnThemeChange } from "@/lib/theme-tokens";
import type { RepSummary } from "@/schemas/telemetry";
import { CHART_COLORS, CHART_MARGINS, FONT_SIZES } from "./shared/ChartTheme";
import { ChartTooltipContent, useChartTooltip } from "./shared/ChartTooltip";

const CHART_HEIGHT = 250;

export interface PowerOutputProps {
	repSummaries: RepSummary[];
}

interface PowerRep {
	repNumber: number;
	watts: number;
}

function PowerOutputInner({
	repSummaries,
	width,
}: PowerOutputProps & { width: number }) {
	// Colours below come from the theme helpers; re-read them on a switch.
	useRerenderOnThemeChange();
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
	const innerHeight = CHART_HEIGHT - margin.top - margin.bottom;

	const powerData = useMemo<PowerRep[]>(
		() =>
			repSummaries.flatMap((rep, i) => {
				const watts = authoritativeRepPower(rep).meanWatts;
				return watts === null
					? []
					: [
							{
								repNumber: rep.rep_number ?? i + 1,
								watts,
							},
						];
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

	const powerExtent = useMemo(
		() => [
			Math.min(0, ...powerData.map((d) => d.watts)) * 1.2,
			Math.max(100, ...powerData.map((d) => d.watts)) * 1.2,
		],
		[powerData],
	);

	const yScale = useMemo(
		() =>
			scaleLinear<number>({
				domain: powerExtent,
				range: [innerHeight, 0],
				nice: true,
			}),
		[powerExtent, innerHeight],
	);

	if (powerData.length === 0) {
		return (
			<div
				className="flex items-center justify-center text-muted-foreground"
				style={{ height: CHART_HEIGHT }}
			>
				Paired cable-work power unavailable
			</div>
		);
	}

	return (
		<div style={{ position: "relative" }}>
			<svg
				width={width}
				height={CHART_HEIGHT}
				role="img"
				aria-label="Mean paired cable-work power proxy"
			>
				<Group left={margin.left} top={margin.top}>
					{powerData.map((d, i) => {
						const label = String(d.repNumber);
						const barX = xScale(label) ?? 0;
						const barWidth = xScale.bandwidth();
						const barHeight = Math.abs(yScale(0) - yScale(d.watts));
						const barY = Math.min(yScale(0), yScale(d.watts));

						const isPeak = i === peakIndex;
						const barColor = isPeak
							? CHART_COLORS().secondary
							: CHART_COLORS().primary;
						const barOpacity = isPeak ? 1 : 0.6;

						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: derived sequential chart data with no unique ID
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
												label: `Rep ${d.repNumber}${isPeak ? " (Highest mean)" : ""}`,
												value: `${d.watts.toFixed(2)} W mean paired cable-work proxy`,
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
									fill={
										isPeak ? CHART_COLORS().secondary : CHART_COLORS().axisText
									}
									fontSize={10}
									fontWeight={isPeak ? 700 : 500}
								>
									{d.watts.toFixed(1)} W
								</text>
							</Group>
						);
					})}

					<AxisBottom
						top={innerHeight}
						scale={xScale}
						label="Rep"
						labelProps={{
							fill: CHART_COLORS().axisText,
							fontSize: FONT_SIZES.label,
							textAnchor: "middle",
						}}
						tickLabelProps={() => ({
							fill: CHART_COLORS().axisText,
							fontSize: FONT_SIZES.axis,
							textAnchor: "middle" as const,
						})}
						stroke={CHART_COLORS().gridLine}
						tickStroke={CHART_COLORS().gridLine}
					/>

					<AxisLeft
						scale={yScale}
						label="Mean cable-work proxy (W)"
						labelProps={{
							fill: CHART_COLORS().axisText,
							fontSize: FONT_SIZES.label,
							textAnchor: "middle",
						}}
						tickLabelProps={() => ({
							fill: CHART_COLORS().axisText,
							fontSize: FONT_SIZES.axis,
							textAnchor: "end" as const,
						})}
						stroke={CHART_COLORS().gridLine}
						tickStroke={CHART_COLORS().gridLine}
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
	const repCount = props.repSummaries.length;
	const peaks = props.repSummaries.flatMap((rep) => {
		const watts = authoritativeRepPower(rep).peakWatts;
		return watts === null ? [] : [watts];
	});
	const peakPower = peaks.length > 0 ? Math.max(...peaks) : null;
	const unknownCount = props.repSummaries.filter(
		(rep) => authoritativeRepPower(rep).meanWatts === null,
	).length;

	return (
		<div
			role="img"
			aria-label={`Paired cable-work power proxy for ${repCount} reps. Peak: ${peakPower === null ? "unavailable" : `${peakPower.toFixed(2)} watts`}. ${unknownCount} reps unavailable.`}
		>
			<p className="text-sm text-muted-foreground">
				Signed cable-work proxy, not muscle or body power.
				{unknownCount > 0 &&
					` ${unknownCount} reps unavailable; historical power is unverified.`}
			</p>
			<div aria-hidden="true">
				<ParentSize>
					{({ width }) =>
						width > 0 ? <PowerOutputInner {...props} width={width} /> : null
					}
				</ParentSize>
			</div>
			<table className="sr-only">
				<caption>Paired cable-work power proxy by rep</caption>
				<thead>
					<tr>
						<th>Rep</th>
						<th>Mean proxy (W)</th>
						<th>Peak proxy (W)</th>
					</tr>
				</thead>
				<tbody>
					{props.repSummaries.map((rep, i) => {
						const power = authoritativeRepPower(rep);
						return (
							<tr key={rep.id}>
								<td>Rep {rep.rep_number ?? i + 1}</td>
								<td>
									{power.meanWatts === null
										? "Unavailable"
										: power.meanWatts.toFixed(2)}
								</td>
								<td>
									{power.peakWatts === null
										? "Unavailable"
										: power.peakWatts.toFixed(2)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
