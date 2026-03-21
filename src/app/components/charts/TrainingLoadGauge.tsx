import { useMemo } from "react";
import { CHART_COLORS } from "./shared/EChartsTheme";
import { EChartsWrapper } from "./shared/EChartsWrapper";

export interface TrainingLoadGaugeProps {
	score: number;
	zone: "low" | "optimal" | "high";
}

const ZONE_LABELS: Record<string, string> = {
	low: "Low",
	optimal: "Optimal",
	high: "High",
};

const ZONE_COLORS: Record<string, string> = {
	low: CHART_COLORS.success,
	optimal: CHART_COLORS.secondary,
	high: CHART_COLORS.danger,
};

export function TrainingLoadGauge({ score, zone }: TrainingLoadGaugeProps) {
	const clamped = Math.min(Math.max(score, 0), 100);
	const zoneColor = ZONE_COLORS[zone];
	const zoneLabel = ZONE_LABELS[zone];

	const option = useMemo(
		() => ({
			series: [
				{
					type: "gauge",
					startAngle: 200,
					endAngle: -20,
					min: 0,
					max: 100,
					radius: "90%",
					center: ["50%", "55%"],
					axisLine: {
						lineStyle: {
							width: 16,
							color: [
								[0.35, CHART_COLORS.success],
								[0.75, CHART_COLORS.secondary],
								[1, CHART_COLORS.danger],
							],
						},
					},
					axisTick: { show: false },
					splitLine: { show: false },
					axisLabel: { show: false },
					pointer: {
						itemStyle: {
							color: zoneColor,
						},
						length: "65%",
						width: 5,
					},
					anchor: {
						show: true,
						showAbove: true,
						size: 12,
						itemStyle: {
							color: zoneColor,
							borderColor: "#1a1a1a",
							borderWidth: 2,
						},
					},
					detail: {
						valueAnimation: true,
						formatter: "{value}",
						color: "#ffffff",
						fontSize: 28,
						fontWeight: 700,
						offsetCenter: [0, "-10%"],
					},
					title: {
						offsetCenter: [0, "20%"],
						fontSize: 13,
						color: zoneColor,
						fontWeight: 600,
					},
					data: [
						{
							value: clamped,
							name: zoneLabel,
						},
					],
				},
			],
		}),
		[clamped, zoneColor, zoneLabel],
	);

	return <EChartsWrapper option={option} height={200} />;
}
