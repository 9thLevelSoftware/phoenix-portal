import { BodyChart, type BodyState, ViewSide } from "body-muscles";
import { useEffect, useMemo, useRef } from "react";
import type { BodyMuscleFocusModel } from "@/lib/body-muscle-analytics";

export interface BodyMuscleHeatmapProps {
	model: BodyMuscleFocusModel;
	side: "front" | "back";
	selectedMuscleId: string | null;
	onSelectMuscle: (muscleId: string) => void;
	className?: string;
}

export function BodyMuscleHeatmap({
	model,
	side,
	selectedMuscleId,
	onSelectMuscle,
	className,
}: BodyMuscleHeatmapProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<BodyChart | null>(null);
	const selectRef = useRef(onSelectMuscle);
	selectRef.current = onSelectMuscle;

	const bodyState = useMemo<BodyState>(() => {
		const state: BodyState = {};
		for (const muscle of model.muscles) {
			state[muscle.muscleId] = {
				intensity: muscle.intensity,
				selected: muscle.muscleId === selectedMuscleId,
			};
		}
		return state;
	}, [model.muscles, selectedMuscleId]);

	const view = side === "front" ? ViewSide.FRONT : ViewSide.BACK;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		if (!chartRef.current) {
			chartRef.current = new BodyChart(container, {
				view,
				bodyState,
				ariaLabel: "Detailed muscle contribution body map",
				showViewLabel: false,
				onMuscleClick: (muscleId) => selectRef.current(muscleId),
			});
			return;
		}

		chartRef.current.update({ view, bodyState });
	}, [bodyState, view]);

	useEffect(() => {
		return () => {
			chartRef.current?.destroy();
			chartRef.current = null;
		};
	}, []);

	return (
		<div
			ref={containerRef}
			className={className}
			data-testid="body-muscle-heatmap"
			style={{ minHeight: 420 }}
		/>
	);
}
