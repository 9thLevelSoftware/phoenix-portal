import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { useRerenderOnThemeChange } from "@/lib/theme-tokens";
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
	// Colours below come from the theme helpers; re-read them on a switch.
	useRerenderOnThemeChange();
	return (
		<TooltipWithBounds
			top={top}
			left={left}
			style={{
				...defaultStyles,
				backgroundColor: CHART_COLORS().tooltipBg,
				border: `1px solid ${CHART_COLORS().tooltipBorder}`,
				borderRadius: "6px",
				padding: "8px 12px",
				color: "var(--foreground)",
				fontSize: "12px",
				lineHeight: "1.4",
				boxShadow: "var(--elevation-md)",
			}}
		>
			<div
				style={{
					fontWeight: 500,
					marginBottom: "2px",
					color: "var(--muted-foreground)",
				}}
			>
				{data.label}
			</div>
			<div
				style={{ fontWeight: 600, color: data.color ?? CHART_COLORS().primary }}
			>
				{data.value}
			</div>
		</TooltipWithBounds>
	);
}
