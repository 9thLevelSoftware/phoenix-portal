import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, Line } from "@visx/shape";
import { Text } from "@visx/text";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { useMemo } from "react";
import { ASYMMETRY_THRESHOLD, calculateAsymmetry } from "@/lib/biomechanics";
import { PHOENIX } from "@/lib/colors";
import { useRerenderOnThemeChange } from "@/lib/theme-tokens";
import type { RepSummary } from "@/schemas/telemetry";

function getAsymmetryColors() {
	const phoenix = PHOENIX();
	return {
		balanced: phoenix.forgeGreen,
		imbalanced: phoenix.flameRed,
		axis: phoenix.ashGray,
		threshold: phoenix.gold,
	};
}

const COLOR_TEXT = "var(--foreground)";

// -- Types --
export interface AsymmetryGaugeProps {
	repSummaries: RepSummary[];
	height?: number;
}

interface TooltipData {
	repNumber: number;
	leftForce: number;
	rightForce: number;
	asymmetry: number;
	isBalanced: boolean;
}

// -- Helpers --
function getAsymmetry(rep: RepSummary): number {
	if (rep.asymmetry_pct != null && rep.asymmetry_pct !== 0)
		return rep.asymmetry_pct;
	return calculateAsymmetry(rep.left_force_avg, rep.right_force_avg);
}

function getAsymmetryLabel(pct: number): string {
	if (Math.abs(pct) <= 2) return "Balanced";
	return pct > 0 ? `R+${Math.abs(pct)}%` : `L+${Math.abs(pct)}%`;
}

// -- Per-Rep Mode --
function PerRepChart({
	repSummaries,
	width,
	height,
}: {
	repSummaries: RepSummary[];
	width: number;
	height: number;
}) {
	// Colours below come from the theme helpers; re-read them on a switch.
	useRerenderOnThemeChange();
	const {
		tooltipOpen,
		tooltipData,
		tooltipLeft,
		tooltipTop,
		showTooltip,
		hideTooltip,
	} = useTooltip<TooltipData>();

	const margin = { top: 30, right: 60, bottom: 40, left: 50 };
	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	const repIds = useMemo(
		() => repSummaries.map((_, i) => String(i + 1)),
		[repSummaries],
	);

	const asymmetries = useMemo(
		() => repSummaries.map(getAsymmetry),
		[repSummaries],
	);

	const maxAbs = useMemo(() => {
		const m = Math.max(...asymmetries.map(Math.abs), ASYMMETRY_THRESHOLD + 5);
		return Math.ceil(m / 5) * 5; // round up to nearest 5
	}, [asymmetries]);

	const xScale = useMemo(
		() =>
			scaleLinear<number>({
				domain: [-maxAbs, maxAbs],
				range: [0, innerWidth],
			}),
		[maxAbs, innerWidth],
	);

	const yScale = useMemo(
		() =>
			scaleBand<string>({
				domain: repIds,
				range: [0, innerHeight],
				padding: 0.25,
			}),
		[repIds, innerHeight],
	);

	const centerX = xScale(0);

	return (
		<>
			<svg
				width={width}
				height={height}
				role="img"
				aria-label="Cable asymmetry gauge"
			>
				<Group left={margin.left} top={margin.top}>
					{/* Header labels */}
					<Text
						x={xScale(-maxAbs / 2)}
						y={-12}
						fill={COLOR_TEXT}
						fontSize={11}
						textAnchor="middle"
						fontFamily="Inter, system-ui, sans-serif"
					>
						Left Dominant
					</Text>
					<Text
						x={xScale(maxAbs / 2)}
						y={-12}
						fill={COLOR_TEXT}
						fontSize={11}
						textAnchor="middle"
						fontFamily="Inter, system-ui, sans-serif"
					>
						Right Dominant
					</Text>

					{/* Threshold lines */}
					{[-ASYMMETRY_THRESHOLD, ASYMMETRY_THRESHOLD].map((t) => (
						<Line
							key={t}
							from={{ x: xScale(t), y: 0 }}
							to={{ x: xScale(t), y: innerHeight }}
							stroke={getAsymmetryColors().threshold}
							strokeWidth={1}
							strokeDasharray="4,3"
							opacity={0.6}
						/>
					))}

					{/* Center line */}
					<Line
						from={{ x: centerX, y: 0 }}
						to={{ x: centerX, y: innerHeight }}
						stroke={getAsymmetryColors().axis}
						strokeWidth={1}
					/>

					{/* Bars */}
					{repSummaries.map((rep, i) => {
						const a = asymmetries[i];
						const isBalanced = Math.abs(a) <= ASYMMETRY_THRESHOLD;
						const barColor = isBalanced
							? getAsymmetryColors().balanced
							: getAsymmetryColors().imbalanced;
						const barX = a >= 0 ? centerX : xScale(a);
						const barWidth = Math.abs(xScale(a) - centerX);
						const barY = yScale(String(i + 1)) ?? 0;
						const barHeight = yScale.bandwidth();

						return (
							<g key={rep.id}>
								<Bar
									x={barX}
									y={barY}
									width={barWidth}
									height={barHeight}
									fill={barColor}
									rx={3}
									opacity={0.85}
									onMouseMove={(e) => {
										const point = localPoint(e);
										showTooltip({
											tooltipData: {
												repNumber: rep.rep_number,
												leftForce: rep.left_force_avg,
												rightForce: rep.right_force_avg,
												asymmetry: a,
												isBalanced,
											},
											tooltipLeft: (point?.x ?? 0) + margin.left,
											tooltipTop: (point?.y ?? 0) + margin.top,
										});
									}}
									onMouseLeave={hideTooltip}
								/>
								{/* Label */}
								<Text
									x={a >= 0 ? barX + barWidth + 4 : barX - 4}
									y={barY + barHeight / 2}
									fill={COLOR_TEXT}
									fontSize={10}
									textAnchor={a >= 0 ? "start" : "end"}
									verticalAnchor="middle"
									fontFamily="Inter, system-ui, sans-serif"
								>
									{getAsymmetryLabel(a)}
								</Text>
							</g>
						);
					})}

					{/* Axes */}
					<AxisBottom
						top={innerHeight}
						scale={xScale}
						tickValues={[-20, -10, 0, 10, 20].filter(
							(v) => Math.abs(v) <= maxAbs,
						)}
						tickFormat={(v) => `${v as number}%`}
						stroke={getAsymmetryColors().axis}
						tickStroke={getAsymmetryColors().axis}
						tickLabelProps={() => ({
							fill: COLOR_TEXT,
							fontSize: 10,
							textAnchor: "middle" as const,
							fontFamily: "Inter, system-ui, sans-serif",
						})}
					/>
					<AxisLeft
						scale={yScale}
						tickFormat={(v) => `Rep ${v}`}
						stroke={getAsymmetryColors().axis}
						tickStroke={getAsymmetryColors().axis}
						tickLabelProps={() => ({
							fill: COLOR_TEXT,
							fontSize: 10,
							textAnchor: "end" as const,
							fontFamily: "Inter, system-ui, sans-serif",
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
						background: "var(--surface-3)",
						color: COLOR_TEXT,
						border: "1px solid var(--border)",
						borderRadius: 6,
						padding: "8px 12px",
						fontSize: 12,
						fontFamily: "Inter, system-ui, sans-serif",
						lineHeight: 1.5,
					}}
				>
					<div style={{ fontWeight: 600, marginBottom: 4 }}>
						Rep {tooltipData.repNumber}
					</div>
					<div>Left: {tooltipData.leftForce.toFixed(1)} N</div>
					<div>Right: {tooltipData.rightForce.toFixed(1)} N</div>
					<div>Asymmetry: {tooltipData.asymmetry.toFixed(1)}%</div>
					<div
						style={{
							color: tooltipData.isBalanced
								? getAsymmetryColors().balanced
								: getAsymmetryColors().imbalanced,
						}}
					>
						{tooltipData.isBalanced ? "Balanced" : "Imbalanced"}
					</div>
				</TooltipWithBounds>
			)}
		</>
	);
}

