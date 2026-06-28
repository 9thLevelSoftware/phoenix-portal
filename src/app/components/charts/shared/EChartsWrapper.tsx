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
	MarkLineComponent,
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
	const containerRef = useRef<HTMLDivElement>(null);

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
				option={option}
				theme="phoenix"
				style={{ height: "100%", width: "100%" }}
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
		</div>
	);
}
