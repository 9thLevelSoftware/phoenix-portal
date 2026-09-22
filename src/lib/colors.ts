import { getThemeTokens, withAlpha } from "./theme-tokens";

/**
 * Phoenix Signal color constants for SVG, animation, canvas, and chart APIs.
 * Values are resolved from the active CSS theme and cached by theme name.
 */
const tokens = getThemeTokens();

export const PHOENIX = {
	ember: tokens.primary,
	flameRed: tokens.danger,
	gold: tokens.accent,
	forgeGreen: tokens.success,
	black: tokens.background,
	white: tokens.foreground,
	ashGray: tokens.mutedForeground,
	moltenSteel: tokens.border,
	lightGray: tokens.foreground,
	crimson: tokens.danger,
	flameYellow: tokens.accent,
	mutedForeground: tokens.mutedForeground,
} as const;

/** Cable colors — the bilateral identity of Phoenix */
export const CABLE = {
	a: tokens.cableA,
	b: tokens.cableB,
	aDim: withAlpha(tokens.cableA, 0.15),
	bDim: withAlpha(tokens.cableB, 0.15),
} as const;

/** Signal status colors */
export const SIGNAL = {
	ok: tokens.success,
	warn: tokens.warning,
	danger: tokens.danger,
} as const;

/** Surface layer colors for programmatic use */
export const SURFACE = {
	base: tokens.background,
	raised: tokens.surface1,
	elevated: tokens.surface2,
	overlay: withAlpha(tokens.background, 0.95),
} as const;

/** Semantic colors for data contexts (programmatic use) */
export const SEMANTIC = {
	positive: tokens.success,
	caution: tokens.warning,
	info: tokens.cableB,
	negative: tokens.danger,
	neutral: tokens.muted,
} as const;

/** Velocity zone colors */
export const VELOCITY_ZONES = {
	explosive: tokens.danger,
	fast: tokens.warning,
	moderate: tokens.success,
	slow: tokens.cableB,
	grind: tokens.chart5,
} as const;

/** Chart palette for visx/Recharts programmatic configuration */
export const CHART_PALETTE = [...tokens.chartPalette] as const;

export type PhoenixColor = (typeof PHOENIX)[keyof typeof PHOENIX];
