import { useMemo } from "react";
import { CHART_COLORS } from "./shared/EChartsTheme";
import { EChartsWrapper } from "./shared/EChartsWrapper";

export interface MuscleRadarProps {
	currentData: Record<string, number>;
	previousData?: Record<string, number>;
}

const MUSCLE_GROUPS = ["Chest", "Back", "Arms", "Legs", "Core", "Shoulders"];

export function MuscleRadar({ currentData, previousData }: MuscleRadarProps) {
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
							color: "#6B7280",
							type: "dashed",
							width: 1.5,
						},
						areaStyle: {
							color: "transparent",
						},
						itemStyle: {
							color: "#6B7280",
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
						color: CHART_COLORS.primary,
						width: 2,
					},
					areaStyle: {
						color: `${CHART_COLORS.primary}4D`,
					},
					itemStyle: {
						color: CHART_COLORS.primary,
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
							textStyle: { color: CHART_COLORS.axisText, fontSize: 11 },
						}
					: undefined,
			radar: {
				indicator,
				radius: "65%",
				center: previousData != null ? ["50%", "48%"] : ["50%", "50%"],
				axisName: {
					color: CHART_COLORS.axisText,
					fontSize: 11,
				},
				axisLine: { lineStyle: { color: "#333" } },
				splitLine: { lineStyle: { color: "#2a2a2a" } },
				splitArea: { areaStyle: { color: ["transparent"] } },
			},
			series,
		};
	}, [currentData, previousData]);

	return <EChartsWrapper option={option} height={300} />;
}
