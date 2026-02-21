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
import type { RepSummary } from "@/schemas/telemetry";

// -- Colors --
const COLOR_BALANCED = PHOENIX.forgeGreen; // Forge Green
const COLOR_IMBALANCED = PHOENIX.flameRed; // Flame Red
const COLOR_AXIS = PHOENIX.ashGray;
const COLOR_THRESHOLD = PHOENIX.gold; // Gold for threshold lines
const COLOR_TEXT = "#D1D5DB";

// -- Types --
export interface AsymmetryGaugeProps {
	repSummaries: RepSummary[];
	height?: number;
	mode?: "per-rep" | "summary";
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

function getSummaryLabel(avg: number): string {
	const abs = Math.abs(avg);
	const direction = avg > 0 ? "Right" : "Left";
	if (abs <= 2) return "Balanced";
	if (abs <= ASYMMETRY_THRESHOLD) return `Slight ${direction} Imbalance`;
	return `Significant ${direction} Imbalance`;
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
			<svg width={width} height={height}>
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
							stroke={COLOR_THRESHOLD}
							strokeWidth={1}
							strokeDasharray="4,3"
							opacity={0.6}
						/>
					))}

					{/* Center line */}
					<Line
						from={{ x: centerX, y: 0 }}
						to={{ x: centerX, y: innerHeight }}
						stroke={COLOR_AXIS}
						strokeWidth={1}
					/>

					{/* Bars */}
					{repSummaries.map((rep, i) => {
						const a = asymmetries[i];
						const isBalanced = Math.abs(a) <= ASYMMETRY_THRESHOLD;
						const barColor = isBalanced ? COLOR_BALANCED : COLOR_IMBALANCED;
						const barX = a >= 0 ? centerX : xScale(a);
						const barWidth = Math.abs(xScale(a) - centerX);
						const barY = yScale(String(i + 1)) ?? 0;
						const barHeight = yScale.bandwidth();

						return (
							<g key={i}>
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
						stroke={COLOR_AXIS}
						tickStroke={COLOR_AXIS}
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
						stroke={COLOR_AXIS}
						tickStroke={COLOR_AXIS}
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
						background: "#1F2937",
						color: COLOR_TEXT,
						border: "1px solid #374151",
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
							color: tooltipData.isBalanced ? COLOR_BALANCED : COLOR_IMBALANCED,
						}}
					>
						{tooltipData.isBalanced ? "Balanced" : "Imbalanced"}
					</div>
				</TooltipWithBounds>
			)}
		</>
	);
}

// -- Summary Mode --
function SummaryDisplay({ repSummaries }: { repSummaries: RepSummary[] }) {
	const avgAsymmetry = useMemo(() => {
		const total = repSummaries.reduce((sum, rep) => sum + getAsymmetry(rep), 0);
		return Math.round((total / repSummaries.length) * 10) / 10;
	}, [repSummaries]);

	const isBalanced = Math.abs(avgAsymmetry) <= ASYMMETRY_THRESHOLD;
	const label = getSummaryLabel(avgAsymmetry);
	const color = isBalanced ? COLOR_BALANCED : COLOR_IMBALANCED;

	// Calculate left/right split as percentages
	const leftPct = 50 - avgAsymmetry / 2;
	const rightPct = 50 + avgAsymmetry / 2;

	return (
		<div className="flex flex-col items-center gap-4 py-6">
			{/* Large center number */}
			<div className="text-5xl font-bold" style={{ color }}>
				{Math.abs(avgAsymmetry).toFixed(1)}%
			</div>

			{/* Status badge */}
			<span
				className="rounded-full px-4 py-1.5 text-sm font-medium"
				style={{
					backgroundColor: `${color}20`,
					color,
					border: `1px solid ${color}40`,
				}}
			>
				{label}
			</span>

			{/* Horizontal bar showing L/R split */}
			<div className="w-full max-w-xs">
				<div
					className="mb-1 flex justify-between text-xs"
					style={{ color: COLOR_TEXT }}
				>
					<span>Left {leftPct.toFixed(0)}%</span>
					<span>Right {rightPct.toFixed(0)}%</span>
				</div>
				<div className="flex h-4 overflow-hidden rounded-full">
					<div
						className="transition-all duration-300"
						style={{
							width: `${leftPct}%`,
							backgroundColor: avgAsymmetry < 0 ? color : COLOR_BALANCED,
						}}
					/>
					<div
						className="transition-all duration-300"
						style={{
							width: `${rightPct}%`,
							backgroundColor: avgAsymmetry > 0 ? color : COLOR_BALANCED,
						}}
					/>
				</div>
			</div>

			{/* Rep count */}
			<div className="text-xs" style={{ color: COLOR_AXIS }}>
				Based on {repSummaries.length} rep{repSummaries.length !== 1 ? "s" : ""}
			</div>
		</div>
	);
}

// -- Main Component --
export function AsymmetryGauge({
	repSummaries,
	height = 300,
	mode = "per-rep",
}: AsymmetryGaugeProps) {
	if (!repSummaries || repSummaries.length === 0) {
		return (
			<div
				className="flex items-center justify-center text-sm"
				style={{ height, color: COLOR_AXIS }}
			>
				No asymmetry data
			</div>
		);
	}

	if (mode === "summary") {
		return <SummaryDisplay repSummaries={repSummaries} />;
	}

	return (
		<div style={{ position: "relative", height }}>
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
	);
}
