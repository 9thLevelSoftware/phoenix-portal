import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { CHART_COLORS } from "./ChartTheme";

export interface ChartTooltipData {
	label: string;
	value: string;
	color?: string;
}

/**
 * Wraps visx useTooltip with ChartTooltipData typing.
 * Returns the same API (showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen).
 */
export function useChartTooltip() {
	return useTooltip<ChartTooltipData>();
}

interface ChartTooltipContentProps {
	data: ChartTooltipData;
	top: number;
	left: number;
}

/**
 * Phoenix-themed tooltip card for visx charts.
 * Uses inline styles because visx tooltips use absolute positioning
 * and Tailwind classes don't work reliably with portal-rendered tooltips.
 */
export function ChartTooltipContent({
	data,
	top,
	left,
}: ChartTooltipContentProps) {
	return (
		<TooltipWithBounds
			top={top}
			left={left}
			style={{
				...defaultStyles,
				backgroundColor: CHART_COLORS.tooltipBg,
				border: `1px solid ${CHART_COLORS.tooltipBorder}`,
				borderRadius: "6px",
				padding: "8px 12px",
				color: "var(--foreground)",
				fontSize: "12px",
				lineHeight: "1.4",
				boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
			}}
		>
			<div style={{ fontWeight: 500, marginBottom: "2px", color: "var(--muted-foreground)" }}>
				{data.label}
			</div>
			<div
				style={{ fontWeight: 600, color: data.color ?? CHART_COLORS.primary }}
			>
				{data.value}
			</div>
		</TooltipWithBounds>
	);
}
