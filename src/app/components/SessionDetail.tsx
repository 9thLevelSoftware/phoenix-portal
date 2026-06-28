import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	ArrowLeft,
	Award,
	BarChart3,
	ChevronDown,
	ChevronUp,
	Clock,
	Dumbbell,
	Flame,
	Printer,
	Settings,
	Share2,
	Shield,
	TrendingUp,
	Zap,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ComparisonSessionPicker } from "@/app/components/ComparisonSessionPicker";
import { SubscriptionGate } from "@/app/components/SubscriptionGate";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
import phoenixLogo from "@/assets/phoenix-logo-fallback.png";
import { useSubscription } from "@/hooks/useSubscription";
import { displayExerciseName } from "@/lib/exercise-display";
import { formatVolume, formatWeight } from "@/lib/units";
import { useAuth } from "@/providers/AuthProvider";
import { profileOptions } from "@/queries/profile";
import { sessionDetailOptions } from "@/queries/workouts";

export function SessionDetail() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();
	const { user } = useAuth();
	const {
		data: session,
		isPending,
		error,
	} = useQuery({
		...sessionDetailOptions(sessionId ?? ""),
		enabled: !!sessionId,
	});
	const { data: profile } = useQuery({
		...profileOptions(user?.id ?? ""),
		enabled: !!user?.id,
	});
	const { isPremium } = useSubscription();
	const [expandedExercises, setExpandedExercises] = useState<string[] | null>(
		null,
	);
	const [pickerOpen, setPickerOpen] = useState(false);
	const unit = profile?.weight_unit === "lbs" ? "lbs" : "kg";

	if (!sessionId) {
		return <Navigate to="/history" replace />;
	}

	const toggleExercise = (exerciseId: string) => {
		setExpandedExercises((prev) => {
			const current = prev ?? [];
			return current.includes(exerciseId)
				? current.filter((id) => id !== exerciseId)
				: [...current, exerciseId];
		});
	};

	const getMuscleGroupColor = (muscleGroup: string) => {
		const colors: Record<string, string> = {
			Chest: "bg-primary",
			Shoulders: "bg-accent",
			Back: "bg-success",
			Legs: "bg-chart-2",
			Arms: "bg-warning",
			Core: "bg-[#8B5CF6]",
		};
		return colors[muscleGroup] || "bg-muted";
	};

	// Loading state
	if (isPending) {
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
					<Card className="bg-surface-2 border-secondary p-6">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
							{[1, 2, 3, 4].map((i) => (
								<div key={i} className="text-center space-y-2">
									<Skeleton className="h-4 w-20 mx-auto bg-surface-2" />
									<Skeleton className="h-8 w-16 mx-auto bg-surface-2" />
								</div>
							))}
						</div>
					</Card>
					{[1, 2, 3].map((i) => (
						<Card key={i} className="bg-surface-2 border-secondary p-4">
							<div className="flex items-center gap-3">
								<Skeleton className="h-10 w-10 rounded-lg bg-surface-2" />
								<div className="space-y-2">
									<Skeleton className="h-5 w-40 bg-surface-2" />
									<Skeleton className="h-4 w-20 bg-surface-2" />
								</div>
							</div>
						</Card>
					))}
				</div>
			</div>
		);
	}

	// Error state
	if (error || !session) {
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
						Session Not Found
					</h2>
					<p className="text-muted-foreground">
						{error
							? error.message
							: "This workout session could not be loaded."}
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

	// Compute summary stats from real data
	const totalSets = session.exercises.reduce(
		(sum, ex) => sum + ex.sets.length,
		0,
	);
	const prCount = session.exercises.reduce(
		(sum, ex) => sum + ex.sets.filter((s) => s.is_pr).length,
		0,
	);

	// Auto-expand first exercise on initial load, but allow collapsing all
	const effectiveExpanded =
		expandedExercises === null && session.exercises.length > 0
			? [session.exercises[0].id]
			: (expandedExercises ?? []);

	return (
		<div className="min-h-screen pb-24 md:pb-8">
			{/* Print-only report header (visible only in print) */}
			<div className="print-only mb-6 border-b border-gray-300 pb-4">
				<h1 className="text-2xl font-bold text-black">{session.name}</h1>
				<div className="flex gap-6 text-sm text-gray-600 mt-2">
					<span>Date: {session.started_at.toLocaleDateString()}</span>
					{session.routine_name && <span>Routine: {session.routine_name}</span>}
					<span>Duration: {session.duration_seconds} min</span>
					<span>Volume: {formatVolume(session.total_volume, unit)}</span>
				</div>
			</div>

			{/* Header */}
			<div
				className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40"
				data-print-hide
			>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<div className="flex items-center gap-2 mb-4">
							<Button
								variant="outline"
								size="sm"
								onClick={() => navigate("/history")}
								className="border-secondary text-muted-foreground hover:border-primary hover:text-primary print:hidden"
							>
								<ArrowLeft className="w-4 h-4 mr-2" />
								Back to History
							</Button>
							<SubscriptionGate requiredTier="FLAME" fallback={null}>
								<Button
									variant="outline"
									size="sm"
									onClick={() => window.print()}
									className="border-secondary text-muted-foreground hover:border-primary hover:text-primary print:hidden"
									data-print-hide
								>
									<Printer className="w-4 h-4 mr-2" />
									Print Report
								</Button>
							</SubscriptionGate>
						</div>

						<h1 className="text-display-2 mb-2 text-white">{session.name}</h1>
						<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<span>
								{session.started_at.toLocaleDateString("en-US", {
									weekday: "long",
									month: "long",
									day: "numeric",
									year: "numeric",
								})}
							</span>
							<span>
								{session.started_at.toLocaleTimeString("en-US", {
									hour: "numeric",
									minute: "2-digit",
								})}
							</span>
							{session.routine_name && (
								<>
									<span>-</span>
									<Badge
										variant="outline"
										className="border-primary/30 text-primary"
									>
										{session.routine_name}
									</Badge>
								</>
							)}
							{session.workout_mode && (
								<Badge
									variant="outline"
									className="border-accent/30 text-accent"
								>
									{session.workout_mode}
								</Badge>
							)}
						</div>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
				{/* Stats Card */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
				>
					<Card className="bg-surface-2 border-secondary p-6">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Clock className="w-5 h-5 text-primary" />
									<div className="text-sm text-muted-foreground">Duration</div>
								</div>
								<div className="text-2xl font-semibold text-white font-data">
									{session.duration_seconds}m
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<TrendingUp className="w-5 h-5 text-success" />
									<div className="text-sm text-muted-foreground">Volume</div>
								</div>
								<div className="text-2xl font-semibold text-white font-data">
									{formatVolume(session.total_volume, unit)}
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Dumbbell className="w-5 h-5 text-accent" />
									<div className="text-sm text-muted-foreground">Sets</div>
								</div>
								<div className="text-2xl font-semibold text-white font-data">
									{totalSets}
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Award className="w-5 h-5 text-warning" />
									<div className="text-sm text-muted-foreground">PRs</div>
								</div>
								<div className="text-2xl font-semibold text-primary font-data">
									{prCount}
								</div>
							</div>
							{session.estimated_calories != null && (
								<div className="text-center">
									<div className="flex items-center justify-center gap-2 mb-2">
										<Flame className="w-5 h-5 text-primary" />
										<div className="text-sm text-muted-foreground">
											Calories
										</div>
									</div>
									<div className="text-2xl font-semibold text-white font-data">
										{Math.round(session.estimated_calories)}
									</div>
								</div>
							)}
							{session.heaviest_lift_kg != null && (
								<div className="text-center">
									<div className="flex items-center justify-center gap-2 mb-2">
										<Zap className="w-5 h-5 text-accent" />
										<div className="text-sm text-muted-foreground">
											Heaviest Lift
										</div>
									</div>
									<div className="text-2xl font-semibold text-white font-data">
										{formatWeight(session.heaviest_lift_kg, unit)}
									</div>
								</div>
							)}
						</div>
					</Card>
				</motion.div>

				{/* Biomechanics Summary */}
				{session.avg_velocity_mps != null && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.15 }}
					>
						<Card className="bg-surface-2 border-secondary p-6">
							<div className="flex items-center gap-2 mb-4">
								<Activity className="w-5 h-5 text-primary" />
								<h3 className="text-lg font-semibold text-white">
									Biomechanics Summary
								</h3>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
								<div>
									<div className="text-sm text-muted-foreground mb-1">
										Avg Velocity
									</div>
									<div className="text-lg font-semibold text-white font-data">
										{session.avg_velocity_mps.toFixed(2)}{" "}
										<span className="text-sm text-muted-foreground">m/s</span>
									</div>
								</div>
								{session.avg_asymmetry_pct != null && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Asymmetry
										</div>
										<div className="text-lg font-semibold text-white font-data">
											{session.avg_asymmetry_pct.toFixed(1)}%
										</div>
									</div>
								)}
								{session.velocity_loss_pct != null && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Velocity Loss
										</div>
										<div className="text-lg font-semibold text-white font-data">
											{session.velocity_loss_pct.toFixed(1)}%
										</div>
									</div>
								)}
								{session.dominant_side && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Dominant Side
										</div>
										<div className="text-lg font-semibold text-white">
											{session.dominant_side}
										</div>
									</div>
								)}
								{session.strength_profile && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Strength Profile
										</div>
										<div className="text-lg font-semibold text-white">
											{session.strength_profile}
										</div>
									</div>
								)}
							</div>
						</Card>
					</motion.div>
				)}

				{/* Safety & Form */}
				{(session.form_score != null ||
					(session.deload_warnings ?? 0) > 0 ||
					(session.rom_violations ?? 0) > 0 ||
					(session.spotter_activations ?? 0) > 0) && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.15 }}
					>
						<Card className="bg-surface-2 border-secondary p-6">
							<div className="flex items-center gap-2 mb-4">
								<Shield className="w-5 h-5 text-success" />
								<h3 className="text-lg font-semibold text-white">
									Safety & Form
								</h3>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
								{session.form_score != null && (
									<div>
										<div className="text-sm text-muted-foreground mb-2">
											Form Score
										</div>
										<div className="flex items-center gap-3">
											<div className="flex-1 h-2.5 rounded-full bg-secondary overflow-hidden">
												<div
													className={`h-full rounded-full transition-all ${
														session.form_score >= 80
															? "bg-success"
															: session.form_score >= 50
																? "bg-warning"
																: "bg-chart-2"
													}`}
													style={{
														width: `${Math.min(session.form_score, 100)}%`,
													}}
												/>
											</div>
											<span className="text-lg font-semibold text-white font-data">
												{session.form_score}
											</span>
										</div>
									</div>
								)}
								{(session.deload_warnings ?? 0) > 0 && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Deload Warnings
										</div>
										<div className="text-lg font-semibold text-warning font-data">
											{session.deload_warnings}
										</div>
									</div>
								)}
								{(session.rom_violations ?? 0) > 0 && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											ROM Violations
										</div>
										<div className="text-lg font-semibold text-chart-2 font-data">
											{session.rom_violations}
										</div>
									</div>
								)}
								{(session.spotter_activations ?? 0) > 0 && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Spotter Activations
										</div>
										<div className="text-lg font-semibold text-accent font-data">
											{session.spotter_activations}
										</div>
									</div>
								)}
							</div>
						</Card>
					</motion.div>
				)}

				{/* Session Config */}
				{(session.eccentric_load != null ||
					session.echo_level != null ||
					session.warmup_reps != null ||
					session.working_reps != null) && (
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.15 }}
					>
						<Card className="bg-surface-2 border-secondary p-6">
							<div className="flex items-center gap-2 mb-4">
								<Settings className="w-5 h-5 text-accent" />
								<h3 className="text-lg font-semibold text-white">
									Session Config
								</h3>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
								{session.eccentric_load != null && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Eccentric Load
										</div>
										<div className="text-lg font-semibold text-white font-data">
											{session.eccentric_load}
										</div>
									</div>
								)}
								{session.echo_level != null && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Echo Level
										</div>
										<div className="text-lg font-semibold text-white font-data">
											{session.echo_level}
										</div>
									</div>
								)}
								{session.warmup_reps != null && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Warmup Reps
										</div>
										<div className="text-lg font-semibold text-white font-data">
											{session.warmup_reps}
										</div>
									</div>
								)}
								{session.working_reps != null && (
									<div>
										<div className="text-sm text-muted-foreground mb-1">
											Working Reps
										</div>
										<div className="text-lg font-semibold text-white font-data">
											{session.working_reps}
										</div>
									</div>
								)}
							</div>
						</Card>
					</motion.div>
				)}

				{/* Exercise Breakdown */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2 }}
				>
					<h2 className="text-2xl font-semibold text-white mb-4">
						Exercise Breakdown
					</h2>
					<div className="space-y-3">
						{session.exercises.map((exercise, index) => (
							<motion.div
								key={exercise.id}
								initial={{ opacity: 0, y: 20 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ delay: 0.3 + index * 0.05 }}
							>
								<Card className="exercise-card bg-surface-2 border-secondary overflow-hidden">
									{/* Exercise Header */}
									<button
										type="button"
										onClick={() => toggleExercise(exercise.id)}
										className="w-full p-4 flex items-center justify-between hover:bg-surface-2/50 transition-colors"
									>
										<div className="flex items-center gap-3">
											<div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
												<Dumbbell className="w-5 h-5 text-white" />
											</div>
											<div className="text-left">
												<div className="flex items-center gap-2">
													<h3 className="text-lg font-semibold text-white">
														{displayExerciseName(exercise.name)}
													</h3>
													{exercise.hasPR && (
														<Flame className="w-4 h-4 text-accent" />
													)}
												</div>
												<Badge
													className={`${getMuscleGroupColor(
														exercise.muscle_group,
													)} text-white border-0 mt-1`}
												>
													{exercise.muscle_group}
												</Badge>
											</div>
										</div>
										<div className="flex items-center gap-4">
											<span className="text-sm text-muted-foreground">
												{exercise.sets.length} sets
											</span>
											{effectiveExpanded.includes(exercise.id) ? (
												<ChevronUp className="w-5 h-5 text-muted-foreground" />
											) : (
												<ChevronDown className="w-5 h-5 text-muted-foreground" />
											)}
										</div>
									</button>

									{/* Exercise Sets Table */}
									{effectiveExpanded.includes(exercise.id) && (
										<div className="border-t border-secondary p-4">
											<div className="overflow-x-auto">
												<table className="w-full text-sm">
													<thead>
														<tr className="border-b border-secondary">
															<th className="text-left py-2 text-muted-foreground">
																Set
															</th>
															<th className="text-left py-2 text-muted-foreground">
																Target
															</th>
															<th className="text-left py-2 text-muted-foreground">
																Actual
															</th>
															<th className="text-left py-2 text-muted-foreground">
																Weight
															</th>
															<th className="text-left py-2 text-muted-foreground">
																RPE
															</th>
															<th className="text-left py-2 text-muted-foreground">
																Notes
															</th>
														</tr>
													</thead>
													<tbody>
														{exercise.sets.map((set) => (
															<tr
																key={set.set_number}
																className={`border-b border-secondary/50 ${
																	set.is_pr
																		? "border-l-4 border-l-[#F59E0B]"
																		: ""
																}`}
															>
																<td className="py-3 text-white font-semibold font-data">
																	{set.set_number}
																</td>
																<td className="py-3 text-secondary-foreground font-data">
																	{set.target_reps}
																</td>
																<td className="py-3 text-secondary-foreground font-data">
																	{set.actual_reps}
																</td>
																<td className="py-3 text-secondary-foreground font-data">
																	{formatWeight(set.weight_kg, unit)}
																</td>
																<td className="py-3 text-secondary-foreground font-data">
																	{set.rpe ?? "-"}
																</td>
																<td className="py-3">
																	{set.is_pr && (
																		<Badge className="bg-accent text-white border-0">
																			NEW PR
																		</Badge>
																	)}
																	{set.notes && !set.is_pr && (
																		<span className="text-muted-foreground">
																			{set.notes}
																		</span>
																	)}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									)}
								</Card>
							</motion.div>
						))}
					</div>
				</motion.div>

				{/* Actions */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.4 }}
					className="flex flex-col sm:flex-row gap-3 print:hidden"
				>
					{isPremium ? (
						<Button
							variant="cta"
							className="flex-1"
							onClick={() => setPickerOpen(true)}
						>
							<BarChart3 className="w-4 h-4 mr-2" />
							Compare with...
						</Button>
					) : (
						<Button
							className="flex-1 border-secondary text-muted-foreground"
							variant="outline"
							disabled
							title="Upgrade to compare sessions"
						>
							<BarChart3 className="w-4 h-4 mr-2" />
							Compare with...
						</Button>
					)}
					<Button
						variant="outline"
						className="flex-1 border-secondary text-muted-foreground hover:border-primary hover:text-primary"
						onClick={() => toast("Session sharing coming in a future update")}
					>
						<Share2 className="w-4 h-4 mr-2" />
						Share Summary
					</Button>
				</motion.div>

				{/* Comparison Session Picker */}
				<div className="print:hidden">
					<ComparisonSessionPicker
						open={pickerOpen}
						onClose={() => setPickerOpen(false)}
						excludeSessionId={sessionId}
						onSelect={(selectedSessionId) =>
							navigate(`/compare?a=${sessionId}&b=${selectedSessionId}`)
						}
					/>
				</div>

				{/* Notes Section */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.5 }}
					className="print:hidden"
				>
					<Card className="bg-surface-2 border-secondary p-4">
						<h3 className="text-lg font-semibold text-white mb-3">
							Workout Notes
						</h3>
						{session.notes ? (
							<div className="rounded-lg border border-secondary bg-background p-3 text-white whitespace-pre-wrap">
								{session.notes}
							</div>
						) : (
							<div className="rounded-lg border border-dashed border-secondary bg-background p-3 text-sm text-muted-foreground">
								Completed workout sessions are treated as immutable once they
								sync from the mobile app, so notes are read-only in the portal.
							</div>
						)}
					</Card>
				</motion.div>

				{/* Print-only branding footer */}
				<div className="print-only mt-8 border-t border-gray-300 pt-4 text-center text-sm text-gray-500">
					<img
						src={phoenixLogo}
						alt="Phoenix Portal"
						className="h-8 mx-auto mb-2"
					/>
					<p>
						Generated by Phoenix Portal &mdash;{" "}
						{new Date().toLocaleDateString()}
					</p>
				</div>
			</div>
		</div>
	);
}