// -- Main Component --
export function AsymmetryGauge({
	repSummaries,
	height = 300,
}: AsymmetryGaugeProps) {
	// Colours below come from the theme helpers; re-read them on a switch.
	useRerenderOnThemeChange();
	if (!repSummaries || repSummaries.length === 0) {
		return (
			<div
				className="flex items-center justify-center text-sm"
				style={{ height, color: getAsymmetryColors().axis }}
			>
				No asymmetry data
			</div>
		);
	}

	const repCount = repSummaries.length;

	return (
		<div
			role="img"
			aria-label={`Left-right force asymmetry chart showing ${repCount} rep${repCount !== 1 ? "s" : ""}.`}
		>
			<div aria-hidden="true" style={{ position: "relative", height }}>
				<ParentSize>
					{({ width }) =>
						width > 0 ? (
							<PerRepChart
								repSummaries={repSummaries}
								width={width}
								height={height}
							/>
						) : null
					}
				</ParentSize>
			</div>
			<table className="sr-only">
				<caption>Asymmetry data by rep</caption>
				<thead>
					<tr>
						<th>Rep</th>
						<th>Left Force (N)</th>
						<th>Right Force (N)</th>
						<th>Asymmetry (%)</th>
					</tr>
				</thead>
				<tbody>
					{repSummaries.map((rep, i) => (
						<tr key={rep.id}>
							<td>Rep {rep.rep_number ?? i + 1}</td>
							<td>{rep.left_force_avg.toFixed(1)}</td>
							<td>{rep.right_force_avg.toFixed(1)}</td>
							<td>{getAsymmetry(rep).toFixed(1)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
