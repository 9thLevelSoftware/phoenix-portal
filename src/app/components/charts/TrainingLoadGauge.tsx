import { useMemo } from "react";
import { useThemeTokens } from "@/lib/theme-tokens";
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

export function TrainingLoadGauge({ score, zone }: TrainingLoadGaugeProps) {
	const themeTokens = useThemeTokens();
	const clamped = Math.min(Math.max(score, 0), 100);
	const zoneColor =
		zone === "low"
			? themeTokens.success
			: zone === "optimal"
				? themeTokens.accent
				: themeTokens.danger;
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
								[0.35, themeTokens.success],
								[0.75, themeTokens.accent],
								[1, themeTokens.danger],
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
							borderColor: themeTokens.surface1,
							borderWidth: 2,
						},
					},
					detail: {
						valueAnimation: true,
						formatter: "{value}",
						color: themeTokens.primaryForeground,
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
		[clamped, zoneColor, zoneLabel, themeTokens],
	);

	return <EChartsWrapper option={option} height={200} />;
}
