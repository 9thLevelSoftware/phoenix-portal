import { useQuery } from "@tanstack/react-query";
import {
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
	Share2,
	TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
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
import { useSaveSessionNotes } from "@/mutations/workouts";
import { sessionDetailOptions } from "@/queries/workouts";

export function SessionDetail() {
	const { sessionId } = useParams<{ sessionId: string }>();
	const navigate = useNavigate();
	const {
		data: session,
		isPending,
		error,
	} = useQuery({
		...sessionDetailOptions(sessionId ?? ""),
		enabled: !!sessionId,
	});
	const { isPremium } = useSubscription();
	const [expandedExercises, setExpandedExercises] = useState<string[] | null>(
		null,
	);
	const [notes, setNotes] = useState("");
	const [pickerOpen, setPickerOpen] = useState(false);
	const saveNotes = useSaveSessionNotes();

	// Load existing notes from session
	useEffect(() => {
		if (session?.notes) setNotes(session.notes);
	}, [session?.notes]);

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
			<div className="min-h-screen bg-background pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40 backdrop-blur-xl">
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
					<Card className="bg-gradient-to-br from-surface-2 to-background border-secondary p-6">
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
						<Card
							key={i}
							className="bg-gradient-to-br from-surface-2 to-background border-secondary p-4"
						>
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
			<div className="min-h-screen bg-background pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40 backdrop-blur-xl">
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
						className="mt-6 bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
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
			: expandedExercises ?? [];

	return (
		<div className="min-h-screen bg-background pb-24 md:pb-8">
			{/* Print-only report header (visible only in print) */}
			<div className="print-only mb-6 border-b border-gray-300 pb-4">
				<h1 className="text-2xl font-bold text-black">{session.name}</h1>
				<div className="flex gap-6 text-sm text-gray-600 mt-2">
					<span>Date: {session.started_at.toLocaleDateString()}</span>
					{session.routine_name && <span>Routine: {session.routine_name}</span>}
					<span>Duration: {session.duration_seconds} min</span>
					<span>Volume: {session.total_volume.toLocaleString()} kg</span>
				</div>
			</div>

			{/* Header */}
			<div
				className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40 backdrop-blur-xl"
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
							<SubscriptionGate requiredTier="PHOENIX" fallback={null}>
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

						<h1 className="text-3xl sm:text-4xl mb-2">
							<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
								{session.name}
							</span>
						</h1>
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
					<Card className="bg-gradient-to-br from-surface-2 to-background border-secondary p-6">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Clock className="w-5 h-5 text-primary" />
									<div className="text-sm text-muted-foreground">Duration</div>
								</div>
								<div className="text-2xl font-semibold text-white">
									{session.duration_seconds}m
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<TrendingUp className="w-5 h-5 text-success" />
									<div className="text-sm text-muted-foreground">Volume</div>
								</div>
								<div className="text-2xl font-semibold text-white">
									{session.total_volume.toLocaleString()} kg
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Dumbbell className="w-5 h-5 text-accent" />
									<div className="text-sm text-muted-foreground">Sets</div>
								</div>
								<div className="text-2xl font-semibold text-white">
									{totalSets}
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Award className="w-5 h-5 text-warning" />
									<div className="text-sm text-muted-foreground">PRs</div>
								</div>
								<div className="text-2xl font-semibold bg-gradient-to-r from-accent to-warning bg-clip-text text-transparent">
									{prCount}
								</div>
							</div>
						</div>
					</Card>
				</motion.div>

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
								<Card className="exercise-card bg-gradient-to-br from-surface-2 to-background border-secondary overflow-hidden">
									{/* Exercise Header */}
									<button
										onClick={() => toggleExercise(exercise.id)}
										className="w-full p-4 flex items-center justify-between hover:bg-surface-2/50 transition-colors"
									>
										<div className="flex items-center gap-3">
											<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
												<Dumbbell className="w-5 h-5 text-white" />
											</div>
											<div className="text-left">
												<div className="flex items-center gap-2">
													<h3 className="text-lg font-semibold text-white">
														{exercise.name}
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
																<td className="py-3 text-white font-semibold">
																	{set.set_number}
																</td>
																<td className="py-3 text-secondary-foreground">
																	{set.target_reps}
																</td>
																<td className="py-3 text-secondary-foreground">
																	{set.actual_reps}
																</td>
																<td className="py-3 text-secondary-foreground">
																	{set.weight_kg} kg
																</td>
																<td className="py-3 text-secondary-foreground">
																	{set.rpe ?? "-"}
																</td>
																<td className="py-3">
																	{set.is_pr && (
																		<Badge className="bg-gradient-to-r from-accent to-warning text-white border-0">
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
							className="flex-1 bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
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
					<Card className="bg-gradient-to-br from-surface-2 to-background border-secondary p-4">
						<h3 className="text-lg font-semibold text-white mb-3">
							Workout Notes
						</h3>
						<textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="Add notes about this workout..."
							className="w-full bg-background border border-secondary rounded-lg p-3 text-white placeholder:text-muted focus:border-primary focus:outline-none resize-none"
							rows={4}
						/>
						<Button
							size="sm"
							className="mt-3 bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
							disabled={saveNotes.isPending}
							onClick={() =>
								saveNotes.mutate({ sessionId: sessionId!, notes })
							}
						>
							{saveNotes.isPending ? "Saving..." : "Save Notes"}
						</Button>
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
