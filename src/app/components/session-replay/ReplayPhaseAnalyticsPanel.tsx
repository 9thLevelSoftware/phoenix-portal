import {
	CartesianGrid,
	Legend,
	ResponsiveContainer,
	Scatter,
	ScatterChart,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import type {
	ReplayPhase,
	ReplayPhaseAnalytics,
	ReplayPhaseSegment,
} from "@/lib/replay-phase-analytics";

export interface ReplayPhaseAnalyticsPanelProps {
	analytics: ReplayPhaseAnalytics;
}

interface PhasePoint {
	positionMm: number;
	value: number;
	phase: ReplayPhase;
	repNumber: number | null;
}

const PHASE_COLORS: Record<ReplayPhase, string> = {
	concentric: "#FF6B35",
	eccentric: "#38BDF8",
};

function formatEnergy(joules: number): string {
	if (joules >= 1000) return `${(joules / 1000).toFixed(1)} kJ`;
	return `${joules.toFixed(1)} J`;
}

function phasePoints(
	segments: ReplayPhaseSegment[],
	metric: "force" | "velocity",
	phase: ReplayPhase,
): PhasePoint[] {
	return segments
		.filter((segment) => segment.phase === phase)
		.map((segment) => ({
			positionMm: segment.endPositionMm,
			value: metric === "force" ? segment.avgForceN : segment.avgVelocityMps,
			phase: segment.phase,
			repNumber: segment.repNumber,
		}));
}

function EnergyCard({
	label,
	value,
	share,
}: {
	label: string;
	value: number;
	share?: number;
}) {
	return (
		<div className="rounded-lg bg-surface-2 p-3">
			<p className="text-[11px] uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<p className="mt-1 text-lg font-semibold text-white">
				{formatEnergy(value)}
			</p>
			{share != null && (
				<p className="text-xs text-muted-foreground">{share}% of total</p>
			)}
		</div>
	);
}

function PhaseScatter({
	title,
	segments,
	metric,
	yLabel,
}: {
	title: string;
	segments: ReplayPhaseSegment[];
	metric: "force" | "velocity";
	yLabel: string;
}) {
	const concentric = phasePoints(segments, metric, "concentric");
	const eccentric = phasePoints(segments, metric, "eccentric");

	return (
		<div className="rounded-lg border border-secondary bg-background/40 p-3">
			<p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
			<ResponsiveContainer width="100%" height={180}>
				<ScatterChart margin={{ top: 8, right: 12, bottom: 12, left: 0 }}>
					<CartesianGrid stroke="#2A2A35" strokeDasharray="3 3" />
					<XAxis
						type="number"
						dataKey="positionMm"
						name="Position"
						unit=" mm"
						tick={{ fill: "#888894", fontSize: 10 }}
						axisLine={{ stroke: "#374151" }}
					/>
					<YAxis
						type="number"
						dataKey="value"
						name={yLabel}
						tick={{ fill: "#888894", fontSize: 10 }}
						axisLine={{ stroke: "#374151" }}
						width={42}
					/>
					<Tooltip
						cursor={{ strokeDasharray: "3 3" }}
						contentStyle={{
							backgroundColor: "#0a0a10",
							border: "1px solid #374151",
							borderRadius: 6,
							fontSize: 11,
						}}
						formatter={(value: number) =>
							metric === "force"
								? [`${value.toFixed(1)} N`, yLabel]
								: [`${value.toFixed(3)} m/s`, yLabel]
						}
						labelFormatter={(label) => `Position ${label} mm`}
					/>
					<Legend wrapperStyle={{ fontSize: 11 }} />
					<Scatter
						name="Concentric"
						data={concentric}
						fill={PHASE_COLORS.concentric}
					/>
					<Scatter
						name="Eccentric"
						data={eccentric}
						fill={PHASE_COLORS.eccentric}
					/>
				</ScatterChart>
			</ResponsiveContainer>
		</div>
	);
}

export function ReplayPhaseAnalyticsPanel({
	analytics,
}: ReplayPhaseAnalyticsPanelProps) {
	if (analytics.status === "empty" || analytics.segments.length === 0) {
		return (
			<Card
				className="p-4 bg-surface-2 border-secondary"
				data-testid="replay-phase-analytics-panel"
			>
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold text-white">Phase Analytics</h3>
					{analytics.status === "partial" && (
						<Badge variant="outline" className="text-[10px]">
							Partial
						</Badge>
					)}
				</div>
				<p className="mt-2 text-sm text-muted-foreground">
					Phase analytics unavailable
					{analytics.partialReason ? `: ${analytics.partialReason}` : "."}
				</p>
			</Card>
		);
	}

	return (
		<Card
			className="space-y-4 p-4 bg-surface-2 border-secondary"
			data-testid="replay-phase-analytics-panel"
		>
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 className="text-sm font-semibold text-white">Phase Analytics</h3>
					<p className="text-xs text-muted-foreground">
						Energy from average force across position change
					</p>
				</div>
				{analytics.status === "partial" && (
					<Badge variant="outline" className="text-[10px]">
						Partial
					</Badge>
				)}
			</div>
			{analytics.partialReason && (
				<p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
					{analytics.partialReason}
				</p>
			)}
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<EnergyCard
					label="Total energy"
					value={analytics.summary.totalEnergyJ}
				/>
				<EnergyCard
					label="Concentric"
					value={analytics.summary.concentricEnergyJ}
					share={analytics.summary.concentricSharePct}
				/>
				<EnergyCard
					label="Eccentric"
					value={analytics.summary.eccentricEnergyJ}
					share={analytics.summary.eccentricSharePct}
				/>
			</div>
			<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<PhaseScatter
					title="Force vs position"
					segments={analytics.segments}
					metric="force"
					yLabel="Force"
				/>
				<PhaseScatter
					title="Velocity vs position"
					segments={analytics.segments}
					metric="velocity"
					yLabel="Velocity"
				/>
			</div>
		</Card>
	);
}
