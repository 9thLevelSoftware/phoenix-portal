import type { LucideIcon } from "lucide-react";
import { Clock } from "lucide-react";
import { EChartsWrapper } from "@/app/components/charts/shared/EChartsWrapper";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import type { ProgressionWorkbenchModel } from "@/lib/progression-workbench";
import type { WeightUnit } from "@/lib/units";
import {
	WORKOUT_PHASE_FILTERS,
	type WorkoutPhaseFilter,
} from "@/lib/workout-phases";
import { ProgressionWorkbench } from "./ProgressionWorkbench";
import type {
	PhaseMetricPair,
	PhaseMetricSummary,
} from "./phaseStatisticsTransforms";

type ChartOption = Record<string, unknown>;

interface Insight {
	type: "positive" | "warning" | "neutral";
	title: string;
	description: string;
	icon: LucideIcon;
}

export interface ProgressTabProps {
	unit: WeightUnit;
	strengthEChartsOption: ChartOption | null;
	volumeAreaOption: ChartOption | null;
	prCount: number;
	daysSinceLastPR: number | null;
	strengthExercises: string[];
	insights: Insight[];
	phaseFilter: WorkoutPhaseFilter;
	onPhaseFilterChange: (phase: WorkoutPhaseFilter) => void;
	phaseMetricSummary: PhaseMetricSummary;
	progressionModel: ProgressionWorkbenchModel;
	onSelectProgressionExercise: (exerciseName: string) => void;
}

function formatMetric(value: number, decimals = 1): string {
	return value.toFixed(decimals).replace(/\.0$/, "");
}

function PhaseMetricPanel({
	title,
	pair,
	unit,
	decimals = 1,
}: {
	title: string;
	pair: PhaseMetricPair;
	unit: string;
	decimals?: number;
}) {
	return (
		<div className="rounded-lg border border-secondary bg-muted/10 p-4">
			<div className="text-sm font-semibold text-white mb-3">{title}</div>
			<div className="grid grid-cols-2 gap-4">
				<div>
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Concentric
					</div>
					<div className="mt-1 text-lg font-bold text-primary">
						{formatMetric(pair.concentricMax, decimals)} {unit}
					</div>
					<div className="text-xs text-muted-foreground">
						avg {formatMetric(pair.concentricAvg, decimals)} {unit}
					</div>
				</div>
				<div>
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Eccentric
					</div>
					<div className="mt-1 text-lg font-bold text-primary">
						{formatMetric(pair.eccentricMax, decimals)} {unit}
					</div>
					<div className="text-xs text-muted-foreground">
						avg {formatMetric(pair.eccentricAvg, decimals)} {unit}
					</div>
				</div>
			</div>
		</div>
	);
}

