import { getThemeTokens, withAlpha } from "./theme-tokens";

export interface PhoenixColors {
	ember: string;
	flameRed: string;
	gold: string;
	forgeGreen: string;
	black: string;
	white: string;
	ashGray: string;
	moltenSteel: string;
	lightGray: string;
	crimson: string;
	flameYellow: string;
	mutedForeground: string;
}

export interface CableColors {
	a: string;
	b: string;
	aDim: string;
	bDim: string;
}

export interface SignalColors {
	ok: string;
	warn: string;
	danger: string;
}

export interface SurfaceColors {
	base: string;
	raised: string;
	elevated: string;
	overlay: string;
}

export interface SemanticColors {
	positive: string;
	caution: string;
	info: string;
	negative: string;
	neutral: string;
}

export interface VelocityZoneColors {
	explosive: string;
	fast: string;
	moderate: string;
	slow: string;
	grind: string;
}

/** Phoenix Signal colors, resolved from the active theme at call time. */
export function PHOENIX(): PhoenixColors {
	const tokens = getThemeTokens();
	return {
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
	};
}

/** Cable colors — the bilateral identity of Phoenix. */
export function CABLE(): CableColors {
	const tokens = getThemeTokens();
	return {
		a: tokens.cableA,
		b: tokens.cableB,
		aDim: withAlpha(tokens.cableA, 0.15),
		bDim: withAlpha(tokens.cableB, 0.15),
	};
}

/** Signal status colors. */
export function SIGNAL(): SignalColors {
	const tokens = getThemeTokens();
	return {
		ok: tokens.success,
		warn: tokens.warning,
		danger: tokens.danger,
	};
}

/** Surface layer colors for programmatic use. */
export function SURFACE(): SurfaceColors {
	const tokens = getThemeTokens();
	return {
		base: tokens.background,
		raised: tokens.surface1,
		elevated: tokens.surface2,
		overlay: withAlpha(tokens.background, 0.95),
	};
}

/** Semantic colors for data contexts. */
export function SEMANTIC(): SemanticColors {
	const tokens = getThemeTokens();
	return {
		positive: tokens.success,
		caution: tokens.warning,
		info: tokens.cableB,
		negative: tokens.danger,
		neutral: tokens.muted,
	};
}

/** Velocity zone colors. */
export function VELOCITY_ZONES(): VelocityZoneColors {
	const tokens = getThemeTokens();
	return {
		explosive: tokens.danger,
		fast: tokens.warning,
		moderate: tokens.success,
		slow: tokens.cableB,
		grind: tokens.chart5,
	};
}

/** Chart palette for visx/Recharts programmatic configuration. */
export function CHART_PALETTE(): readonly string[] {
	return [...getThemeTokens().chartPalette];
}

export type PhoenixColor = PhoenixColors[keyof PhoenixColors];
