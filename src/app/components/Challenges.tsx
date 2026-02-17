import {
	Clock,
	Flame,
	Medal,
	Target,
	TrendingUp,
	Trophy,
	Users,
} from "lucide-react";
import { motion } from "motion/react";
import { ChallengesMobile } from "@/app/components/mobile/ChallengesMobile";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useIsMobile } from "@/app/hooks/useIsMobile";

export function Challenges() {
	const isMobile = useIsMobile();

	if (isMobile) {
		return <ChallengesMobile />;
	}

	const activeChallenges = [
		{
			id: 1,
			name: "January Volume Challenge",
			description: "Lift the most total weight in January",
			progress: 68,
			rank: 12,
			totalParticipants: 150,
			myScore: "186,500 kg",
			leaderScore: "274,200 kg",
			timeLeft: "12 days",
			difficulty: "hard",
			prize: "🏆 Phoenix Badge + 1 Month Premium",
		},
		{
			id: 2,
			name: "PR Hunter",
			description: "Achieve the most personal records this month",
			progress: 45,
			rank: 8,
			totalParticipants: 50,
			myScore: "11 PRs",
			leaderScore: "24 PRs",
			timeLeft: "12 days",
			difficulty: "medium",
			prize: "💎 Diamond Badge",
		},
		{
			id: 3,
			name: "30-Day Streak",
			description: "Workout every day for 30 days straight",
			progress: 87,
			rank: 25,
			totalParticipants: 100,
			myScore: "26 days",
			leaderScore: "30 days",
			timeLeft: "4 days",
			difficulty: "extreme",
			prize: "🔥 Inferno Badge",
		},
	];

	const leaderboard = [
		{
			rank: 1,
			name: "Marcus Chen",
			avatar: "MC",
			score: "274,200 kg",
			change: 0,
		},
		{
			rank: 2,
			name: "Sarah Williams",
			avatar: "SW",
			score: "268,500 kg",
			change: 1,
		},
		{
			rank: 3,
			name: "David Rodriguez",
			avatar: "DR",
			score: "251,800 kg",
			change: -1,
		},
		{
			rank: 4,
			name: "Emma Thompson",
			avatar: "ET",
			score: "243,100 kg",
			change: 2,
		},
		{
			rank: 5,
			name: "James Lee",
			avatar: "JL",
			score: "238,900 kg",
			change: 0,
		},
		{
			rank: 12,
			name: "You",
			avatar: "JD",
			score: "186,500 kg",
			change: 3,
			isUser: true,
		},
	];

	const pastChallenges = [
		{
			name: "December Strength Challenge",
			placement: 5,
			participants: 120,
			reward: "🥈 Silver Crusher",
			completed: true,
		},
		{
			name: "Thanksgiving Week Warrior",
			placement: 1,
			participants: 45,
			reward: "🏆 Champion Badge",
			completed: true,
		},
		{
			name: "November Consistency",
			placement: 18,
			participants: 200,
			reward: "🔥 Flame Badge",
			completed: true,
		},
	];

	const suggestedChallenges = [
		{
			name: "Bench Press Mastery",
			description: "Add 10kg to your bench press 1RM",
			duration: "6 weeks",
			difficulty: "medium",
			participants: 89,
		},
		{
			name: "Lower Body Destroyer",
			description: "Complete 100 squat sets this month",
			duration: "30 days",
			difficulty: "hard",
			participants: 67,
		},
		{
			name: "Speed Demon",
			description: "Complete 5 workouts under 45 minutes",
			duration: "2 weeks",
			difficulty: "easy",
			participants: 134,
		},
	];

	const getDifficultyColor = (difficulty: string) => {
		switch (difficulty) {
			case "easy":
				return "from-success to-[#059669]";
			case "medium":
				return "from-accent to-[#D97706]";
			case "hard":
				return "from-primary to-chart-2";
			case "extreme":
				return "from-chart-2 to-[#991B1B]";
			default:
				return "from-muted to-muted";
		}
	};

	return (
		<div className="min-h-screen bg-background pb-20 md:pb-8">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl sm:text-4xl mb-2">
						<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
							Challenges
						</span>
					</h1>
					<p className="text-muted-foreground">
						Compete, conquer, and claim your glory
					</p>
				</div>

				<Tabs defaultValue="active" className="space-y-6">
					<TabsList className="bg-surface-2 border border-secondary p-1">
						<TabsTrigger
							value="active"
							className="data-[state=active]:bg-primary"
						>
							Active Challenges
						</TabsTrigger>
						<TabsTrigger
							value="leaderboard"
							className="data-[state=active]:bg-primary"
						>
							Leaderboard
						</TabsTrigger>
						<TabsTrigger
							value="past"
							className="data-[state=active]:bg-primary"
						>
							Past Challenges
						</TabsTrigger>
						<TabsTrigger
							value="discover"
							className="data-[state=active]:bg-primary"
						>
							Discover
						</TabsTrigger>
					</TabsList>

					{/* Active Challenges Tab */}
					<TabsContent value="active" className="space-y-6">
						{activeChallenges.map((challenge, index) => (
							<motion.div
								key={challenge.id}
								initial={{ opacity: 0, y: 20 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ delay: index * 0.1 }}
							>
								<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all">
									<div className="flex flex-col lg:flex-row gap-6">
										{/* Left Section */}
										<div className="flex-1 space-y-4">
											<div>
												<div className="flex items-start justify-between mb-2">
													<div className="flex items-center gap-3">
														<div
															className={`w-12 h-12 rounded-lg bg-gradient-to-br ${getDifficultyColor(challenge.difficulty)} flex items-center justify-center`}
														>
															<Flame className="w-6 h-6 text-white" />
														</div>
														<div>
															<h3 className="text-xl text-white">
																{challenge.name}
															</h3>
															<p className="text-sm text-muted-foreground">
																{challenge.description}
															</p>
														</div>
													</div>
													<Badge
														className={`bg-gradient-to-r ${getDifficultyColor(challenge.difficulty)} text-white border-0`}
													>
														{challenge.difficulty.toUpperCase()}
													</Badge>
												</div>
											</div>

											{/* Progress */}
											<div>
												<div className="flex items-center justify-between mb-2 text-sm">
													<span className="text-muted-foreground">Your Progress</span>
													<span className="text-white">
														{challenge.progress}%
													</span>
												</div>
												<Progress value={challenge.progress} className="h-3" />
											</div>

											{/* Stats Grid */}
											<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
												<div>
													<div className="text-xs text-muted-foreground mb-1">
														Your Rank
													</div>
													<div className="text-xl text-primary">
														#{challenge.rank}
													</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground mb-1">
														Participants
													</div>
													<div className="text-xl text-white">
														{challenge.totalParticipants}
													</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground mb-1">
														Your Score
													</div>
													<div className="text-xl text-white">
														{challenge.myScore}
													</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground mb-1">
														Time Left
													</div>
													<div className="text-xl text-warning">
														{challenge.timeLeft}
													</div>
												</div>
											</div>
										</div>

										{/* Right Section */}
										<div className="lg:w-64 flex flex-col justify-between">
											<div className="p-4 bg-gradient-to-br from-primary/10 to-chart-2/10 border border-primary/30 rounded-lg mb-4">
												<div className="text-xs text-muted-foreground mb-2">Prize</div>
												<div className="text-white">{challenge.prize}</div>
											</div>
											<Button className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0">
												View Details
											</Button>
										</div>
									</div>
								</Card>
							</motion.div>
						))}
					</TabsContent>

					{/* Leaderboard Tab */}
					<TabsContent value="leaderboard" className="space-y-6">
						<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary">
							<h3 className="text-xl text-white mb-6">
								January Volume Challenge - Leaderboard
							</h3>
							<div className="space-y-2">
								{leaderboard.map((entry) => (
									<div
										key={entry.rank}
										className={`p-4 rounded-lg flex items-center gap-4 ${
											entry.isUser
												? "bg-gradient-to-r from-primary/20 to-chart-2/20 border-2 border-primary"
												: "bg-background border border-secondary"
										} hover:border-primary/50 transition-all`}
									>
										{/* Rank Badge */}
										<div className="w-12 h-12 flex items-center justify-center">
											{entry.rank === 1 && (
												<div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-warning flex items-center justify-center">
													<Trophy className="w-5 h-5 text-background" />
												</div>
											)}
											{entry.rank === 2 && (
												<div className="w-10 h-10 rounded-full bg-gradient-to-br from-secondary-foreground to-muted-foreground flex items-center justify-center">
													<Medal className="w-5 h-5 text-background" />
												</div>
											)}
											{entry.rank === 3 && (
												<div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D97706] to-[#92400E] flex items-center justify-center">
													<Medal className="w-5 h-5 text-white" />
												</div>
											)}
											{entry.rank > 3 && (
												<div className="text-xl text-muted-foreground">
													#{entry.rank}
												</div>
											)}
										</div>

										{/* Avatar */}
										<div
											className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${
												entry.isUser
													? "bg-gradient-to-br from-primary to-chart-2 ring-2 ring-accent ring-offset-2 ring-offset-background"
													: "bg-gradient-to-br from-muted to-muted"
											}`}
										>
											{entry.avatar}
										</div>

										{/* Name */}
										<div className="flex-1">
											<div className="text-white">{entry.name}</div>
										</div>

										{/* Score */}
										<div className="text-right">
											<div className="text-primary">{entry.score}</div>
										</div>

										{/* Change Indicator */}
										<div className="w-12 text-center">
											{entry.change > 0 && (
												<div className="flex items-center justify-center gap-1 text-success text-sm">
													<TrendingUp className="w-4 h-4" />
													{entry.change}
												</div>
											)}
											{entry.change < 0 && (
												<div className="flex items-center justify-center gap-1 text-destructive text-sm">
													<TrendingUp className="w-4 h-4 rotate-180" />
													{Math.abs(entry.change)}
												</div>
											)}
											{entry.change === 0 && (
												<div className="text-muted text-sm">-</div>
											)}
										</div>
									</div>
								))}
							</div>
						</Card>
					</TabsContent>

					{/* Past Challenges Tab */}
					<TabsContent value="past" className="space-y-6">
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
							{pastChallenges.map((challenge, index) => (
								<motion.div
									key={index}
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.1 }}
								>
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary h-full">
										<div className="mb-4">
											<h3 className="text-lg text-white mb-2">
												{challenge.name}
											</h3>
											<Badge className="bg-success text-white border-0">
												Completed
											</Badge>
										</div>
										<div className="space-y-3">
											<div className="flex items-center justify-between">
												<span className="text-sm text-muted-foreground">
													Your Placement
												</span>
												<span
													className={`text-lg ${
														challenge.placement <= 3
															? "text-accent"
															: "text-white"
													}`}
												>
													#{challenge.placement} / {challenge.participants}
												</span>
											</div>
											<div className="p-3 bg-gradient-to-br from-primary/10 to-chart-2/10 border border-primary/30 rounded-lg">
												<div className="text-xs text-muted-foreground mb-1">
													Reward Earned
												</div>
												<div className="text-white">{challenge.reward}</div>
											</div>
										</div>
									</Card>
								</motion.div>
							))}
						</div>
					</TabsContent>

					{/* Discover Tab */}
					<TabsContent value="discover" className="space-y-6">
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
							{suggestedChallenges.map((challenge, index) => (
								<motion.div
									key={index}
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: index * 0.1 }}
								>
									<Card className="p-6 bg-gradient-to-br from-surface-2 to-background border-secondary hover:border-primary/50 transition-all h-full flex flex-col">
										<div className="flex-1">
											<div className="flex items-start justify-between mb-4">
												<div
													className={`w-10 h-10 rounded-lg bg-gradient-to-br ${getDifficultyColor(challenge.difficulty)} flex items-center justify-center`}
												>
													<Target className="w-5 h-5 text-white" />
												</div>
												<Badge
													className={`bg-gradient-to-r ${getDifficultyColor(challenge.difficulty)} text-white border-0 text-xs`}
												>
													{challenge.difficulty.toUpperCase()}
												</Badge>
											</div>
											<h3 className="text-lg text-white mb-2">
												{challenge.name}
											</h3>
											<p className="text-sm text-muted-foreground mb-4">
												{challenge.description}
											</p>
											<div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
												<div className="flex items-center gap-1">
													<Clock className="w-4 h-4" />
													{challenge.duration}
												</div>
												<div className="flex items-center gap-1">
													<Users className="w-4 h-4" />
													{challenge.participants} joined
												</div>
											</div>
										</div>
										<Button
											className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
											title="Join to track your synced workout progress against other athletes"
										>
											Join Challenge
										</Button>
									</Card>
								</motion.div>
							))}
						</div>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
