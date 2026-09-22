import { useEffect, useState } from "react";

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
	chart5: "rgb(124, 77, 255)",
	chartPalette: [
		"rgb(255, 107, 53)",
		"rgb(107, 163, 247)",
		"rgb(245, 158, 11)",
		"rgb(0, 230, 118)",
		"rgb(124, 77, 255)",
	],
};

function readCssVariable(
	styles: CSSStyleDeclaration | null,
	name: string,
	fallback: string,
) {
	return styles?.getPropertyValue(name).trim() || fallback;
}

/** Read the active CSS theme at call time. */
export function getThemeTokens(): ThemeTokens {
	const styles =
		typeof document !== "undefined"
			? getComputedStyle(document.documentElement)
			: null;
	const chart1 = readCssVariable(styles, "--chart-1", FALLBACKS.chart1);
	const chart2 = readCssVariable(styles, "--chart-2", FALLBACKS.chart2);
	const chart3 = readCssVariable(styles, "--chart-3", FALLBACKS.chart3);
	const chart4 = readCssVariable(styles, "--chart-4", FALLBACKS.chart4);
	const chart5 = readCssVariable(styles, "--chart-5", FALLBACKS.chart5);
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
		chartPalette: [chart1, chart2, chart3, chart4, chart5],
	};
}

/** Subscribe to ThemeProvider's resolved-theme event and refresh tokens. */
export function useThemeTokens(): ThemeTokens {
	const [tokens, setTokens] = useState<ThemeTokens>(getThemeTokens);

	useEffect(() => {
		const refresh = () => setTokens(getThemeTokens());
		window.addEventListener("phoenix-theme-change", refresh);
		return () => window.removeEventListener("phoenix-theme-change", refresh);
	}, []);

	return tokens;
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
