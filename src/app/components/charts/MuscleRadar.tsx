import { useMemo } from "react";
import { useThemeTokens, withAlpha } from "@/lib/theme-tokens";
import { CHART_COLORS } from "./shared/ChartTheme";
import { EChartsWrapper } from "./shared/EChartsWrapper";

export interface MuscleRadarProps {
	currentData: Record<string, number>;
	previousData?: Record<string, number>;
}

const MUSCLE_GROUPS = ["Chest", "Back", "Arms", "Legs", "Core", "Shoulders"];

export function MuscleRadar({ currentData, previousData }: MuscleRadarProps) {
	const themeTokens = useThemeTokens();
	const chartColors = CHART_COLORS(themeTokens);
	const { border, mutedForeground } = themeTokens;
	const option = useMemo(() => {
		const currentValues = MUSCLE_GROUPS.map((m) => currentData[m] ?? 0);
		const maxValue =
			Math.max(
				...currentValues,
				...(previousData
					? MUSCLE_GROUPS.map((m) => previousData[m] ?? 0)
					: [0]),
				1,
			) * 1.2;

		const indicator = MUSCLE_GROUPS.map((name) => ({
			name,
			max: Math.ceil(maxValue),
		}));

		const series = [];

		if (previousData) {
			series.push({
				type: "radar",
				data: [
					{
						value: MUSCLE_GROUPS.map((m) => previousData[m] ?? 0),
						name: "Previous Period",
						lineStyle: {
							color: mutedForeground,
							type: "dashed",
							width: 1.5,
						},
						areaStyle: {
							color: "transparent",
						},
						itemStyle: {
							color: mutedForeground,
						},
					},
				],
			});
		}

		series.push({
			type: "radar",
			data: [
				{
					value: currentValues,
					name: "Current Period",
					lineStyle: {
						color: chartColors.primary,
						width: 2,
					},
					areaStyle: {
						color: withAlpha(chartColors.primary, 0.3),
					},
					itemStyle: {
						color: chartColors.primary,
					},
				},
			],
		});

		return {
			tooltip: {
				trigger: "item",
				formatter: (params: { name: string; value: number[] }) => {
					const lines = MUSCLE_GROUPS.map(
						(m, i) => `${m}: <b>${params.value[i] ?? 0}</b>`,
					);
					return `<div style="font-weight:600;margin-bottom:4px">${params.name}</div>${lines.join("<br/>")}`;
				},
			},
			legend:
				previousData != null
					? {
							data: ["Current Period", "Previous Period"],
							bottom: 0,
							textStyle: { color: chartColors.axisText, fontSize: 11 },
						}
					: undefined,
			radar: {
				indicator,
				radius: "65%",
				center: previousData != null ? ["50%", "48%"] : ["50%", "50%"],
				axisName: {
					color: chartColors.axisText,
					fontSize: 11,
				},
				axisLine: { lineStyle: { color: border } },
				splitLine: { lineStyle: { color: border } },
				splitArea: { areaStyle: { color: ["transparent"] } },
			},
			series,
		};
	}, [
		currentData,
		previousData,
		chartColors.axisText,
		chartColors.primary,
		border,
		mutedForeground,
	]);

	return <EChartsWrapper option={option} height={300} />;
}
