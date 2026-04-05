import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	Calendar,
	Dumbbell,
	HeartPulse,
	Info,
	Link2,
	Moon,
	TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import { FeatureHint } from "@/app/components/FeatureHint";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import { useAuth } from "@/app/hooks/useAuth";
import { useRecoveryScore } from "@/hooks/useRecoveryScore";
import { useSubscription } from "@/hooks/useSubscription";
import { PHOENIX } from "@/lib/colors";
import {
	ACWR_SWEET_SPOT,
	CLAMPING_THRESHOLD_DAYS,
	GATING_THRESHOLD_DAYS,
} from "@/lib/recovery";
import { workoutListOptions } from "@/queries/workouts";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";
import { RecoveryScore } from "./RecoveryScore";

const DISCLAIMER_KEY = "phoenix_recovery_disclaimer_dismissed";

/** Horizontal factor bar */
function FactorBar({
	label,
	value,
	displayValue,
	icon: Icon,
	highlight,
}: {
	label: string;
	value: number;
	displayValue: string;
	icon: React.ComponentType<{ className?: string }>;
	highlight?: { min: number; max: number };
}) {
	const clampedValue = Math.min(100, Math.max(0, value));
	const isInSweet =
		highlight && value >= highlight.min && value <= highlight.max;

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between text-xs sm:text-sm gap-2">
				<div className="flex items-center gap-1.5 sm:gap-2 text-muted-foreground min-w-0">
					<Icon className="w-4 h-4 flex-shrink-0" />
					<span className="truncate">{label}</span>
				</div>
				<span className="text-white font-medium flex-shrink-0">
					{displayValue}
				</span>
			</div>
			<div className="relative h-2 bg-secondary rounded-full overflow-hidden">
				{highlight && (
					<div
						className="absolute h-full bg-success/20 rounded-full"
						style={{
							left: `${highlight.min}%`,
							width: `${highlight.max - highlight.min}%`,
						}}
					/>
				)}
				<motion.div
					className={`h-full rounded-full ${isInSweet ? "bg-success" : "bg-primary"}`}
					initial={{ width: 0 }}
					animate={{ width: `${clampedValue}%` }}
					transition={{ duration: 0.8, ease: "easeOut" }}
				/>
			</div>
		</div>
	);
}

/** Free tier simplified view */
function FreeRecoveryView() {
	const { user } = useAuth();
	const { activeProfileId } = useProfileFilterStore();
	const { data: workouts } = useQuery(
		workoutListOptions(user?.id ?? "", activeProfileId),
	);

	// Count rest days in the last 7 days
	const now = new Date();
	const weekAgo = new Date(now);
	weekAgo.setDate(weekAgo.getDate() - 7);

	const trainingDays = new Set<string>();
	for (const w of workouts ?? []) {
		if (w.started_at >= weekAgo) {
			trainingDays.add(w.started_at.toISOString().slice(0, 10));
		}
	}
	const restDays = 7 - trainingDays.size;

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					className="mb-8"
				>
					<h1 className="text-display-2 mb-2 flex items-center gap-3">
						<HeartPulse className="w-8 h-8 text-primary" />
						<span className="text-white">Recovery</span>
					</h1>
					<p className="text-muted-foreground">
						Track your training recovery and readiness
					</p>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
				>
					<Card className="p-4 sm:p-8 bg-surface-2 border-secondary">
						<div className="flex items-center gap-3 mb-4 sm:mb-6">
							<Moon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
							<h2 className="text-lg sm:text-xl text-white">
								Rest Days This Week
							</h2>
						</div>

						<div className="flex items-center gap-4 sm:gap-6">
							<div className="text-4xl sm:text-5xl font-bold text-primary font-data">
								{restDays}
							</div>
							<div>
								<p className="text-sm sm:text-base text-white mb-1">
									{restDays >= 2
										? "Your rest day frequency appears adequate"
										: restDays === 1
											? "Your training frequency is high this week"
											: "Your training schedule shows no rest days this week"}
								</p>
								<p className="text-sm text-muted-foreground">
									{trainingDays.size} training days in the last 7 days
								</p>
							</div>
						</div>
					</Card>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2 }}
					className="mt-6"
				>
					<Card className="p-6 bg-gradient-to-br from-primary/10 to-chart-2/10 border-primary/30">
						<div className="flex items-center gap-3 mb-3">
							<TrendingUp className="w-5 h-5 text-primary" />
							<h3 className="text-white">Unlock Full Recovery Insights</h3>
						</div>
						<p className="text-sm text-muted-foreground mb-4">
							Premium subscribers get a detailed readiness score based on
							training load analysis, including ACWR ratio, volume trends, and
							wearable data integration.
						</p>
						<Button variant="cta" asChild>
							<Link to="/pricing">View Plans</Link>
						</Button>
					</Card>
				</motion.div>
			</div>
		</div>
	);
}

