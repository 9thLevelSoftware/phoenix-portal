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
	Share2,
	TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Skeleton } from "@/app/components/ui/skeleton";
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
	const [expandedExercises, setExpandedExercises] = useState<string[]>([]);
	const [notes, setNotes] = useState("");

	if (!sessionId) {
		return <Navigate to="/history" replace />;
	}

	const toggleExercise = (exerciseId: string) => {
		setExpandedExercises((prev) =>
			prev.includes(exerciseId)
				? prev.filter((id) => id !== exerciseId)
				: [...prev, exerciseId],
		);
	};

	const getMuscleGroupColor = (muscleGroup: string) => {
		const colors: Record<string, string> = {
			Chest: "bg-[#FF6B35]",
			Shoulders: "bg-[#F59E0B]",
			Back: "bg-[#10B981]",
			Legs: "bg-[#DC2626]",
			Arms: "bg-[#FBBF24]",
			Core: "bg-[#8B5CF6]",
		};
		return colors[muscleGroup] || "bg-[#6B7280]";
	};

	// Loading state
	if (isPending) {
		return (
			<div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
					<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
						<Skeleton className="h-10 w-64 mb-2 bg-[#1a1a1a]" />
						<Skeleton className="h-5 w-48 bg-[#1a1a1a]" />
					</div>
				</div>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
					<Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] p-6">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
							{[1, 2, 3, 4].map((i) => (
								<div key={i} className="text-center space-y-2">
									<Skeleton className="h-4 w-20 mx-auto bg-[#1a1a1a]" />
									<Skeleton className="h-8 w-16 mx-auto bg-[#1a1a1a]" />
								</div>
							))}
						</div>
					</Card>
					{[1, 2, 3].map((i) => (
						<Card
							key={i}
							className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] p-4"
						>
							<div className="flex items-center gap-3">
								<Skeleton className="h-10 w-10 rounded-lg bg-[#1a1a1a]" />
								<div className="space-y-2">
									<Skeleton className="h-5 w-40 bg-[#1a1a1a]" />
									<Skeleton className="h-4 w-20 bg-[#1a1a1a]" />
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
			<div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
				<div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
					<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>
					</div>
				</div>
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
					<AlertCircle className="w-12 h-12 text-[#DC2626] mx-auto mb-4" />
					<h2 className="text-xl font-semibold text-white mb-2">
						Session Not Found
					</h2>
					<p className="text-[#9CA3AF]">
						{error
							? error.message
							: "This workout session could not be loaded."}
					</p>
					<Button
						onClick={() => navigate("/history")}
						className="mt-6 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
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

	// Auto-expand first exercise if none expanded
	const effectiveExpanded =
		expandedExercises.length === 0 && session.exercises.length > 0
			? [session.exercises[0].id]
			: expandedExercises;

	return (
		<div className="min-h-screen bg-[#0D0D0D] pb-24 md:pb-8">
			{/* Header */}
			<div className="bg-gradient-to-b from-[#1a1a1a] to-[#0D0D0D] border-b border-[#374151] sticky top-0 z-40 backdrop-blur-xl">
				<div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
					>
						<Button
							variant="outline"
							size="sm"
							onClick={() => navigate("/history")}
							className="mb-4 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
						>
							<ArrowLeft className="w-4 h-4 mr-2" />
							Back to History
						</Button>

						<h1 className="text-3xl sm:text-4xl mb-2">
							<span className="bg-gradient-to-r from-[#FF6B35] to-[#F59E0B] bg-clip-text text-transparent">
								{session.name}
							</span>
						</h1>
						<div className="flex flex-wrap items-center gap-2 text-sm text-[#9CA3AF]">
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
										className="border-[#FF6B35]/30 text-[#FF6B35]"
									>
										{session.routine_name}
									</Badge>
								</>
							)}
							{session.workout_mode && (
								<Badge
									variant="outline"
									className="border-[#F59E0B]/30 text-[#F59E0B]"
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
					<Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] p-6">
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Clock className="w-5 h-5 text-[#FF6B35]" />
									<div className="text-sm text-[#9CA3AF]">Duration</div>
								</div>
								<div className="text-2xl font-semibold text-white">
									{session.duration_seconds}m
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<TrendingUp className="w-5 h-5 text-[#10B981]" />
									<div className="text-sm text-[#9CA3AF]">Volume</div>
								</div>
								<div className="text-2xl font-semibold text-white">
									{session.total_volume.toLocaleString()} kg
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Dumbbell className="w-5 h-5 text-[#F59E0B]" />
									<div className="text-sm text-[#9CA3AF]">Sets</div>
								</div>
								<div className="text-2xl font-semibold text-white">
									{totalSets}
								</div>
							</div>
							<div className="text-center">
								<div className="flex items-center justify-center gap-2 mb-2">
									<Award className="w-5 h-5 text-[#FBBF24]" />
									<div className="text-sm text-[#9CA3AF]">PRs</div>
								</div>
								<div className="text-2xl font-semibold bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] bg-clip-text text-transparent">
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
								<Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] overflow-hidden">
									{/* Exercise Header */}
									<button
										onClick={() => toggleExercise(exercise.id)}
										className="w-full p-4 flex items-center justify-between hover:bg-[#1a1a1a]/50 transition-colors"
									>
										<div className="flex items-center gap-3">
											<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FF6B35] to-[#DC2626] flex items-center justify-center">
												<Dumbbell className="w-5 h-5 text-white" />
											</div>
											<div className="text-left">
												<div className="flex items-center gap-2">
													<h3 className="text-lg font-semibold text-white">
														{exercise.name}
													</h3>
													{exercise.hasPR && (
														<Flame className="w-4 h-4 text-[#F59E0B]" />
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
											<span className="text-sm text-[#9CA3AF]">
												{exercise.sets.length} sets
											</span>
											{effectiveExpanded.includes(exercise.id) ? (
												<ChevronUp className="w-5 h-5 text-[#9CA3AF]" />
											) : (
												<ChevronDown className="w-5 h-5 text-[#9CA3AF]" />
											)}
										</div>
									</button>

									{/* Exercise Sets Table */}
									{effectiveExpanded.includes(exercise.id) && (
										<div className="border-t border-[#374151] p-4">
											<div className="overflow-x-auto">
												<table className="w-full text-sm">
													<thead>
														<tr className="border-b border-[#374151]">
															<th className="text-left py-2 text-[#9CA3AF]">
																Set
															</th>
															<th className="text-left py-2 text-[#9CA3AF]">
																Target
															</th>
															<th className="text-left py-2 text-[#9CA3AF]">
																Actual
															</th>
															<th className="text-left py-2 text-[#9CA3AF]">
																Weight
															</th>
															<th className="text-left py-2 text-[#9CA3AF]">
																RPE
															</th>
															<th className="text-left py-2 text-[#9CA3AF]">
																Notes
															</th>
														</tr>
													</thead>
													<tbody>
														{exercise.sets.map((set) => (
															<tr
																key={set.set_number}
																className={`border-b border-[#374151]/50 ${
																	set.is_pr
																		? "border-l-4 border-l-[#F59E0B]"
																		: ""
																}`}
															>
																<td className="py-3 text-white font-semibold">
																	{set.set_number}
																</td>
																<td className="py-3 text-[#E5E7EB]">
																	{set.target_reps}
																</td>
																<td className="py-3 text-[#E5E7EB]">
																	{set.actual_reps}
																</td>
																<td className="py-3 text-[#E5E7EB]">
																	{set.weight_kg} kg
																</td>
																<td className="py-3 text-[#E5E7EB]">
																	{set.rpe ?? "-"}
																</td>
																<td className="py-3">
																	{set.is_pr && (
																		<Badge className="bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] text-white border-0">
																			NEW PR
																		</Badge>
																	)}
																	{set.notes && !set.is_pr && (
																		<span className="text-[#9CA3AF]">
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
					className="flex flex-col sm:flex-row gap-3"
				>
					<Button className="flex-1 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0">
						<BarChart3 className="w-4 h-4 mr-2" />
						Compare to Previous
					</Button>
					<Button
						variant="outline"
						className="flex-1 border-[#374151] text-[#9CA3AF] hover:border-[#FF6B35] hover:text-[#FF6B35]"
					>
						<Share2 className="w-4 h-4 mr-2" />
						Share Summary
					</Button>
				</motion.div>

				{/* Notes Section */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.5 }}
				>
					<Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0D0D0D] border-[#374151] p-4">
						<h3 className="text-lg font-semibold text-white mb-3">
							Workout Notes
						</h3>
						<textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							placeholder="Add notes about this workout..."
							className="w-full bg-[#0D0D0D] border border-[#374151] rounded-lg p-3 text-white placeholder:text-[#6B7280] focus:border-[#FF6B35] focus:outline-none resize-none"
							rows={4}
						/>
						<Button
							size="sm"
							className="mt-3 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] hover:from-[#DC2626] hover:to-[#F59E0B] border-0"
						>
							Save Notes
						</Button>
					</Card>
				</motion.div>
			</div>
		</div>
	);
}
