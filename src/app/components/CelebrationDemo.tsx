import { Award, Check, Flame, Medal, Trophy, Zap } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { BadgeEarned } from "@/app/components/celebrations/BadgeEarned";
import { ChallengeWon } from "@/app/components/celebrations/ChallengeWon";
import { PRCelebration } from "@/app/components/celebrations/PRCelebration";
import { StreakMilestone } from "@/app/components/celebrations/StreakMilestone";
import { WorkoutComplete } from "@/app/components/celebrations/WorkoutComplete";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";

export function CelebrationDemo() {
	const [showPR, setShowPR] = useState(false);
	const [showBadge, setShowBadge] = useState(false);
	const [showStreak, setShowStreak] = useState(false);
	const [_showChallengeWon, setShowChallengeWon] = useState(false);
	const [showWorkoutComplete, setShowWorkoutComplete] = useState(false);
	const [selectedBadgeTier, setSelectedBadgeTier] = useState<
		"bronze" | "silver" | "gold" | "platinum"
	>("gold");
	const [selectedStreak, setSelectedStreak] = useState(7);
	const [selectedPlacement, setSelectedPlacement] = useState<1 | 2 | 3>(1);

	return (
		<div className="min-h-screen pb-24 md:pb-8">
			{/* Header */}
			<div className="bg-gradient-to-b from-surface-2 to-background border-b border-secondary sticky top-0 z-40 backdrop-blur-xl">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						className="text-center"
					>
						<h1 className="text-3xl sm:text-4xl mb-2 text-white">
							Celebration Animations
						</h1>
						<p className="text-muted-foreground">
							Test all celebration animations and micro-interactions
						</p>
					</motion.div>
				</div>
			</div>

			{/* Content */}
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
				{/* PR Celebration */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-start gap-4 mb-4">
							<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-chart-2 flex items-center justify-center">
								<Trophy className="w-6 h-6 text-white" />
							</div>
							<div className="flex-1">
								<h3 className="text-xl font-semibold text-white mb-2">
									Personal Record Celebration
								</h3>
								<p className="text-sm text-muted-foreground mb-4">
									Full animation sequence with phoenix rise, particle burst, and
									PR card reveal
								</p>
							</div>
						</div>

						<div className="space-y-3">
							<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
								<Button
									onClick={() => setShowPR(true)}
									className="bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
								>
									Weight PR
								</Button>
								<Button
									onClick={() => setShowPR(true)}
									className="bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-500 border-0"
								>
									Volume PR
								</Button>
								<Button
									onClick={() => setShowPR(true)}
									className="bg-gradient-to-r from-accent to-amber-600 hover:from-amber-600 hover:to-accent border-0"
								>
									1RM Estimate
								</Button>
							</div>
							<p className="text-xs text-muted-foreground">
								✨ Features: Phoenix rise animation, ember trail, particle
								burst, glowing PR card
							</p>
						</div>
					</Card>
				</motion.div>

				{/* Badge Earned */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-start gap-4 mb-4">
							<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-accent to-amber-600 flex items-center justify-center">
								<Award className="w-6 h-6 text-white" />
							</div>
							<div className="flex-1">
								<h3 className="text-xl font-semibold text-white mb-2">
									Badge Unlocked
								</h3>
								<p className="text-sm text-muted-foreground mb-4">
									Dramatic card flip reveal with tier-specific particle effects
									and colors
								</p>
							</div>
						</div>

						<div className="space-y-3">
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								<button
									onClick={() => {
										setSelectedBadgeTier("bronze");
										setShowBadge(true);
									}}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-amber-600 to-amber-800 text-white text-sm font-medium hover:scale-105 transition-transform"
								>
									Bronze
								</button>
								<button
									onClick={() => {
										setSelectedBadgeTier("silver");
										setShowBadge(true);
									}}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-secondary-foreground to-muted-foreground text-surface-2 text-sm font-medium hover:scale-105 transition-transform"
								>
									Silver
								</button>
								<button
									onClick={() => {
										setSelectedBadgeTier("gold");
										setShowBadge(true);
									}}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-accent to-amber-600 text-white text-sm font-medium hover:scale-105 transition-transform"
								>
									Gold
								</button>
								<button
									onClick={() => {
										setSelectedBadgeTier("platinum");
										setShowBadge(true);
									}}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-secondary-foreground via-[#F3F4F6] to-secondary-foreground text-surface-2 text-sm font-medium hover:scale-105 transition-transform"
								>
									Platinum
								</button>
							</div>
							<p className="text-xs text-muted-foreground">
								✨ Features: 3D card flip, tier-specific particles, confetti for
								Gold/Platinum
							</p>
						</div>
					</Card>
				</motion.div>

				{/* Streak Milestone */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.3 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-start gap-4 mb-4">
							<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
								<Flame className="w-6 h-6 text-white" />
							</div>
							<div className="flex-1">
								<h3 className="text-xl font-semibold text-white mb-2">
									Streak Milestones
								</h3>
								<p className="text-sm text-muted-foreground mb-4">
									Flame intensify animation with expanding rings and
									milestone-specific messages
								</p>
							</div>
						</div>

						<div className="space-y-3">
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								{[7, 14, 30, 60, 90, 180, 365].map((streak) => (
									<button
										key={streak}
										onClick={() => {
											setSelectedStreak(streak);
											setShowStreak(true);
										}}
										className="px-3 py-2 rounded-lg bg-gradient-to-br from-surface-2 to-background border border-secondary hover:border-primary text-white text-sm font-medium transition-all"
									>
										{streak} days
									</button>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								✨ Features: Flame intensify, expanding fire rings, ember
								particles, special 365-day animation
							</p>
						</div>
					</Card>
				</motion.div>

				{/* Challenge Won */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.4 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-start gap-4 mb-4">
							<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
								<Medal className="w-6 h-6 text-white" />
							</div>
							<div className="flex-1">
								<h3 className="text-xl font-semibold text-white mb-2">
									Challenge Won
								</h3>
								<p className="text-sm text-muted-foreground mb-4">
									Animated medal reveal with tier-specific particle effects and
									colors
								</p>
							</div>
						</div>

						<div className="space-y-3">
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								<button
									onClick={() => {
										setSelectedPlacement(1);
										setShowChallengeWon(true);
									}}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-accent to-warning text-white text-sm font-medium hover:scale-105 transition-transform"
								>
									👑 1st Place
								</button>
								<button
									onClick={() => {
										setSelectedPlacement(2);
										setShowChallengeWon(true);
									}}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-secondary-foreground to-muted-foreground text-surface-2 text-sm font-medium hover:scale-105 transition-transform"
								>
									🥈 2nd Place
								</button>
								<button
									onClick={() => {
										setSelectedPlacement(3);
										setShowChallengeWon(true);
									}}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-amber-600 to-amber-800 text-white text-sm font-medium hover:scale-105 transition-transform"
								>
									🥉 3rd Place
								</button>
							</div>
							<p className="text-xs text-muted-foreground">
								✨ Features: Podium rise, avatar drop, spotlights, confetti
								burst, rewards card
							</p>
						</div>
					</Card>
				</motion.div>

				{/* Workout Complete */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.5 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-start gap-4 mb-4">
							<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-success to-emerald-600 flex items-center justify-center">
								<Check className="w-6 h-6 text-white" />
							</div>
							<div className="flex-1">
								<h3 className="text-xl font-semibold text-white mb-2">
									Workout Complete
								</h3>
								<p className="text-sm text-muted-foreground mb-4">
									Animated checkmark with particle burst and confetti
								</p>
							</div>
						</div>

						<div className="space-y-3">
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								<button
									onClick={() => setShowWorkoutComplete(true)}
									className="px-3 py-2 rounded-lg bg-gradient-to-br from-success to-emerald-600 text-white text-sm font-medium hover:scale-105 transition-transform"
								>
									Complete
								</button>
							</div>
							<p className="text-xs text-muted-foreground">
								✨ Features: Checkmark animation, particle burst, confetti
							</p>
						</div>
					</Card>
				</motion.div>

				{/* Micro Celebrations Info */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.6 }}
				>
					<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
						<div className="flex items-start gap-4 mb-4">
							<div className="w-12 h-12 rounded-lg bg-gradient-to-br from-success to-emerald-600 flex items-center justify-center">
								<Zap className="w-6 h-6 text-white" />
							</div>
							<div className="flex-1">
								<h3 className="text-xl font-semibold text-white mb-2">
									Micro-Celebrations
								</h3>
								<p className="text-sm text-muted-foreground mb-4">
									Subtle, frequent celebrations integrated throughout the app
								</p>
							</div>
						</div>

						<div className="space-y-2 text-sm">
							<div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-secondary">
								<div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
									<span className="text-lg">✓</span>
								</div>
								<div>
									<div className="text-white font-medium">Set Complete</div>
									<div className="text-xs text-muted-foreground">
										Brief pulse + checkmark animation
									</div>
								</div>
							</div>

							<div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-secondary">
								<div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
									<span className="text-lg">↑</span>
								</div>
								<div>
									<div className="text-white font-medium">Weight Increase</div>
									<div className="text-xs text-muted-foreground">
										Arrow animation + ember sparkle
									</div>
								</div>
							</div>

							<div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-secondary">
								<div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
									<span className="text-lg">⏱️</span>
								</div>
								<div>
									<div className="text-white font-medium">
										Rest Timer Complete
									</div>
									<div className="text-xs text-muted-foreground">
										Gentle pulse + wing flap icon
									</div>
								</div>
							</div>
						</div>
					</Card>
				</motion.div>
			</div>

			{/* Celebration Components */}
			<PRCelebration
				isOpen={showPR}
				onClose={() => setShowPR(false)}
				unit="kg"
				prData={{
					exerciseName: "Bench Press",
					weight: 120,
					reps: 5,
					estimated1RM: 135,
					improvement: 15,
					type: "weight",
				}}
			/>

			<BadgeEarned
				isOpen={showBadge}
				onClose={() => setShowBadge(false)}
				badgeData={{
					name: "Week Warrior",
					description: "Completed 7 workouts in a single week",
					tier: selectedBadgeTier,
					icon: "🔥",
				}}
			/>

			<StreakMilestone
				isOpen={showStreak}
				onClose={() => setShowStreak(false)}
				streak={selectedStreak}
			/>

			<ChallengeWon
				placement={selectedPlacement}
				challengeName="January Volume Challenge"
				challengeType="Volume"
				userAvatar="JD"
				rewards={[
					{ type: "badge", name: "Phoenix Champion Badge", icon: "🏆" },
					{ type: "premium", name: "1 Month Premium", icon: "✨" },
					{ type: "points", name: "500 XP Bonus", icon: "🔥" },
				]}
				onDismiss={() => setShowChallengeWon(false)}
				onViewResults={() => {
					setShowChallengeWon(false);
					console.log("View results clicked");
				}}
			/>

			<WorkoutComplete
				isOpen={showWorkoutComplete}
				onClose={() => setShowWorkoutComplete(false)}
				duration="58 min"
				volume={5200}
				unit="kg"
				prsAchieved={2}
				streakContinued={true}
				onViewSummary={() => {
					setShowWorkoutComplete(false);
					console.log("View summary clicked");
				}}
			/>
		</div>
	);
}
