/**
 * Phoenix-themed chart constants for visx visualizations.
 * Shared across all premium analytics chart components.
 */

import { getThemeTokens } from "@/lib/theme-tokens";

const tokens = getThemeTokens();

export const CHART_COLORS = {
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
} as const;

export const CHART_MARGINS = {
	top: 20,
	right: 20,
	bottom: 40,
	left: 50,
} as const;

/**
 * Distinguishable colors for multi-rep overlays, resolved from the active
 * theme so Recharts receives concrete values instead of CSS variable names.
 */
export const REP_COLORS: string[] = [
	...tokens.chartPalette,
	...tokens.chartPalette,
];

export const FONT_SIZES = {
	axis: 11,
	label: 13,
	title: 15,
} as const;
