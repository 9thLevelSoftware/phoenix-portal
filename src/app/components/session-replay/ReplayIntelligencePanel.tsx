import { AlertTriangle, Gauge, Target, Zap } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import type { ReplayIntelligence } from "@/lib/replay-intelligence";

interface ReplayIntelligencePanelProps {
	intelligence: ReplayIntelligence;
	currentRepIndex: number;
}

function MetricTile({
	label,
	value,
	icon: Icon,
}: {
	label: string;
	value: string;
	icon: typeof Gauge;
}) {
	return (
		<div className="rounded-lg border border-secondary bg-muted/10 p-3">
			<div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
				<Icon className="size-3.5" aria-hidden="true" />
				<span>{label}</span>
			</div>
			<div className="text-xl font-semibold text-white">{value}</div>
		</div>
	);
}

export function ReplayIntelligencePanel({
	intelligence,
	currentRepIndex,
}: ReplayIntelligencePanelProps) {
	if (intelligence.status === "empty") {
		return (
			<Card className="border-secondary bg-surface-2 p-4 text-sm text-muted-foreground">
				No telemetry intelligence is available for this set.
			</Card>
		);
	}

	const selectedRep =
		intelligence.repInsights[currentRepIndex] ?? intelligence.repInsights[0];

	return (
		<Card className="space-y-4 border-secondary bg-surface-2 p-4">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 className="text-lg font-semibold text-white">
						Replay Intelligence
					</h2>
					<p className="text-sm text-muted-foreground">
						Client-derived from rep summaries and telemetry samples.
					</p>
				</div>
				{intelligence.status === "partial" && intelligence.partialReason && (
					<div className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs text-warning">
						<AlertTriangle className="size-3.5" aria-hidden="true" />
						<span>{intelligence.partialReason}</span>
					</div>
				)}
			</div>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<MetricTile
					label="Velocity loss"
					value={`${Math.round(intelligence.velocityLossPct)}%`}
					icon={Zap}
				/>
				<MetricTile
					label="Fatigue slope"
					value={`${intelligence.fatigueSlopePctPerRep}%/rep`}
					icon={Gauge}
				/>
				<MetricTile
					label="Rep consistency"
					value={`${Math.round(intelligence.repConsistencyPct)}%`}
					icon={Target}
				/>
				<MetricTile
					label="Peak force"
					value={`${Math.round(intelligence.forcePeakN)} N`}
					icon={Gauge}
				/>
			</div>

			{selectedRep && (
				<div className="rounded-lg border border-secondary bg-background/50 p-3">
					<div className="mb-2 flex items-center justify-between gap-3">
						<div className="font-semibold text-white">
							Rep {selectedRep.repNumber}
						</div>
						<div className="text-xs text-muted-foreground">
							{selectedRep.meanVelocityMps.toFixed(2)} m/s avg
						</div>
					</div>
					<div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
						<span>Loss {Math.round(selectedRep.velocityLossPct)}%</span>
						<span>Peak {Math.round(selectedRep.peakForceN)} N</span>
						<span>{selectedRep.peakVelocityMps.toFixed(2)} m/s peak</span>
						<span>{selectedRep.endMs - selectedRep.startMs} ms window</span>
					</div>
					{selectedRep.stickingPoint && (
						<div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
							Sticking point at {selectedRep.stickingPoint.positionMm} mm with{" "}
							{selectedRep.stickingPoint.velocityMps.toFixed(2)} m/s velocity.
						</div>
					)}
				</div>
			)}
		</Card>
	);
}
