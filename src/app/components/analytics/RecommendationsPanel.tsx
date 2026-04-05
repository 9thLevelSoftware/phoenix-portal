import {
	AlertTriangle,
	CheckCircle,
	ChevronDown,
	ChevronUp,
	Info,
	TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { useSubscription } from "@/hooks/useSubscription";
import { PRIORITY_ORDER, type Recommendation } from "@/lib/recommendations";

// --- Props ---

export interface RecommendationsPanelProps {
	recommendations: Recommendation[];
}

// --- Constants ---

const MAX_INITIAL = 8;

const PRIORITY_COLORS: Record<Recommendation["priority"], string> = {
	critical: "#DC2626",
	actionable: "#F59E0B",
	info: "#60A5FA",
	positive: "#10B981",
};

const PRIORITY_BG_COLORS: Record<Recommendation["priority"], string> = {
	critical: "rgba(220, 38, 38, 0.08)",
	actionable: "rgba(245, 158, 11, 0.08)",
	info: "rgba(96, 165, 250, 0.08)",
	positive: "rgba(16, 185, 129, 0.08)",
};

// --- Helpers ---

function getPriorityIcon(priority: Recommendation["priority"]) {
	const color = PRIORITY_COLORS[priority];
	switch (priority) {
		case "critical":
			return (
				<AlertTriangle
					className="w-4 h-4 shrink-0"
					style={{ color }}
					aria-hidden="true"
				/>
			);
		case "actionable":
			return (
				<TrendingUp
					className="w-4 h-4 shrink-0"
					style={{ color }}
					aria-hidden="true"
				/>
			);
		case "info":
			return (
				<Info
					className="w-4 h-4 shrink-0"
					style={{ color }}
					aria-hidden="true"
				/>
			);
		case "positive":
			return (
				<CheckCircle
					className="w-4 h-4 shrink-0"
					style={{ color }}
					aria-hidden="true"
				/>
			);
	}
}

// --- Sub-components ---

interface RecommendationCardProps {
	recommendation: Recommendation;
}

function RecommendationCard({ recommendation }: RecommendationCardProps) {
	const { priority, title, action, metric } = recommendation;
	const borderColor = PRIORITY_COLORS[priority];
	const bgColor = PRIORITY_BG_COLORS[priority];

	return (
		<div
			className="flex items-start gap-3 rounded-md px-3 py-2.5 text-sm"
			style={{
				borderLeft: `2px solid ${borderColor}`,
				backgroundColor: bgColor,
			}}
			role="alert"
		>
			<span className="mt-0.5">{getPriorityIcon(priority)}</span>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-white leading-snug">{title}</p>
				<p className="text-muted-foreground text-xs mt-0.5">{action}</p>
				{metric && (
					<p className="text-muted-foreground text-xs mt-1">
						Current:{" "}
						<span className="font-medium" style={{ color: borderColor }}>
							{metric.current} {metric.unit}
						</span>{" "}
						/ Threshold:{" "}
						<span className="font-medium text-white">
							{metric.threshold} {metric.unit}
						</span>
					</p>
				)}
			</div>
		</div>
	);
}

// --- Main component ---

export function RecommendationsPanel({
	recommendations,
}: RecommendationsPanelProps) {
	const { isInferno } = useSubscription();
	const [expanded, setExpanded] = useState(false);
	const [showAll, setShowAll] = useState(false);

	// Sort by priority
	const sorted = [...recommendations].sort(
		(a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
	);

	const hasMore = sorted.length > MAX_INITIAL;
	const visible = showAll ? sorted : sorted.slice(0, MAX_INITIAL);

	return (
		<div className="relative">
			{/* Always render full component (powers blurred preview) */}
			<Card className="bg-surface-2 border-secondary overflow-hidden">
				{/* Header */}
				<button
					type="button"
					className="w-full flex items-center justify-between px-6 py-4 text-left"
					onClick={() => setExpanded((v) => !v)}
					aria-expanded={expanded}
				>
					<div className="flex items-center gap-3">
						<h3 className="text-xl text-white">Training Recommendations</h3>
						{recommendations.length > 0 && (
							<span
								className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/20 text-primary"
								data-testid="recommendation-count-badge"
							>
								{recommendations.length}
							</span>
						)}
					</div>
					<span className="text-muted-foreground">
						{expanded ? (
							<ChevronUp className="w-5 h-5" aria-hidden="true" />
						) : (
							<ChevronDown className="w-5 h-5" aria-hidden="true" />
						)}
					</span>
				</button>

				{/* Expanded content */}
				{expanded && (
					<div className="px-6 pb-6">
						{sorted.length === 0 ? (
							<div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
								<CheckCircle
									className="w-5 h-5 shrink-0"
									style={{ color: "#10B981" }}
									aria-hidden="true"
								/>
								All looking good — keep up the consistent training!
							</div>
						) : (
							<>
								<div className="space-y-2" data-testid="recommendations-list">
									{visible.map((reco) => (
										<RecommendationCard key={reco.id} recommendation={reco} />
									))}
								</div>

								{hasMore && !showAll && (
									<button
										type="button"
										className="mt-3 text-sm text-primary hover:underline"
										onClick={() => setShowAll(true)}
										data-testid="show-all-button"
									>
										Show all ({sorted.length})
									</button>
								)}
							</>
						)}
					</div>
				)}
			</Card>

			{/* INFERNO gate overlay */}
			{!isInferno && (
				<div
					className="absolute inset-0 backdrop-blur-[8px] bg-surface-2/60 flex items-center justify-center rounded-lg z-10"
					role="region"
					aria-label="Premium feature preview"
				>
					<div className="text-center max-w-sm p-6">
						<h3 className="text-white text-lg mb-2">
							Unlock Training Recommendations
						</h3>
						<p className="text-muted-foreground text-sm mb-4">
							Get prioritized, actionable training advice based on your data.
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
