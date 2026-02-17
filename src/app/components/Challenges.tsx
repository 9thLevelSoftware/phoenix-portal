import { useQuery } from "@tanstack/react-query";
import {
	Clock,
	Flame,
	Loader2,
	Target,
	Trophy,
	Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { ChallengesMobile } from "@/app/components/mobile/ChallengesMobile";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import { Skeleton } from "@/app/components/ui/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";
import { useIsMobile } from "@/app/hooks/useIsMobile";
import { useJoinChallenge, useLeaveChallenge } from "@/mutations/challenges";
import { useAuth } from "@/providers/AuthProvider";
import {
	type Challenge,
	challengeListOptions,
	challengeProgressOptions,
	userChallengesOptions,
} from "@/queries/challenges";

export function Challenges() {
	const isMobile = useIsMobile();

	if (isMobile) {
		return <ChallengesMobile />;
	}

	return <ChallengesDesktop />;
}

function ChallengesDesktop() {
	const { user } = useAuth();
	const userId = user?.id ?? "";

	const { data: challenges, isPending: challengesLoading } = useQuery(
		challengeListOptions(),
	);
	const { data: userChallenges } = useQuery(
		userChallengesOptions(userId),
	);

	const joinMutation = useJoinChallenge();
	const leaveMutation = useLeaveChallenge();

	const [expandedId, setExpandedId] = useState<string | null>(null);

	const joinedIds = new Set(
		(userChallenges ?? []).map((uc) => uc.challenge_id),
	);
	const completedIds = new Set(
		(userChallenges ?? [])
			.filter((uc) => uc.completed_at)
			.map((uc) => uc.challenge_id),
	);

	// Separate into active (not completed by user or not joined) and past (completed)
	const activeChallenges = (challenges ?? []).filter(
		(c) => !completedIds.has(c.id),
	);
	const pastChallenges = (challenges ?? []).filter((c) =>
		completedIds.has(c.id),
	);

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

	const getDaysRemaining = (endDate: string) => {
		const end = new Date(endDate);
		const now = new Date();
		const diff = Math.ceil(
			(end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
		);
		return Math.max(0, diff);
	};

	if (challengesLoading) {
		return (
			<div className="min-h-screen bg-background pb-20 md:pb-8">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<Skeleton className="h-10 w-48 mb-2" />
					<Skeleton className="h-5 w-64 mb-8" />
					<div className="space-y-4">
						{Array.from({ length: 3 }).map((_, i) => (
							<Skeleton key={i} className="h-48 w-full" />
						))}
					</div>
				</div>
			</div>
		);
	}

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
							value="past"
							className="data-[state=active]:bg-primary"
						>
							Past Challenges
						</TabsTrigger>
					</TabsList>

					{/* Active Challenges Tab */}
					<TabsContent value="active" className="space-y-6">
						{activeChallenges.length === 0 ? (
							<div className="text-center py-16">
								<Trophy className="w-16 h-16 text-muted mx-auto mb-4" />
								<h3 className="text-xl font-semibold text-white mb-2">
									No active challenges right now
								</h3>
								<p className="text-muted-foreground">
									Check back soon for new challenges
								</p>
							</div>
						) : (
							activeChallenges.map((challenge, index) => (
								<ChallengeCard
									key={challenge.id}
									challenge={challenge}
									index={index}
									isJoined={joinedIds.has(challenge.id)}
									isExpanded={expandedId === challenge.id}
									daysRemaining={getDaysRemaining(challenge.end_date)}
									getDifficultyColor={getDifficultyColor}
									userId={userId}
									onToggleExpand={() =>
										setExpandedId(
											expandedId === challenge.id
												? null
												: challenge.id,
										)
									}
									onJoin={() => joinMutation.mutate(challenge.id)}
									onLeave={() => leaveMutation.mutate(challenge.id)}
									joinPending={joinMutation.isPending}
									leavePending={leaveMutation.isPending}
								/>
							))
						)}
					</TabsContent>

					{/* Past Challenges Tab */}
					<TabsContent value="past" className="space-y-6">
						{pastChallenges.length === 0 ? (
							<div className="text-center py-16">
								<Trophy className="w-16 h-16 text-muted mx-auto mb-4" />
								<p className="text-muted-foreground">
									Complete your first challenge to see it here
								</p>
							</div>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
								{pastChallenges.map((challenge, index) => (
									<motion.div
										key={challenge.id}
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
											<p className="text-sm text-muted-foreground">
												{challenge.description}
											</p>
											{challenge.prize && (
												<div className="mt-4 p-3 bg-gradient-to-br from-primary/10 to-chart-2/10 border border-primary/30 rounded-lg">
													<div className="text-xs text-muted-foreground mb-1">
														Reward Earned
													</div>
													<div className="text-white">{challenge.prize}</div>
												</div>
											)}
										</Card>
									</motion.div>
								))}
							</div>
						)}
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}

function ChallengeCard({
	challenge,
	index,
	isJoined,
	isExpanded,
	daysRemaining,
	getDifficultyColor,
	userId,
	onToggleExpand,
	onJoin,
	onLeave,
	joinPending,
	leavePending,
}: {
	challenge: Challenge;
	index: number;
	isJoined: boolean;
	isExpanded: boolean;
	daysRemaining: number;
	getDifficultyColor: (d: string) => string;
	userId: string;
	onToggleExpand: () => void;
	onJoin: () => void;
	onLeave: () => void;
	joinPending: boolean;
	leavePending: boolean;
}) {
	return (
		<motion.div
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

						{/* Progress (only if joined) */}
						{isJoined && (
							<ChallengeProgressBar
								userId={userId}
								challengeId={challenge.id}
								challengeType={challenge.challenge_type}
								targetValue={challenge.target_value}
								startDate={challenge.start_date}
								endDate={challenge.end_date}
							/>
						)}

						{/* Stats Grid */}
						<div className="grid grid-cols-2 md:grid-cols-3 gap-4">
							<div>
								<div className="text-xs text-muted-foreground mb-1">
									Target
								</div>
								<div className="text-xl text-white">
									{challenge.target_value.toLocaleString()}{" "}
									{challenge.target_unit}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground mb-1">
									Time Left
								</div>
								<div className="text-xl text-warning">
									{daysRemaining} days
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground mb-1">
									Type
								</div>
								<div className="text-xl text-white capitalize">
									{challenge.challenge_type}
								</div>
							</div>
						</div>
					</div>

					{/* Right Section */}
					<div className="lg:w-64 flex flex-col justify-between gap-3">
						{challenge.prize && (
							<div className="p-4 bg-gradient-to-br from-primary/10 to-chart-2/10 border border-primary/30 rounded-lg">
								<div className="text-xs text-muted-foreground mb-2">
									Prize
								</div>
								<div className="text-white">{challenge.prize}</div>
							</div>
						)}
						{isJoined ? (
							<div className="space-y-2">
								<Button
									className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
									onClick={onToggleExpand}
								>
									{isExpanded ? "Hide Details" : "View Details"}
								</Button>
								<Button
									variant="outline"
									className="w-full border-secondary text-muted-foreground hover:border-destructive hover:text-destructive"
									onClick={onLeave}
									disabled={leavePending}
								>
									{leavePending ? (
										<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									) : null}
									Leave Challenge
								</Button>
							</div>
						) : (
							<Button
								className="w-full bg-gradient-to-r from-primary to-chart-2 hover:from-chart-2 hover:to-accent border-0"
								onClick={onJoin}
								disabled={joinPending}
							>
								{joinPending ? (
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								) : null}
								Join Challenge
							</Button>
						)}
					</div>
				</div>

				{/* Expanded details */}
				{isExpanded && (
					<motion.div
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						className="mt-6 pt-6 border-t border-secondary"
					>
						<p className="text-muted-foreground mb-4">
							{challenge.description}
						</p>
						<div className="flex gap-4 text-sm text-muted-foreground">
							<div className="flex items-center gap-1">
								<Clock className="w-4 h-4" />
								<span>
									{new Date(challenge.start_date).toLocaleDateString()} -{" "}
									{new Date(challenge.end_date).toLocaleDateString()}
								</span>
							</div>
							<div className="flex items-center gap-1">
								<Target className="w-4 h-4" />
								<span>
									{challenge.target_value.toLocaleString()}{" "}
									{challenge.target_unit}
								</span>
							</div>
						</div>
						<Button
							variant="outline"
							className="mt-4 border-secondary text-muted-foreground"
							onClick={() =>
								toast("Leaderboard coming in a future update")
							}
						>
							<Users className="w-4 h-4 mr-2" />
							View Leaderboard
						</Button>
					</motion.div>
				)}
			</Card>
		</motion.div>
	);
}

function ChallengeProgressBar({
	userId,
	challengeId,
	challengeType,
	targetValue,
	startDate,
	endDate,
}: {
	userId: string;
	challengeId: string;
	challengeType: string;
	targetValue: number;
	startDate: string;
	endDate: string;
}) {
	const { data: progress } = useQuery(
		challengeProgressOptions(
			userId,
			challengeId,
			challengeType,
			targetValue,
			startDate,
			endDate,
		),
	);

	const percentage = progress?.percentage ?? 0;

	return (
		<div>
			<div className="flex items-center justify-between mb-2 text-sm">
				<span className="text-muted-foreground">Your Progress</span>
				<span className="text-white">{percentage}%</span>
			</div>
			<Progress value={percentage} className="h-3" />
			{progress && (
				<div className="text-xs text-muted-foreground mt-1">
					{progress.current.toLocaleString()} / {progress.target.toLocaleString()}
				</div>
			)}
		</div>
	);
}
