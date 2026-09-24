import { useSyncExternalStore } from "react";

export type ThemeTokens = {
	primary: string;
	primaryForeground: string;
	accent: string;
	accentForeground: string;
	danger: string;
	success: string;
	warning: string;
	foreground: string;
	background: string;
	border: string;
	muted: string;
	mutedForeground: string;
	surface1: string;
	surface2: string;
	surface3: string;
	cableA: string;
	cableB: string;
	chart1: string;
	chart2: string;
	chart3: string;
	chart4: string;
	chart5: string;
	chart6: string;
	chart7: string;
	chart8: string;
	chartPalette: readonly string[];
};

const FALLBACKS: ThemeTokens = {
	primary: "rgb(255, 107, 53)",
	primaryForeground: "rgb(6, 6, 10)",
	accent: "rgb(245, 158, 11)",
	accentForeground: "rgb(6, 6, 10)",
	danger: "rgb(255, 82, 82)",
	success: "rgb(0, 230, 118)",
	warning: "rgb(255, 171, 0)",
	foreground: "rgb(224, 224, 232)",
	background: "rgb(6, 6, 10)",
	border: "rgb(26, 26, 36)",
	muted: "rgb(74, 74, 86)",
	mutedForeground: "rgb(160, 160, 172)",
	surface1: "rgb(10, 10, 16)",
	surface2: "rgb(14, 14, 20)",
	surface3: "rgb(20, 20, 32)",
	cableA: "rgb(255, 107, 53)",
	cableB: "rgb(107, 163, 247)",
	chart1: "rgb(255, 107, 53)",
	chart2: "rgb(107, 163, 247)",
	chart3: "rgb(245, 158, 11)",
	chart4: "rgb(0, 230, 118)",
	chart5: "rgb(149, 117, 255)",
	chart6: "rgb(244, 114, 182)",
	chart7: "rgb(34, 211, 238)",
	chart8: "rgb(163, 230, 53)",
	chartPalette: [
		"rgb(255, 107, 53)",
		"rgb(107, 163, 247)",
		"rgb(245, 158, 11)",
		"rgb(0, 230, 118)",
		"rgb(149, 117, 255)",
		"rgb(244, 114, 182)",
		"rgb(34, 211, 238)",
		"rgb(163, 230, 53)",
	],
};

export const THEME_CHANGE_EVENT = "phoenix-theme-change";

function readCssVariable(
	styles: CSSStyleDeclaration,
	name: string,
	fallback: string,
) {
	return styles.getPropertyValue(name).trim() || fallback;
}

function readThemeTokens(styles: CSSStyleDeclaration): ThemeTokens {
	const chart1 = readCssVariable(styles, "--chart-1", FALLBACKS.chart1);
	const chart2 = readCssVariable(styles, "--chart-2", FALLBACKS.chart2);
	const chart3 = readCssVariable(styles, "--chart-3", FALLBACKS.chart3);
	const chart4 = readCssVariable(styles, "--chart-4", FALLBACKS.chart4);
	const chart5 = readCssVariable(styles, "--chart-5", FALLBACKS.chart5);
	const chart6 = readCssVariable(styles, "--chart-6", FALLBACKS.chart6);
	const chart7 = readCssVariable(styles, "--chart-7", FALLBACKS.chart7);
	const chart8 = readCssVariable(styles, "--chart-8", FALLBACKS.chart8);
	return {
		primary: readCssVariable(styles, "--primary", FALLBACKS.primary),
		primaryForeground: readCssVariable(
			styles,
			"--primary-foreground",
			FALLBACKS.primaryForeground,
		),
		accent: readCssVariable(styles, "--accent", FALLBACKS.accent),
		accentForeground: readCssVariable(
			styles,
			"--accent-foreground",
			FALLBACKS.accentForeground,
		),
		danger: readCssVariable(styles, "--destructive", FALLBACKS.danger),
		success: readCssVariable(styles, "--success", FALLBACKS.success),
		warning: readCssVariable(styles, "--warning", FALLBACKS.warning),
		foreground: readCssVariable(styles, "--foreground", FALLBACKS.foreground),
		background: readCssVariable(styles, "--background", FALLBACKS.background),
		border: readCssVariable(styles, "--border", FALLBACKS.border),
		muted: readCssVariable(styles, "--muted", FALLBACKS.muted),
		mutedForeground: readCssVariable(
			styles,
			"--muted-foreground",
			FALLBACKS.mutedForeground,
		),
		surface1: readCssVariable(styles, "--surface-1", FALLBACKS.surface1),
		surface2: readCssVariable(styles, "--surface-2", FALLBACKS.surface2),
		surface3: readCssVariable(styles, "--surface-3", FALLBACKS.surface3),
		cableA: readCssVariable(styles, "--cable-a", FALLBACKS.cableA),
		cableB: readCssVariable(styles, "--cable-b", FALLBACKS.cableB),
		chart1,
		chart2,
		chart3,
		chart4,
		chart5,
		chart6,
		chart7,
		chart8,
		chartPalette: [
			chart1,
			chart2,
			chart3,
			chart4,
			chart5,
			chart6,
			chart7,
			chart8,
		],
	};
}

