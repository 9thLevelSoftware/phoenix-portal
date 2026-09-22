/**
 * Phoenix-themed chart accessors for visx and ECharts visualizations.
 * Theme values are resolved when an accessor is called, not at module load.
 */

import {
	getThemeTokens,
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

export function CHART_COLORS(
	tokens: ThemeTokens = getThemeTokens(),
): ChartColors {
	return {
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
	};
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

export function REP_COLORS(tokens: ThemeTokens = getThemeTokens()): string[] {
	return [...tokens.chartPalette, ...tokens.chartPalette];
}

export function useRepColors(): string[] {
	return REP_COLORS(useThemeTokens());
}

export const FONT_SIZES = {
	axis: 11,
	label: 13,
	title: 15,
} as const;
