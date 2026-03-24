import { useQuery } from "@tanstack/react-query";
import { Clock, Flame, Loader2, Target, Trophy, Users } from "lucide-react";
import {
	motion,
	type PanInfo,
	useMotionValue,
	useTransform,
} from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/app/components/PageShell";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
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
import { useJoinChallenge, useLeaveChallenge } from "@/mutations/challenges";
import { useAuth } from "@/providers/AuthProvider";
import {
	type Challenge,
	challengeListOptions,
	challengeProgressOptions,
	userChallengesOptions,
} from "@/queries/challenges";

// ---- Shared helper functions ----

function getDifficultyColor(difficulty: string) {
	switch (difficulty) {
		case "easy":
			return "bg-success";
		case "medium":
			return "bg-accent";
		case "hard":
			return "bg-primary";
		case "extreme":
			return "bg-chart-2";
		default:
			return "from-muted to-muted";
	}
}

function getDaysRemaining(endDate: string) {
	const end = new Date(endDate);
	const now = new Date();
	const diff = Math.ceil(
		(end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
	);
	return Math.max(0, diff);
}

// ---- Shared progress bar component ----

function ChallengeProgressBar({
	userId,
	challengeId,
	challengeType,
	targetValue,
	startDate,
	endDate,
	compact = false,
}: {
	userId: string;
	challengeId: string;
	challengeType: string;
	targetValue: number;
	startDate: string;
	endDate: string;
	compact?: boolean;
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

	if (compact) {
		return (
			<div className="mb-3">
				<div className="flex items-center justify-between mb-1">
					<span className="text-xs text-muted-foreground">Progress</span>
					<span className="text-xs font-semibold text-primary">
						{percentage}%
					</span>
				</div>
				<Progress value={percentage} className="h-2" />
			</div>
		);
	}

	return (
		<div>
			<div className="flex items-center justify-between mb-2 text-sm">
				<span className="text-muted-foreground">Your Progress</span>
				<span className="text-white">{percentage}%</span>
			</div>
			<Progress value={percentage} className="h-3" />
			{progress && (
				<div className="text-xs text-muted-foreground mt-1">
					{progress.current.toLocaleString()} /{" "}
					{progress.target.toLocaleString()}
				</div>
			)}
		</div>
	);
}

// ---- Desktop ChallengeCard ----

function ChallengeCard({
	challenge,
	index,
	isJoined,
	isExpanded,
	daysRemaining: _daysRemaining,
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
	userId: string;
	onToggleExpand: () => void;
	onJoin: () => void;
	onLeave: () => void;
	joinPending: boolean;
	leavePending: boolean;
}) {
	const daysLeft = getDaysRemaining(challenge.end_date);

	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ delay: index * 0.1 }}
		>
			<Card className="p-6 bg-surface-2 border-secondary hover:border-primary/50 transition-all">
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
										<h3 className="text-xl text-white">{challenge.name}</h3>
										<p className="text-sm text-muted-foreground">
											{challenge.description}
										</p>
									</div>
								</div>
								<Badge
									className={`${getDifficultyColor(challenge.difficulty)} text-white border-0`}
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
								<div className="text-xs text-muted-foreground mb-1">Target</div>
								<div className="text-xl text-white">
									{challenge.target_value.toLocaleString()}{" "}
									{challenge.target_unit}
								</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground mb-1">
									Time Left
								</div>
								<div className="text-xl text-warning">{daysLeft} days</div>
							</div>
							<div>
								<div className="text-xs text-muted-foreground mb-1">Type</div>
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
								<div className="text-xs text-muted-foreground mb-2">Prize</div>
								<div className="text-white">{challenge.prize}</div>
							</div>
						)}
						{isJoined ? (
							<div className="space-y-2">
								<Button
									variant="cta"
									className="w-full"
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
								variant="cta"
								className="w-full"
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
							onClick={() => toast("Leaderboard coming in a future update")}
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

// ---- Mobile SwipeableCard ----

function SwipeableCard({
	children,
	onSwipeLeft,
	onSwipeRight,
	leftLabel,
	rightLabel,
}: {
	children: React.ReactNode;
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	leftLabel?: string;
	rightLabel?: string;
}) {
	const x = useMotionValue(0);
	const [isDragging, setIsDragging] = useState(false);

	const leftBg = useTransform(
		x,
		[-100, 0],
		["rgba(239, 68, 68, 0.3)", "rgba(239, 68, 68, 0)"],
	);
	const rightBg = useTransform(
		x,
		[0, 100],
		["rgba(255, 107, 53, 0)", "rgba(255, 107, 53, 0.3)"],
	);
	const leftOpacity = useTransform(x, [-100, 0], [1, 0]);
	const rightOpacity = useTransform(x, [0, 100], [0, 1]);

	const handleDragEnd = (_: unknown, info: PanInfo) => {
		setIsDragging(false);
		if (info.offset.x < -100 && onSwipeLeft) {
			onSwipeLeft();
		} else if (info.offset.x > 100 && onSwipeRight) {
			onSwipeRight();
		}
	};

	return (
		<div className="relative overflow-hidden rounded-xl">
			<motion.div
				className="absolute inset-0 flex items-center justify-start pl-6"
				style={{ backgroundColor: leftBg, opacity: leftOpacity }}
			>
				<span className="text-destructive font-semibold text-sm">
					{leftLabel || "Leave"}
				</span>
			</motion.div>

			<motion.div
				className="absolute inset-0 flex items-center justify-end pr-6"
				style={{ backgroundColor: rightBg, opacity: rightOpacity }}
			>
				<span className="text-primary font-semibold text-sm">
					{rightLabel || "View"}
				</span>
			</motion.div>

			<motion.div
				drag="x"
				dragConstraints={{ left: 0, right: 0 }}
				dragElastic={0.2}
				style={{ x }}
				onDragStart={() => setIsDragging(true)}
				onDragEnd={handleDragEnd}
				className={isDragging ? "cursor-grabbing" : "cursor-grab"}
			>
				{children}
			</motion.div>
		</div>
	);
}

// ---- Mobile ChallengeCard (compact) ----

function MobileChallengeCard({
	challenge,
	isJoined,
	userId,
}: {
	challenge: Challenge;
	isJoined: boolean;
	userId: string;
}) {
	return (
		<Card className="p-4 bg-surface-2 border-secondary">
			<div className="flex items-start gap-3">
				<div className="text-3xl">
					{challenge.challenge_type === "volume"
						? "🏋️"
						: challenge.challenge_type === "streak"
							? "🔥"
							: challenge.challenge_type === "pr_count"
								? "💎"
								: "🎯"}
				</div>
				<div className="flex-1 min-w-0">
					<h3 className="text-white font-semibold mb-2 truncate">
						{challenge.name}
					</h3>

					{isJoined && (
						<ChallengeProgressBar
							userId={userId}
							challengeId={challenge.id}
							challengeType={challenge.challenge_type}
							targetValue={challenge.target_value}
							startDate={challenge.start_date}
							endDate={challenge.end_date}
							compact
						/>
					)}

					<div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
						<div className="flex items-center gap-1">
							<Trophy className="w-3 h-3" />
							<span>{challenge.difficulty}</span>
						</div>
						<div className="flex items-center gap-1">
							<span>{getDaysRemaining(challenge.end_date)} days left</span>
						</div>
					</div>
				</div>
			</div>
		</Card>
	);
}

// ---- Main Challenges Component ----

export function Challenges() {
	const { user } = useAuth();
	const userId = user?.id ?? "";

	const { data: challenges, isPending: challengesLoading } = useQuery(
		challengeListOptions(),
	);
	const { data: userChallenges } = useQuery(userChallengesOptions(userId));

	const joinMutation = useJoinChallenge();
	const leaveMutation = useLeaveChallenge();

	// Desktop state
	const [expandedId, setExpandedId] = useState<string | null>(null);

	// Mobile state
	const [mobileExpandedId, setMobileExpandedId] = useState<string | null>(null);
	const [leaveConfirmId, setLeaveConfirmId] = useState<string | null>(null);

	const joinedIds = new Set(
		(userChallenges ?? []).map((uc) => uc.challenge_id),
	);
	const completedIds = new Set(
		(userChallenges ?? [])
			.filter((uc) => uc.completed_at)
			.map((uc) => uc.challenge_id),
	);

	const activeChallenges = (challenges ?? []).filter(
		(c) => !completedIds.has(c.id),
	);
	const pastChallenges = (challenges ?? []).filter((c) =>
		completedIds.has(c.id),
	);
	const discoverChallenges = (challenges ?? []).filter(
		(c) => !joinedIds.has(c.id) && !completedIds.has(c.id),
	);

	const confirmLeave = () => {
		if (leaveConfirmId) {
			leaveMutation.mutate(leaveConfirmId);
			setLeaveConfirmId(null);
		}
	};

	if (challengesLoading) {
		return (
			<div className="min-h-screen pb-20 md:pb-8">
				{/* Mobile loading */}
				<div className="block md:hidden">
					<header className="px-4 py-4 border-b border-secondary">
						<Skeleton className="h-8 w-32" />
					</header>
					<div className="px-4 py-4 space-y-4">
						{Array.from({ length: 3 }).map((_, i) => (
							<Skeleton key={i} className="h-32 w-full" />
						))}
					</div>
				</div>
				{/* Desktop loading */}
				<div className="hidden md:block">
					<PageShell>
						<Skeleton className="h-10 w-48 mb-2" />
						<Skeleton className="h-5 w-64 mb-8" />
						<div className="space-y-4">
							{Array.from({ length: 3 }).map((_, i) => (
								<Skeleton key={i} className="h-48 w-full" />
							))}
						</div>
					</PageShell>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen pb-20 md:pb-8">
			{/* ---- MOBILE LAYOUT (< 768px) ---- */}
			<div className="block md:hidden">
				{/* Mobile Header */}
				<header className="px-4 py-4 border-b border-secondary">
					<h1 className="text-2xl font-bold text-white">Challenges</h1>
				</header>

				{/* Mobile Tabs */}
				<Tabs defaultValue="active">
					<div className="overflow-x-auto scrollbar-hide border-b border-secondary">
						<TabsList className="flex px-4 gap-1 bg-transparent">
							<TabsTrigger
								value="active"
								className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary"
							>
								Active
							</TabsTrigger>
							<TabsTrigger
								value="past"
								className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary"
							>
								Past
							</TabsTrigger>
							<TabsTrigger
								value="discover"
								className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary"
							>
								Discover
							</TabsTrigger>
						</TabsList>
					</div>

					{/* Mobile Active Challenges */}
					<TabsContent value="active" className="px-4 py-4 space-y-4 mt-0">
						{activeChallenges.filter((c) => joinedIds.has(c.id)).length ===
						0 ? (
							<div className="text-center py-12 text-muted-foreground">
								<Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p>No active challenges right now</p>
								<p className="text-xs mt-1">
									Join a challenge from the Discover tab
								</p>
							</div>
						) : (
							<>
								<div className="text-xs text-muted-foreground mb-2">
									Swipe left to leave, right to view
								</div>
								{activeChallenges
									.filter((c) => joinedIds.has(c.id))
									.map((challenge) => (
										<div key={challenge.id}>
											<SwipeableCard
												onSwipeRight={() =>
													setMobileExpandedId(
														mobileExpandedId === challenge.id
															? null
															: challenge.id,
													)
												}
												onSwipeLeft={() => setLeaveConfirmId(challenge.id)}
											>
												<MobileChallengeCard
													challenge={challenge}
													isJoined={true}
													userId={userId}
												/>
											</SwipeableCard>
											{mobileExpandedId === challenge.id && (
												<Card className="p-4 mt-1 bg-surface-2 border-secondary rounded-xl">
													<p className="text-sm text-secondary-foreground mb-2">
														{challenge.description}
													</p>
													<div className="flex items-center gap-4 text-xs text-muted-foreground">
														<span className="capitalize">
															{challenge.challenge_type}
														</span>
														<span>Target: {challenge.target_value}</span>
														{challenge.prize && (
															<span className="text-accent">
																{challenge.prize}
															</span>
														)}
													</div>
												</Card>
											)}
										</div>
									))}
							</>
						)}
					</TabsContent>

					{/* Mobile Leave confirmation dialog */}
					<AlertDialog
						open={!!leaveConfirmId}
						onOpenChange={(open) => !open && setLeaveConfirmId(null)}
					>
						<AlertDialogContent className="bg-background border-secondary">
							<AlertDialogHeader>
								<AlertDialogTitle className="text-white">
									Leave challenge?
								</AlertDialogTitle>
								<AlertDialogDescription>
									Your progress in this challenge will be lost. This action
									cannot be undone.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel
									className="border-secondary text-muted-foreground"
									onClick={() => setLeaveConfirmId(null)}
								>
									Cancel
								</AlertDialogCancel>
								<AlertDialogAction
									className="bg-destructive hover:bg-destructive/90"
									onClick={confirmLeave}
								>
									Leave
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>

					{/* Mobile Past Challenges */}
					<TabsContent value="past" className="px-4 py-12 mt-0">
						{completedIds.size === 0 ? (
							<div className="text-center text-muted-foreground">
								<Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p>No past challenges yet</p>
								<p className="text-xs mt-1">
									Complete your first challenge to see it here
								</p>
							</div>
						) : (
							<div className="space-y-4">
								{(challenges ?? [])
									.filter((c) => completedIds.has(c.id))
									.map((challenge) => (
										<Card
											key={challenge.id}
											className="p-4 bg-surface-2 border-secondary"
										>
											<h3 className="text-white font-semibold mb-1">
												{challenge.name}
											</h3>
											<p className="text-xs text-muted-foreground mb-2">
												{challenge.description}
											</p>
											{challenge.prize && (
												<div className="text-xs text-accent">
													{challenge.prize}
												</div>
											)}
										</Card>
									))}
							</div>
						)}
					</TabsContent>

					{/* Mobile Discover */}
					<TabsContent value="discover" className="px-4 py-4 mt-0">
						{discoverChallenges.length === 0 ? (
							<div className="text-center py-12 text-muted-foreground">
								<Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
								<p>No new challenges available</p>
								<p className="text-xs mt-1">Check back soon</p>
							</div>
						) : (
							<div className="space-y-4">
								{discoverChallenges.map((challenge) => (
									<Card
										key={challenge.id}
										className="p-4 bg-surface-2 border-secondary"
									>
										<h3 className="text-white font-semibold mb-1">
											{challenge.name}
										</h3>
										<p className="text-xs text-muted-foreground mb-3">
											{challenge.description}
										</p>
										<div className="flex items-center justify-between">
											<span className="text-xs text-muted-foreground capitalize">
												{challenge.difficulty} | {challenge.challenge_type}
											</span>
											<button
												onClick={() => joinMutation.mutate(challenge.id)}
												disabled={joinMutation.isPending}
												className="px-4 py-1.5 text-sm font-medium rounded-lg bg-primary text-white"
											>
												{joinMutation.isPending ? (
													<Loader2 className="w-4 h-4 animate-spin" />
												) : (
													"Join"
												)}
											</button>
										</div>
									</Card>
								))}
							</div>
						)}
					</TabsContent>
				</Tabs>
			</div>

			{/* ---- DESKTOP LAYOUT (>= 768px) ---- */}
			<div className="hidden md:block">
				<PageShell>
					{/* Desktop Header */}
					<div className="mb-8">
						<h1 className="text-3xl sm:text-4xl mb-2 text-white">Challenges</h1>
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

						{/* Desktop Active Challenges Tab */}
						<TabsContent value="active" className="space-y-6">
							{activeChallenges.length === 0 ? (
								<div className="text-center py-16">
									<Trophy className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
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
										userId={userId}
										onToggleExpand={() =>
											setExpandedId(
												expandedId === challenge.id ? null : challenge.id,
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

						{/* Desktop Past Challenges Tab */}
						<TabsContent value="past" className="space-y-6">
							{pastChallenges.length === 0 ? (
								<div className="text-center py-16">
									<Trophy className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
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
											<Card className="p-6 bg-surface-2 border-secondary h-full">
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
				</PageShell>
			</div>
		</div>
	);
}
