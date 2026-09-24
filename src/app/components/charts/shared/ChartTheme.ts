/**
 * Phoenix-themed chart accessors for visx and ECharts visualizations.
 * Theme values are resolved when an accessor is called, not at module load.
 */

import {
	memoByTheme,
	type ThemeTokens,
	useThemeTokens,
} from "@/lib/theme-tokens";

export type ChartColors = {
	primary: string;
	secondary: string;
	danger: string;
	success: string;
	accent: string;
	background: string;
	gridLine: string;
	axisText: string;
	tooltipBg: string;
	tooltipBorder: string;
};

const chartColors = memoByTheme(
	(tokens): ChartColors => ({
		primary: tokens.primary,
		secondary: tokens.accent,
		danger: tokens.danger,
		success: tokens.success,
		accent: tokens.cableB,
		background: tokens.background,
		gridLine: tokens.surface3,
		axisText: tokens.mutedForeground,
		tooltipBg: tokens.surface3,
		tooltipBorder: tokens.border,
	}),
);

/** Semantic chart colours for the active theme (stable until it changes). */
export function CHART_COLORS(tokens?: ThemeTokens): ChartColors {
	return chartColors(tokens);
}

export function useChartColors(): ChartColors {
	return CHART_COLORS(useThemeTokens());
}

export const CHART_MARGINS = {
	top: 20,
	right: 20,
	bottom: 40,
	left: 50,
} as const;

// Ten distinct colours, one per rep in a set; repeating the five-colour chart
// palette made rep 1 and rep 6 indistinguishable.
const repColors = memoByTheme((tokens): string[] => [
	tokens.chart1,
	tokens.chart3,
	tokens.chart4,
	tokens.chart2,
	tokens.chart5,
	tokens.chart6,
	tokens.chart7,
	tokens.chart8,
	tokens.danger,
	tokens.mutedForeground,
]);

export function REP_COLORS(tokens?: ThemeTokens): string[] {
	return repColors(tokens);
}

export function useRepColors(): string[] {
	return REP_COLORS(useThemeTokens());
}

export const FONT_SIZES = {
	axis: 11,
	label: 13,
	title: 15,
} as const;
