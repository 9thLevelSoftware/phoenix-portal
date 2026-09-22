import { getThemeTokens, type ThemeTokens } from "@/lib/theme-tokens";
import {
	CHART_COLORS,
	CHART_MARGINS,
	FONT_SIZES,
	REP_COLORS,
} from "./ChartTheme";

/** Build the ECharts theme from the active token snapshot. */
export function getPhoenixEchartsTheme(tokens: ThemeTokens = getThemeTokens()) {
	const colors = CHART_COLORS(tokens);
	return {
		color: [
			colors.primary,
			colors.secondary,
			colors.success,
			colors.danger,
			tokens.chart5,
			tokens.chart5,
			tokens.cableB,
			tokens.chart5,
		],
		backgroundColor: "transparent",
		textStyle: {
			color: colors.axisText,
			fontFamily: "system-ui, sans-serif",
		},
		title: {
			textStyle: {
				color: tokens.foreground,
				fontSize: FONT_SIZES.title,
				fontWeight: 600,
			},
		},
		categoryAxis: {
			axisLine: { lineStyle: { color: tokens.border } },
			axisTick: { lineStyle: { color: tokens.border } },
			axisLabel: { color: colors.axisText, fontSize: FONT_SIZES.axis },
			splitLine: { lineStyle: { color: tokens.surface3 } },
		},
		valueAxis: {
			axisLine: { lineStyle: { color: tokens.border } },
			axisTick: { lineStyle: { color: tokens.border } },
			axisLabel: { color: colors.axisText, fontSize: FONT_SIZES.axis },
			splitLine: { lineStyle: { color: tokens.surface3, type: "dashed" } },
		},
		tooltip: {
			backgroundColor: colors.tooltipBg,
			borderColor: colors.tooltipBorder,
			textStyle: { color: tokens.foreground, fontSize: 12 },
		},
		legend: {
			textStyle: { color: colors.axisText },
		},
		radar: {
			axisLine: { lineStyle: { color: tokens.border } },
			splitLine: { lineStyle: { color: tokens.border } },
			splitArea: { areaStyle: { color: ["transparent"] } },
		},
		gauge: {
			axisLine: {
				lineStyle: {
					color: [
						[0.3, tokens.success],
						[0.7, tokens.accent],
						[1, tokens.danger],
					],
				},
			},
		},
	} as const;
}

/** ECharts-compatible margins */
export const ECHARTS_GRID = {
	top: CHART_MARGINS.top,
	right: CHART_MARGINS.right,
	bottom: CHART_MARGINS.bottom,
	left: CHART_MARGINS.left,
	containLabel: true,
} as const;

export { CHART_COLORS, CHART_MARGINS, FONT_SIZES, REP_COLORS };
