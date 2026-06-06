import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	ArrowLeft,
	ArrowLeftRight,
	Crown,
	Minus,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import { useNavigate, useSearchParams } from "react-router";
import { FeatureHint } from "@/app/components/FeatureHint";
import { Alert, AlertDescription, AlertTitle } from "@/app/components/ui/alert";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useIsMobile } from "@/app/hooks/useIsMobile";
import { useSubscription } from "@/hooks/useSubscription";
import {
	type ComparisonResult,
	compareSessions,
	type SessionSummary,
} from "@/lib/comparison";
import { comparisonDetailOptions } from "@/queries/workouts";

function DeltaIndicator({
	value,
	suffix = "%",
}: {
	value: number;
	suffix?: string;
}) {
	if (Math.abs(value) < 0.1) {
		return (
			<span className="inline-flex items-center gap-1 text-muted-foreground">
				<Minus className="w-3 h-3" />0{suffix}
			</span>
		);
	}
	if (value > 0) {
		return (
			<span className="inline-flex items-center gap-1 text-success">
				<TrendingUp className="w-3 h-3" />+{value.toFixed(1)}
				{suffix}
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-destructive">
			<TrendingDown className="w-3 h-3" />
			{value.toFixed(1)}
			{suffix}
		</span>
	);
}

function formatVelocity(v: number): string {
	if (v === 0) return "\u2014";
	return `${v.toFixed(2)} m/s`;
}

function formatSessionDate(d: Date): string {
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function SessionSummaryCard({
	summary,
	label,
}: {
	summary: SessionSummary;
	label: string;
}) {
	return (
		<Card className="bg-surface-2 border-secondary p-5">
			<div className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
				{label}
			</div>
			<h3 className="text-lg font-semibold text-white mb-1">{summary.name}</h3>
			<p className="text-sm text-muted-foreground mb-4">
				{summary.startedAt.toLocaleDateString("en-US", {
					weekday: "short",
					month: "short",
					day: "numeric",
					year: "numeric",
				})}
			</p>
			<div className="grid grid-cols-2 gap-4 text-sm">
				<div>
					<div className="text-muted-foreground">Volume</div>
					<div className="text-white font-semibold font-data">
						{summary.totalVolume.toLocaleString()} kg
					</div>
				</div>
				<div>
					<div className="text-muted-foreground">Duration</div>
					<div className="text-white font-semibold font-data">
						{summary.duration}m
					</div>
				</div>
				<div>
					<div className="text-muted-foreground">Exercises</div>
					<div className="text-white font-semibold font-data">
						{summary.exerciseCount}
					</div>
				</div>
				<div>
					<div className="text-muted-foreground">Sets</div>
					<div className="text-white font-semibold font-data">
						{summary.setCount}
					</div>
				</div>
			</div>
		</Card>
	);
}

function OverallDeltas({ result }: { result: ComparisonResult }) {
	return (
		<Card className="bg-surface-2 border-secondary p-5">
			<h3 className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
				Overall Change
			</h3>
			<div className="grid grid-cols-2 gap-6">
				<div>
					<div className="text-sm text-muted-foreground mb-1">Volume</div>
					<div className="text-xl font-semibold font-data">
						<DeltaIndicator value={result.volumeDelta} />
					</div>
				</div>
				<div>
					<div className="text-sm text-muted-foreground mb-1">Duration</div>
					<div className="text-xl font-semibold font-data">
						<DeltaIndicator value={result.durationDelta} />
					</div>
				</div>
			</div>
		</Card>
	);
}

function ExerciseBreakdownTable({ result }: { result: ComparisonResult }) {
	return (
		<Card className="bg-surface-2 border-secondary p-5">
			<h3 className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
				Per-Exercise Breakdown
			</h3>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-secondary">
							<th className="text-left py-2 text-muted-foreground">Exercise</th>
							<th className="text-right py-2 text-muted-foreground">
								A Volume
							</th>
							<th className="text-right py-2 text-muted-foreground">
								B Volume
							</th>
							<th className="text-right py-2 text-muted-foreground">
								Vol Change
							</th>
							<th className="text-right py-2 text-muted-foreground">
								A Velocity
							</th>
							<th className="text-right py-2 text-muted-foreground">
								B Velocity
							</th>
							<th className="text-right py-2 text-muted-foreground">
								Vel Change
							</th>
						</tr>
					</thead>
					<tbody>
						{result.exerciseDeltas.map((ex) => (
							<tr key={ex.name} className="border-b border-secondary/50">
								<td className="py-3 text-white font-medium">{ex.name}</td>
								<td className="py-3 text-right text-secondary-foreground">
									{ex.onlyInB ? (
										<span className="text-muted-foreground">—</span>
									) : (
										`${ex.volumeA.toLocaleString()} kg`
									)}
								</td>
								<td className="py-3 text-right text-secondary-foreground">
									{ex.onlyInA ? (
										<span className="text-muted-foreground">—</span>
									) : (
										`${ex.volumeB.toLocaleString()} kg`
									)}
								</td>
								<td className="py-3 text-right">
									{ex.onlyInA ? (
										<span className="text-muted-foreground text-xs">
											only in A
										</span>
									) : ex.onlyInB ? (
										<span className="text-muted-foreground text-xs">
											only in B
										</span>
									) : (
										<DeltaIndicator value={ex.deltaPct} />
									)}
								</td>
								<td className="py-3 text-right text-secondary-foreground">
									{ex.onlyInB ? (
										<span className="text-muted-foreground">—</span>
									) : (
										formatVelocity(ex.velocityA)
									)}
								</td>
								<td className="py-3 text-right text-secondary-foreground">
									{ex.onlyInA ? (
										<span className="text-muted-foreground">—</span>
									) : (
										formatVelocity(ex.velocityB)
									)}
								</td>
								<td className="py-3 text-right">
									{ex.onlyInA || ex.onlyInB ? (
										<span className="text-muted-foreground">—</span>
									) : ex.velocityA === 0 && ex.velocityB === 0 ? (
										<span className="text-muted-foreground">—</span>
									) : (
										<DeltaIndicator value={ex.velocityDeltaPct} />
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Card>
	);
}

function ExerciseBreakdownMobile({ result }: { result: ComparisonResult }) {
	return (
		<div className="space-y-3">
			<h3 className="text-sm text-muted-foreground uppercase tracking-wider">
				Per-Exercise Breakdown
			</h3>
			{result.exerciseDeltas.map((ex) => (
				<Card key={ex.name} className="bg-surface-2 border-secondary p-4">
					<div className="font-medium text-white mb-3">{ex.name}</div>
					{ex.onlyInA || ex.onlyInB ? (
						<div className="text-sm text-muted-foreground">
							{ex.onlyInA ? "Only in Session A" : "Only in Session B"}
						</div>
					) : (
						<div className="grid grid-cols-3 gap-2 text-sm">
							<div className="text-muted-foreground">Metric</div>
							<div className="text-muted-foreground text-center">A vs B</div>
							<div className="text-muted-foreground text-right">Change</div>

							<div className="text-secondary-foreground">Volume</div>
							<div className="text-center text-secondary-foreground font-data">
								{ex.volumeA.toLocaleString()} / {ex.volumeB.toLocaleString()}
							</div>
							<div className="text-right">
								<DeltaIndicator value={ex.deltaPct} />
							</div>

							{(ex.velocityA > 0 || ex.velocityB > 0) && (
								<>
									<div className="text-secondary-foreground">Velocity</div>
									<div className="text-center text-secondary-foreground">
										{formatVelocity(ex.velocityA)} /{" "}
										{formatVelocity(ex.velocityB)}
									</div>
									<div className="text-right">
										<DeltaIndicator value={ex.velocityDeltaPct} />
									</div>
								</>
							)}
						</div>
					)}
				</Card>
			))}
		</div>
	);
}

export function ComparisonView() {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const isMobile = useIsMobile();
	const { isPremium, isLoading: subLoading } = useSubscription();

	const sessionAId = searchParams.get("a") ?? "";
	const sessionBId = searchParams.get("b") ?? "";

	const {
		data: summaryA,
		isPending: pendingA,
		error: errorA,
	} = useQuery({
		...comparisonDetailOptions(sessionAId),
		enabled: isPremium && !!sessionAId,
	});
	const {
		data: summaryB,
		isPending: pendingB,
		error: errorB,
	} = useQuery({
		...comparisonDetailOptions(sessionBId),
		enabled: isPremium && !!sessionBId,
	});

	// Tier gate: FREE users see upgrade prompt
	if (!subLoading && !isPremium) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
					</div>
				</div>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
					<Crown className="w-12 h-12 text-warning mx-auto mb-4" />
					<h2 className="text-2xl font-semibold text-white mb-2">
						Premium Feature
					</h2>
					<p className="text-muted-foreground mb-6 max-w-md mx-auto">
						Workout comparison is available on Phoenix and Elite plans. Upgrade
						to compare sessions side by side and track your progress.
					</p>
					<Button onClick={() => navigate("/pricing")} variant="cta">
						View Plans
					</Button>
				</div>
			</div>
		);
	}

	// Same-session validation (COMP-06)
	if (sessionAId && sessionBId && sessionAId === sessionBId) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
					</div>
				</div>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
					<AlertCircle className="w-12 h-12 text-chart-2 mx-auto mb-4" />
					<h2 className="text-xl font-semibold text-white mb-2">
						Cannot compare a session with itself
					</h2>
					<p className="text-muted-foreground">
						Select two different sessions to compare.
					</p>
					<Button
						onClick={() => navigate("/history")}
						variant="cta"
						className="mt-6"
					>
						Return to History
					</Button>
				</div>
			</div>
		);
	}

	// Missing params
	if (!sessionAId || !sessionBId) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
					</div>
				</div>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
					<AlertCircle className="w-12 h-12 text-chart-2 mx-auto mb-4" />
					<h2 className="text-xl font-semibold text-white mb-2">
						Missing Session IDs
					</h2>
					<p className="text-muted-foreground">
						Navigate here from Workout History to compare two sessions.
					</p>
					<Button
						onClick={() => navigate("/history")}
						variant="cta"
						className="mt-6"
					>
						Go to History
					</Button>
				</div>
			</div>
		);
	}

	// Loading
	if (pendingA || pendingB || subLoading) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
						<Skeleton className="h-10 w-64 mb-2 bg-surface-2" />
						<Skeleton className="h-5 w-48 bg-surface-2" />
					</div>
				</div>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<Skeleton className="h-48 bg-surface-2 rounded-lg" />
						<Skeleton className="h-48 bg-surface-2 rounded-lg" />
					</div>
					<Skeleton className="h-32 bg-surface-2 rounded-lg" />
					<Skeleton className="h-64 bg-surface-2 rounded-lg" />
				</div>
			</div>
		);
	}

	// Error
	if (errorA || errorB || !summaryA || !summaryB) {
		return (
			<div className="min-h-screen pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
					<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
					</div>
				</div>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
					<AlertCircle className="w-12 h-12 text-chart-2 mx-auto mb-4" />
					<h2 className="text-xl font-semibold text-white mb-2">
						Failed to Load Sessions
					</h2>
					<p className="text-muted-foreground">
						{errorA?.message ||
							errorB?.message ||
							"One or both sessions could not be loaded."}
					</p>
					<Button
						onClick={() => navigate("/history")}
						variant="cta"
						className="mt-6"
					>
						Return to History
					</Button>
				</div>
			</div>
		);
	}

	const swapSessions = () => {
		setSearchParams({ a: sessionBId, b: sessionAId });
	};

	const result = compareSessions(summaryA, summaryB);

	return (
		<div className="min-h-screen pb-24 md:pb-8">
			{/* Header */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40">
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
						<FeatureHint
							hintId="workout-comparison"
							content="Compare two workout sessions side-by-side to track progression"
							side="bottom"
						>
							<h1 className="text-display-2 mb-2 text-white">
								Session Comparison
							</h1>
						</FeatureHint>
						<div className="flex items-center gap-3 flex-wrap text-sm">
							<span className="text-muted-foreground">
								<span className="font-medium text-white">A</span> ·{" "}
								{summaryA.name} ·{" "}
								<time
									dateTime={summaryA.startedAt.toISOString()}
									className="text-muted-foreground/80"
									suppressHydrationWarning
								>
									{formatSessionDate(summaryA.startedAt)}
								</time>
							</span>
							<span className="text-muted-foreground/60">vs</span>
							<span className="text-muted-foreground">
								<span className="font-medium text-white">B</span> ·{" "}
								{summaryB.name} ·{" "}
								<time
									dateTime={summaryB.startedAt.toISOString()}
									className="text-muted-foreground/80"
									suppressHydrationWarning
								>
									{formatSessionDate(summaryB.startedAt)}
								</time>
							</span>
							<Button
								variant="outline"
								size="sm"
								onClick={swapSessions}
								className="border-secondary text-muted-foreground hover:border-primary hover:text-primary"
								aria-label="Swap sessions A and B"
							>
								<ArrowLeftRight className="w-4 h-4 mr-2" />
								Swap
							</Button>
						</div>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
				{/* Warning */}
				{result.warning && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<Alert className="border-warning/50 bg-warning/10">
							<AlertCircle className="h-4 w-4 text-warning" />
							<AlertTitle className="text-warning">
								Limited Comparison
							</AlertTitle>
							<AlertDescription>{result.warning}</AlertDescription>
						</Alert>
					</motion.div>
				)}

				{/* Session summaries */}
				{isMobile ? (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
					>
						<Tabs defaultValue="a">
							<TabsList className="w-full">
								<TabsTrigger value="a">Session A</TabsTrigger>
								<TabsTrigger value="b">Session B</TabsTrigger>
							</TabsList>
							<TabsContent value="a">
								<SessionSummaryCard summary={summaryA} label="Session A" />
							</TabsContent>
							<TabsContent value="b">
								<SessionSummaryCard summary={summaryB} label="Session B" />
							</TabsContent>
						</Tabs>
					</motion.div>
				) : (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
						className="grid grid-cols-2 gap-4"
					>
						<SessionSummaryCard summary={summaryA} label="Session A" />
						<SessionSummaryCard summary={summaryB} label="Session B" />
					</motion.div>
				)}

				{/* Overall deltas */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2 }}
				>
					<OverallDeltas result={result} />
				</motion.div>

				{/* Per-exercise breakdown */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.3 }}
				>
					{isMobile ? (
						<ExerciseBreakdownMobile result={result} />
					) : (
						<ExerciseBreakdownTable result={result} />
					)}
				</motion.div>
			</div>
		</div>
	);
}
