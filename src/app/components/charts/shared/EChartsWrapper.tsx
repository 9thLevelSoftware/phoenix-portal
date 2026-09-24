import {
	BarChart,
	GaugeChart,
	LineChart,
	PieChart,
	RadarChart,
} from "echarts/charts";
import {
	DataZoomComponent,
	GridComponent,
	LegendComponent,
	MarkLineComponent,
	TitleComponent,
	ToolboxComponent,
	TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { useEffect, useMemo, useRef } from "react";
import {
	type ThemeTokens,
	useThemeTokens,
	withAlpha,
} from "@/lib/theme-tokens";
import { getPhoenixEchartsTheme } from "./EChartsTheme";

// Register required components (tree-shakeable)
echarts.use([
	CanvasRenderer,
	BarChart,
	LineChart,
	PieChart,
	RadarChart,
	GaugeChart,
	GridComponent,
	TooltipComponent,
	LegendComponent,
	TitleComponent,
	DataZoomComponent,
	ToolboxComponent,
	MarkLineComponent,
]);

const CSS_VARIABLES: Record<string, string> = {
	"--primary": "primary",
	"--primary-foreground": "primaryForeground",
	"--accent": "accent",
	"--accent-foreground": "accentForeground",
	"--destructive": "danger",
	"--success": "success",
	"--warning": "warning",
	"--foreground": "foreground",
	"--background": "background",
	"--border": "border",
	"--muted": "muted",
	"--muted-foreground": "mutedForeground",
	"--surface-1": "surface1",
	"--surface-2": "surface2",
	"--surface-3": "surface3",
	"--cable-a": "cableA",
	"--cable-b": "cableB",
	"--chart-1": "chart1",
	"--chart-2": "chart2",
	"--chart-3": "chart3",
	"--chart-4": "chart4",
	"--chart-5": "chart5",
	"--chart-6": "chart6",
	"--chart-7": "chart7",
	"--chart-8": "chart8",
};

function resolveCssValue(value: string, tokens: ThemeTokens): string {
	const resolved = value.replace(
		/var\(\s*(--[\w-]+)\s*\)/g,
		(_match, variable: string) => {
			const tokenKey = CSS_VARIABLES[variable];
			if (tokenKey && tokenKey in tokens) {
				return String(tokens[tokenKey as keyof ThemeTokens]);
			}
			if (typeof document !== "undefined") {
				return (
					getComputedStyle(document.documentElement)
						.getPropertyValue(variable)
						.trim() || variable
				);
			}
			return variable;
		},
	);
	const colorMix = resolved.match(
		/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\)$/,
	);
	if (colorMix) return withAlpha(colorMix[1], Number(colorMix[2]) / 100);
	return resolved;
}

function resolveChartOption<T>(value: T, tokens: ThemeTokens): T {
	if (typeof value === "string") {
		return resolveCssValue(value, tokens) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => resolveChartOption(item, tokens)) as T;
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				resolveChartOption(item, tokens),
			]),
		) as T;
	}
	return value;
}

/**
 * Shared ECharts wrapper with Phoenix theme, responsive sizing, and loading state.
 * Uses tree-shakeable imports to minimize bundle size (~200-300KB vs ~800KB full).
 * Option updates fully replace the previous config (notMerge=true).
 * Canvas colors resolve CSS variables / color-mix() to concrete values so light
 * and dark themes both paint correctly.
 */
interface EChartsWrapperProps {
	option: echarts.EChartsCoreOption;
	height?: string | number;
	className?: string;
	loading?: boolean;
	onEvents?: Record<string, (params: unknown) => void>;
}

export function EChartsWrapper({
	option,
	height = 300,
	className,
	loading,
	onEvents,
}: EChartsWrapperProps) {
	const chartRef = useRef<ReactEChartsCore>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	// A stable snapshot that changes only when the theme does, so both memos
	// below hold between renders.
	const resolvedTokens = useThemeTokens();
	const resolvedOption = useMemo(
		() => resolveChartOption(option, resolvedTokens),
		[option, resolvedTokens],
	);
	// Passed as an object, not a registered name: echarts-for-react deep-compares
	// the theme prop and re-initialises the chart when it changes, so theme-level
	// defaults (palette, axes, tooltip) follow a theme switch. A fixed
	// registered name never changes, so existing charts kept the old theme.
	const theme = useMemo(
		() => getPhoenixEchartsTheme(resolvedTokens),
		[resolvedTokens],
	);

	// Handle responsive resize: window resize plus container-size changes
	// (tabs/cards/sidebars can resize the chart without a window resize).
	useEffect(() => {
		const resize = () => chartRef.current?.getEchartsInstance()?.resize();
		window.addEventListener("resize", resize);

		let observer: ResizeObserver | undefined;
		if (typeof ResizeObserver !== "undefined" && containerRef.current) {
			observer = new ResizeObserver(() => resize());
			observer.observe(containerRef.current);
		}

		return () => {
			window.removeEventListener("resize", resize);
			observer?.disconnect();
		};
	}, []);

	return (
		<div ref={containerRef} style={{ width: "100%", height }}>
			<ReactEChartsCore
				ref={chartRef}
				echarts={echarts}
				option={resolvedOption}
				theme={theme}
				style={{ height: "100%", width: "100%" }}
				className={className}
				showLoading={loading}
				loadingOption={{
					text: "",
					color: resolvedTokens.primary,
					maskColor: withAlpha(resolvedTokens.background, 0.8),
				}}
				onEvents={onEvents}
				notMerge
			/>
		</div>
	);
}
