import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart, LineChart, PieChart, RadarChart, GaugeChart } from "echarts/charts";
import {
	GridComponent,
	TooltipComponent,
	LegendComponent,
	TitleComponent,
	DataZoomComponent,
	ToolboxComponent,
} from "echarts/components";
import { useEffect, useRef } from "react";
import { PHOENIX_ECHARTS_THEME } from "./EChartsTheme";

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
]);

// Register theme once
echarts.registerTheme("phoenix", PHOENIX_ECHARTS_THEME);

/**
 * Shared ECharts wrapper with Phoenix theme, responsive sizing, and loading state.
 * Uses tree-shakeable imports to minimize bundle size (~200-300KB vs ~800KB full).
 * Option updates fully replace the previous config (notMerge=true).
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

	// Handle responsive resize
	useEffect(() => {
		const handleResize = () => chartRef.current?.getEchartsInstance()?.resize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	return (
		<ReactEChartsCore
			ref={chartRef}
			echarts={echarts}
			option={option}
			theme="phoenix"
			style={{ height, width: "100%" }}
			className={className}
			showLoading={loading}
			loadingOption={{
				text: "",
				color: "#FF6B35",
				maskColor: "rgba(13, 13, 13, 0.8)",
			}}
			onEvents={onEvents}
			notMerge
		/>
	);
}