export function Recovery() {
	const { isPremium } = useSubscription();
	const { recovery, wearable, isLoading, daysSinceFirstSession } =
		useRecoveryScore();

	const [showDisclaimer, setShowDisclaimer] = useState(() => {
		if (typeof window === "undefined") return true;
		return localStorage.getItem(DISCLAIMER_KEY) !== "dismissed";
	});

	// FREE tier: simplified view
	if (!isPremium) return <FreeRecoveryView />;

	if (isLoading) {
		return (
			<div className="min-h-screen pb-20 md:pb-8">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<div className="animate-pulse space-y-6">
						<div className="h-10 w-64 bg-secondary rounded" />
						<div className="h-48 bg-secondary rounded-lg" />
						<div className="h-32 bg-secondary rounded-lg" />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					className="mb-8"
				>
					<FeatureHint
						hintId="recovery-readiness"
						content="Monitor your training load and recovery status based on workout patterns"
						side="bottom"
					>
						<h1 className="text-display-2 mb-2 flex items-center gap-3">
							<HeartPulse className="w-8 h-8 text-primary" />
							<span className="text-white">Recovery Readiness</span>
						</h1>
					</FeatureHint>
					<p className="text-muted-foreground">
						Training load analysis and recovery insights
					</p>
				</motion.div>

				{/* Disclaimer (RCVR-06) */}
				{showDisclaimer && (
					<motion.div
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						className="mb-6"
					>
						<Card className="p-3 sm:p-4 bg-gradient-to-br from-accent/10 to-background border-accent/30">
							<div className="flex items-start gap-2 sm:gap-3">
								<Info className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
								<div className="flex-1">
									<p className="text-sm text-white mb-2">
										Data Source Transparency
									</p>
									<p className="text-xs text-muted-foreground">
										This score is based on your training volume patterns. It is
										not medical advice. Individual recovery varies based on
										sleep, nutrition, stress, and other factors not tracked
										here.
									</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-muted-foreground hover:text-white"
									onClick={() => {
										localStorage.setItem(DISCLAIMER_KEY, "dismissed");
										setShowDisclaimer(false);
									}}
								>
									Dismiss
								</Button>
							</div>
						</Card>
					</motion.div>
				)}

				{/* Gated state */}
				{recovery?.isGated && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.1 }}
					>
						<Card className="p-4 sm:p-8 bg-surface-2 border-secondary">
							<div className="flex flex-col items-center text-center">
								<AlertTriangle className="w-10 h-10 sm:w-12 sm:h-12 text-accent mb-3 sm:mb-4" />
								<h2 className="text-lg sm:text-xl text-white mb-2 sm:mb-3">
									Building Your Recovery Baseline
								</h2>
								<p className="text-sm sm:text-base text-muted-foreground mb-4 sm:mb-6 max-w-md">
									Recovery insights require at least {GATING_THRESHOLD_DAYS}{" "}
									days of training data. You have {daysSinceFirstSession} day
									{daysSinceFirstSession !== 1 ? "s" : ""} so far.
								</p>
								<div className="w-full max-w-xs">
									<Progress
										aria-label="Recovery baseline progress"
										value={Math.min(
											(daysSinceFirstSession / GATING_THRESHOLD_DAYS) * 100,
											100,
										)}
										className="h-3"
									/>
									<p className="text-xs text-muted-foreground mt-2">
										{Math.max(0, GATING_THRESHOLD_DAYS - daysSinceFirstSession)}{" "}
										day
										{Math.max(
											0,
											GATING_THRESHOLD_DAYS - daysSinceFirstSession,
										) !== 1
											? "s"
											: ""}{" "}
										remaining
									</p>
								</div>
							</div>
						</Card>
					</motion.div>
				)}

				{/* Score + factors (ungated) */}
				{recovery && !recovery.isGated && (
					<>
						{/* Clamped notice */}
						{recovery.isClamped && (
							<motion.div
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								className="mb-6"
							>
								<Card className="p-3 bg-accent/10 border-accent/30">
									<div className="flex items-center gap-2 text-sm">
										<Info className="w-4 h-4 text-accent" />
										<p className="text-muted-foreground">
											Your score range is limited while we build a baseline.
											Full range unlocks after {CLAMPING_THRESHOLD_DAYS} days of
											data.
										</p>
									</div>
								</Card>
							</motion.div>
						)}

						{/* Score display */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.1 }}
							className="mb-6"
						>
							<Card className="p-4 sm:p-8 bg-surface-2 border-secondary">
								<div className="flex flex-col items-center">
									<RecoveryScore result={recovery} size="lg" />
									{recovery.isClamped && (
										<Badge className="mt-3 bg-accent/20 text-accent border-accent/30">
											Limited Range (14-30 day baseline)
										</Badge>
									)}
								</div>
							</Card>
						</motion.div>

						{/* Contributing factors */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.2 }}
							className="mb-6"
						>
							<Card className="p-4 sm:p-6 bg-surface-2 border-secondary">
								<h2 className="text-lg sm:text-xl text-white mb-4 sm:mb-6 flex items-center gap-2">
									<Activity className="w-5 h-5 text-primary" />
									Contributing Factors
								</h2>

								<div className="space-y-4 sm:space-y-5">
									{/* ACWR */}
									<FactorBar
										label="Acute:Chronic Workload Ratio"
										value={
											(recovery.factors.acwr / (ACWR_SWEET_SPOT.max * 1.5)) *
											100
										}
										displayValue={recovery.factors.acwr.toFixed(2)}
										icon={TrendingUp}
										highlight={{
											min:
												(ACWR_SWEET_SPOT.min / (ACWR_SWEET_SPOT.max * 1.5)) *
												100,
											max:
												(ACWR_SWEET_SPOT.max / (ACWR_SWEET_SPOT.max * 1.5)) *
												100,
										}}
									/>

									{/* Weekly volume */}
									<FactorBar
										label="Weekly Volume (7d)"
										value={
											recovery.factors.chronicVolume > 0
												? (recovery.factors.weeklyVolume /
														(recovery.factors.chronicVolume / 6) /
														1.5) *
													100
												: 50
										}
										displayValue={`${(recovery.factors.weeklyVolume / 1000).toFixed(1)}k`}
										icon={Dumbbell}
									/>

									{/* Chronic average */}
									<FactorBar
										label="Chronic Average (42d weekly)"
										value={(() => {
											const chronicWeekly = recovery.factors.chronicVolume / 6;
											const peak = Math.max(
												chronicWeekly,
												recovery.factors.weeklyVolume,
											);
											return peak > 0 ? (chronicWeekly / peak) * 100 : 0;
										})()}
										displayValue={`${(recovery.factors.chronicVolume / 6 / 1000).toFixed(1)}k`}
										icon={Calendar}
									/>

									{/* Training frequency */}
									<FactorBar
										label="Training Frequency (7d)"
										value={(recovery.factors.trainingFrequency / 7) * 100}
										displayValue={`${recovery.factors.trainingFrequency} sessions`}
										icon={Activity}
									/>

									{/* Rest days */}
									<FactorBar
										label="Rest Days (7d)"
										value={(recovery.factors.restDays / 7) * 100}
										displayValue={`${recovery.factors.restDays} days`}
										icon={Moon}
									/>

									{/* Cycle position */}
									<div className="space-y-1.5">
										<div className="flex items-center justify-between text-sm">
											<div className="flex items-center gap-2 text-muted-foreground">
												<Calendar className="w-4 h-4" />
												<span>Cycle Position</span>
											</div>
											<span className="text-white font-medium">
												{recovery.factors.cyclePosition ??
													"No active training cycle"}
											</span>
										</div>
									</div>
								</div>
							</Card>
						</motion.div>

						{/* Wearable data section (RCVR-07) */}
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.3 }}
						>
							<Card className="p-4 sm:p-6 bg-surface-2 border-secondary">
								<h2 className="text-lg sm:text-xl text-white mb-3 sm:mb-4 flex items-center gap-2">
									<Link2 className="w-5 h-5 text-primary" />
									Wearable Recovery Data
								</h2>

								{wearable && wearable.length > 0 ? (
									<div className="space-y-3">
										{wearable.map((w, i) => {
											const rawData =
												typeof w.raw_data === "object" && w.raw_data !== null
													? w.raw_data
													: {};
											const hasRecovery =
												"recovery_score" in rawData ||
												"hrv" in rawData ||
												"sleep_score" in rawData;

											return (
												<div
													key={i}
													className="p-3 bg-background/50 rounded-lg border border-secondary"
												>
													<div className="flex items-center justify-between mb-2">
														<Badge className="bg-primary/20 text-primary border-primary/30 capitalize">
															{w.provider}
														</Badge>
														<span className="text-xs text-muted-foreground">
															{w.synced_at.toLocaleDateString()}
														</span>
													</div>
													{hasRecovery ? (
														<div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
															{"recovery_score" in rawData && (
																<div>
																	<p className="text-muted-foreground text-xs">
																		Recovery
																	</p>
																	<p className="text-white">
																		{String(rawData.recovery_score)}
																	</p>
																</div>
															)}
															{"hrv" in rawData && (
																<div>
																	<p className="text-muted-foreground text-xs">
																		HRV
																	</p>
																	<p className="text-white">
																		{String(rawData.hrv)} ms
																	</p>
																</div>
															)}
															{"sleep_score" in rawData && (
																<div>
																	<p className="text-muted-foreground text-xs">
																		Sleep
																	</p>
																	<p className="text-white">
																		{String(rawData.sleep_score)}
																	</p>
																</div>
															)}
														</div>
													) : (
														<p className="text-xs text-muted-foreground">
															No recovery metrics available from this sync
														</p>
													)}
												</div>
											);
										})}
									</div>
								) : (
									<div className="flex flex-col items-center justify-center py-6 text-center">
										<Link2 className="w-8 h-8 text-secondary mb-2" />
										<p className="text-sm text-muted-foreground mb-3">
											No wearable data connected
										</p>
										<Button
											variant="outline"
											size="sm"
											className="border-primary text-primary hover:bg-primary/10"
											asChild
										>
											<Link to="/integrations">Connect a Wearable</Link>
										</Button>
									</div>
								)}
							</Card>
						</motion.div>
					</>
				)}
			</div>
		</div>
	);
}
