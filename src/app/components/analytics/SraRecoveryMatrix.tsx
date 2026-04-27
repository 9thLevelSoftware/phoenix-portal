import { AlertTriangle, CheckCircle, Clock, Zap } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { useSubscription } from "@/hooks/useSubscription";
import type { Recommendation } from "@/lib/recommendations";
import type { MuscleRecovery, SraStatus } from "@/lib/sra-recovery";

// --- Props ---

export interface SraRecoveryMatrixProps {
	recoveries: MuscleRecovery[];
	recommendations?: Recommendation[];
}

// --- Constants ---

const STATUS_COLORS: Record<SraStatus, string> = {
	FATIGUED: "#DC2626",
	RECOVERING: "#F59E0B",
	RECOVERED: "#10B981",
	SUPERCOMPENSATED: "#60A5FA",
};

const STATUS_LABELS: Record<SraStatus, string> = {
	FATIGUED: "Fatigued",
	RECOVERING: "Recovering",
	RECOVERED: "Recovered",
	SUPERCOMPENSATED: "Supercompensated",
};

const STATUS_BG_COLORS: Record<SraStatus, string> = {
	FATIGUED: "rgba(220, 38, 38, 0.08)",
	RECOVERING: "rgba(245, 158, 11, 0.08)",
	RECOVERED: "rgba(16, 185, 129, 0.08)",
	SUPERCOMPENSATED: "rgba(96, 165, 250, 0.08)",
};

const SRA_SIGNAL_TYPES = new Set([
	"sra_supercompensated",
	"sra_fatigued",
	"sra_recovered",
]);

// --- Helpers ---

function getRecoIcon(signal: string) {
	if (signal === "sra_supercompensated") {
		return (
			<Zap
				className="w-4 h-4"
				style={{ color: "#60A5FA" }}
				aria-hidden="true"
			/>
		);
	}
	if (signal === "sra_recovered") {
		return (
			<CheckCircle
				className="w-4 h-4"
				style={{ color: "#10B981" }}
				aria-hidden="true"
			/>
		);
	}
	// sra_fatigued
	return (
		<AlertTriangle
			className="w-4 h-4"
			style={{ color: "#F59E0B" }}
			aria-hidden="true"
		/>
	);
}

function getRecoBorderColor(signal: string): string {
	if (signal === "sra_supercompensated") return "#60A5FA";
	if (signal === "sra_recovered") return "#10B981";
	return "#F59E0B";
}

function getRecoBgColor(signal: string): string {
	if (signal === "sra_supercompensated") return "rgba(96,165,250,0.08)";
	if (signal === "sra_recovered") return "rgba(16,185,129,0.08)";
	return "rgba(245,158,11,0.08)";
}

// --- Sub-components ---

interface MuscleGroupCardProps {
	recovery: MuscleRecovery;
}

function MuscleGroupCard({ recovery }: MuscleGroupCardProps) {
	const { muscleGroup, status, hoursSinceLastTrained, hoursRemaining } =
		recovery;

	const color = STATUS_COLORS[status];
	const label = STATUS_LABELS[status];
	const bgColor = STATUS_BG_COLORS[status];
	const isNoData = hoursSinceLastTrained === 0;
	const showRemaining =
		!isNoData &&
		(status === "FATIGUED" || status === "RECOVERING") &&
		hoursRemaining !== null;

	return (
		<div
			className="rounded-lg p-3 flex items-start gap-3"
			style={{ backgroundColor: bgColor }}
			data-testid={`sra-card-${muscleGroup.toLowerCase()}`}
		>
			{/* Status dot */}
			<span
				className="mt-0.5 shrink-0 w-2 h-2 rounded-full"
				style={{ backgroundColor: color, marginTop: "4px" }}
				aria-label={`Status: ${label}`}
				role="img"
			/>

			{/* Text content */}
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-white leading-snug">
					{muscleGroup}
				</p>

				{isNoData ? (
					<p className="text-xs text-muted-foreground mt-0.5">No data</p>
				) : (
					<>
						<p className="text-xs font-medium mt-0.5" style={{ color }}>
							{label}
						</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							{hoursSinceLastTrained}h since last session
						</p>
						{showRemaining && (
							<p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
								<Clock className="w-3 h-3" aria-hidden="true" />~
								{hoursRemaining}h remaining
							</p>
						)}
					</>
				)}
			</div>
		</div>
	);
}

interface SraRecommendationCalloutProps {
	recommendation: Recommendation;
}

function SraRecommendationCallout({
	recommendation,
}: SraRecommendationCalloutProps) {
	const borderColor = getRecoBorderColor(recommendation.signal);
	const bgColor = getRecoBgColor(recommendation.signal);

	return (
		<div
			className="flex items-start gap-3 rounded-md px-3 py-2 text-sm"
			style={{
				borderLeft: `2px solid ${borderColor}`,
				backgroundColor: bgColor,
			}}
		>
			<span className="mt-0.5 shrink-0">
				{getRecoIcon(recommendation.signal)}
			</span>
			<div className="min-w-0">
				<p className="font-medium text-white leading-snug">
					{recommendation.title}
				</p>
				<p className="text-muted-foreground text-xs mt-0.5">
					{recommendation.action}
				</p>
			</div>
		</div>
	);
}

// --- Main component ---

export function SraRecoveryMatrix({
	recoveries,
	recommendations = [],
}: SraRecoveryMatrixProps) {
	const { isInferno } = useSubscription();

	const sraRecos = recommendations.filter((r) =>
		SRA_SIGNAL_TYPES.has(r.signal),
	);

	return (
		<div className="relative">
			{/* Always render the full component (powers blurred preview) */}
			<Card className="p-6 bg-surface-2 border-secondary">
				<h3 className="text-xl text-white mb-5">SRA Recovery Matrix</h3>

				{recoveries.length === 0 ? (
					<div className="py-10 text-center text-muted-foreground text-sm">
						No recovery data — train to see your muscle readiness
					</div>
				) : (
					<>
						{/* 2-column grid of muscle group cards */}
						<div className="grid grid-cols-2 gap-3" data-testid="sra-grid">
							{recoveries.map((recovery) => (
								<MuscleGroupCard
									key={recovery.muscleGroup}
									recovery={recovery}
								/>
							))}
						</div>

						{/* Inline SRA recommendation callouts */}
						{sraRecos.length > 0 && (
							<div className="mt-5 space-y-2" data-testid="sra-recommendations">
								{sraRecos.map((reco) => (
									<SraRecommendationCallout
										key={reco.id}
										recommendation={reco}
									/>
								))}
							</div>
						)}
					</>
				)}
			</Card>

			{/* INFERNO gate overlay — only shown when not INFERNO */}
			{!isInferno && (
				// biome-ignore lint/a11y/useSemanticElements: overlay gate needs role="region" for accessibility context
				<div
					className="absolute inset-0 backdrop-blur-[8px] bg-surface-2/60 flex items-center justify-center rounded-lg z-10"
					role="region"
					aria-label="Premium feature preview"
				>
					<div className="text-center max-w-sm p-6">
						<h3 className="text-white text-lg mb-2">
							Unlock Training Intelligence
						</h3>
						<p className="text-muted-foreground text-sm mb-4">
							SRA Recovery tracking tells you exactly when each muscle group is
							ready to train again.
						</p>
						<Button variant="cta" asChild>
							<Link to="/pricing">Upgrade to Inferno</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