function sameTokens(a: ThemeTokens, b: ThemeTokens): boolean {
	return (Object.keys(a) as Array<keyof ThemeTokens>).every((key) =>
		key === "chartPalette"
			? a.chartPalette.join() === b.chartPalette.join()
			: a[key] === b[key],
	);
}

// getComputedStyle forces a style recalculation, and colour lookups run in
// hot paths (replay frames, per-rep zone classification, chart options), so
// the resolved snapshot is cached until the theme changes. ThemeProvider calls
// invalidateThemeTokens() before it announces a change. Identity is stable
// while the values are unchanged, so it is safe as a memo/effect dependency.
let cachedTokens: ThemeTokens | null = null;
let lastTokens: ThemeTokens = FALLBACKS;

/** The active theme's colours: a stable snapshot until the theme changes. */
export function getThemeTokens(): ThemeTokens {
	if (cachedTokens) return cachedTokens;
	if (typeof document === "undefined") return FALLBACKS;
	const styles = getComputedStyle(document.documentElement);
	// Before the stylesheet applies (or under jsdom) nothing is defined: answer
	// with the fallbacks but do not pin them.
	if (!styles.getPropertyValue("--primary").trim()) return FALLBACKS;
	const next = readThemeTokens(styles);
	cachedTokens = sameTokens(next, lastTokens) ? lastTokens : next;
	lastTokens = cachedTokens;
	return cachedTokens;
}

/** Drop the cached snapshot; the next getThemeTokens() re-reads the CSS. */
export function invalidateThemeTokens(): void {
	cachedTokens = null;
}

function subscribeToThemeChanges(onChange: () => void): () => void {
	window.addEventListener(THEME_CHANGE_EVENT, onChange);
	return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

/** The active theme's colours; re-renders the caller when the theme changes. */
export function useThemeTokens(): ThemeTokens {
	return useSyncExternalStore(
		subscribeToThemeChanges,
		getThemeTokens,
		() => FALLBACKS,
	);
}

/**
 * Memoise a derivation of the theme (a palette, a zone table) per token
 * snapshot, so callers get the same array/object back until the theme
 * changes instead of a fresh allocation on every call.
 */
export function memoByTheme<T>(
	derive: (tokens: ThemeTokens) => T,
): (tokens?: ThemeTokens) => T {
	const cache = new WeakMap<ThemeTokens, T>();
	return (tokens = getThemeTokens()) => {
		let value = cache.get(tokens);
		if (value === undefined) {
			value = derive(tokens);
			cache.set(tokens, value);
		}
		return value;
	};
}

export function withAlpha(color: string, alpha: number): string {
	const hex = color.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const value = Number.parseInt(hex[1], 16);
		const red = (value >> 16) & 255;
		const green = (value >> 8) & 255;
		const blue = value & 255;
		return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
	}
	const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
	if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
	return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