export default function ProgressTab({
	unit,
	strengthEChartsOption,
	volumeAreaOption,
	prCount,
	daysSinceLastPR,
	strengthExercises,
	insights,
	phaseFilter,
	onPhaseFilterChange,
	phaseMetricSummary,
	progressionModel,
	onSelectProgressionExercise,
}: ProgressTabProps) {
	return (
		<>
			<Card className="p-6 bg-surface-2 border-secondary">
				<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
					<div>
						<h3 className="text-xl text-white">Phase Load, Speed & Power</h3>
						<p className="text-sm text-muted-foreground mt-1">
							{phaseMetricSummary.rowCount} sessions with phase samples
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{WORKOUT_PHASE_FILTERS.map((phase) => (
							<Button
								key={phase}
								type="button"
								size="sm"
								variant={phaseFilter === phase ? "default" : "outline"}
								onClick={() => onPhaseFilterChange(phase)}
								className={
									phaseFilter === phase
										? ""
										: "border-secondary text-muted-foreground hover:text-white"
								}
							>
								{phase === "all" ? "All" : phase}
							</Button>
						))}
					</div>
				</div>
				{phaseMetricSummary.rowCount > 0 ? (
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
						<PhaseMetricPanel
							title="Load"
							pair={phaseMetricSummary.load}
							unit={unit}
						/>
						<PhaseMetricPanel
							title="Velocity"
							pair={phaseMetricSummary.velocity}
							unit="m/s"
							decimals={2}
						/>
						<PhaseMetricPanel
							title="Power"
							pair={phaseMetricSummary.power}
							unit="W"
							decimals={0}
						/>
					</div>
				) : (
					<div className="h-[140px] flex items-center justify-center text-muted-foreground">
						No phase statistics for this period
					</div>
				)}
			</Card>

			<ProgressionWorkbench
				model={progressionModel}
				unit={unit}
				onSelectExercise={onSelectProgressionExercise}
			/>

			{/* 1RM Progression */}
			<Card className="p-6 bg-surface-2 border-secondary">
				<h3 className="text-xl text-white mb-6">
					Phase Strength Progression ({unit})
				</h3>
				{strengthEChartsOption ? (
					<EChartsWrapper option={strengthEChartsOption} height={400} />
				) : (
					<div className="h-[400px] flex items-center justify-center text-muted-foreground">
						No strength progress data for this phase
					</div>
				)}
			</Card>

			{/* Volume & Frequency Trends */}
			<Card className="p-6 bg-surface-2 border-secondary">
				<h3 className="text-xl text-white mb-6">Volume & Frequency Trends</h3>
				{volumeAreaOption ? (
					<EChartsWrapper option={volumeAreaOption} height={300} />
				) : (
					<div className="h-[300px] flex items-center justify-center text-muted-foreground">
						No volume data for this period
					</div>
				)}
			</Card>

			{/* PR Timeline + Insights */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* PR Timeline */}
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-4">Personal Records</h3>
					<div className="flex items-center gap-6 mb-4">
						<div className="flex flex-col items-center justify-center rounded-xl bg-primary/10 px-6 py-4">
							<span className="text-3xl font-bold text-primary">{prCount}</span>
							<span className="text-xs text-muted-foreground mt-1">
								phase PRs
							</span>
						</div>
						{daysSinceLastPR != null && (
							<div className="flex flex-col items-center justify-center rounded-xl bg-muted/20 px-6 py-4">
								<div className="flex items-center gap-1.5">
									<Clock className="w-4 h-4 text-muted-foreground" />
									<span className="text-3xl font-bold text-white">
										{daysSinceLastPR}
									</span>
								</div>
								<span className="text-xs text-muted-foreground mt-1">
									days since last PR
								</span>
							</div>
						)}
					</div>
					{strengthExercises.length > 0 && (
						<div className="text-sm text-muted-foreground">
							Tracking: {strengthExercises.join(", ")}
						</div>
					)}
				</Card>

				{/* Insight cards (legacy style) */}
				<Card className="p-6 bg-surface-2 border-secondary">
					<h3 className="text-xl text-white mb-4">Trend Insights</h3>
					<div className="flex flex-col gap-3">
						{insights.map((insight) => (
							<div
								key={insight.title}
								className={`flex items-start gap-3 p-3 rounded-lg border ${
									insight.type === "positive"
										? "bg-success/5 border-success/30"
										: insight.type === "warning"
											? "bg-warning/5 border-warning/30"
											: "bg-muted/5 border-muted/30"
								}`}
							>
								<div
									className={`p-2 rounded-lg ${
										insight.type === "positive"
											? "bg-success/20"
											: insight.type === "warning"
												? "bg-warning/20"
												: "bg-muted/20"
									}`}
								>
									<insight.icon
										className={`w-4 h-4 ${
											insight.type === "positive"
												? "text-success"
												: insight.type === "warning"
													? "text-warning"
													: "text-muted-foreground"
										}`}
									/>
								</div>
								<div className="flex-1 min-w-0">
									<h4 className="text-sm font-semibold text-white">
										{insight.title}
									</h4>
									<p className="text-xs text-muted-foreground mt-0.5">
										{insight.description}
									</p>
								</div>
							</div>
						))}
					</div>
				</Card>
			</div>
		</>
	);
}
