import {
	CHART_COLORS,
	CHART_MARGINS,
	FONT_SIZES,
	REP_COLORS,
} from "./ChartTheme";

/** ECharts theme object matching the Phoenix dark palette */
export const PHOENIX_ECHARTS_THEME = {
	color: [
		CHART_COLORS.primary, // #FF6B35 Ember
		CHART_COLORS.secondary, // #F59E0B Gold
		CHART_COLORS.success, // #10B981 Forge Green
		CHART_COLORS.danger, // #DC2626 Flame Red
		"#6366F1", // Indigo (accent)
		"#EC4899", // Pink
		"#06B6D4", // Cyan
		"#8B5CF6", // Purple
	],
	backgroundColor: "transparent",
	textStyle: {
		color: CHART_COLORS.axisText,
		fontFamily: "system-ui, sans-serif",
	},
	title: {
		textStyle: {
			color: "#ffffff",
			fontSize: FONT_SIZES.title,
			fontWeight: 600,
		},
	},
	categoryAxis: {
		axisLine: { lineStyle: { color: "#333" } },
		axisTick: { lineStyle: { color: "#333" } },
		axisLabel: { color: CHART_COLORS.axisText, fontSize: FONT_SIZES.axis },
		splitLine: { lineStyle: { color: "#1a1a2e" } },
	},
	valueAxis: {
		axisLine: { lineStyle: { color: "#333" } },
		axisTick: { lineStyle: { color: "#333" } },
		axisLabel: { color: CHART_COLORS.axisText, fontSize: FONT_SIZES.axis },
		splitLine: { lineStyle: { color: "#1a1a2e", type: "dashed" } },
	},
	tooltip: {
		backgroundColor: CHART_COLORS.tooltipBg,
		borderColor: CHART_COLORS.tooltipBorder,
		textStyle: { color: "#ffffff", fontSize: 12 },
	},
	legend: {
		textStyle: { color: CHART_COLORS.axisText },
	},
	radar: {
		axisLine: { lineStyle: { color: "#333" } },
		splitLine: { lineStyle: { color: "#2a2a2a" } },
		splitArea: { areaStyle: { color: ["transparent"] } },
	},
	gauge: {
		axisLine: {
			lineStyle: {
				color: [
					[0.3, "#10B981"],
					[0.7, "#F59E0B"],
					[1, "#DC2626"],
				],
			},
		},
	},
} as const;

/** ECharts-compatible margins */
export const ECHARTS_GRID = {
	top: CHART_MARGINS.top,
	right: CHART_MARGINS.right,
	bottom: CHART_MARGINS.bottom,
	left: CHART_MARGINS.left,
	containLabel: true,
} as const;

export { CHART_COLORS, CHART_MARGINS, FONT_SIZES, REP_COLORS };
