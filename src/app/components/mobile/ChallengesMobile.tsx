import { useQuery } from "@tanstack/react-query";
import { Loader2, Target, Trophy } from "lucide-react";
import {
	motion,
	type PanInfo,
	useMotionValue,
	useTransform,
} from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
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

interface SwipeableCardProps {
	children: React.ReactNode;
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	leftLabel?: string;
	rightLabel?: string;
}

function SwipeableCard({
	children,
	onSwipeLeft,
	onSwipeRight,
	leftLabel,
	rightLabel,
}: SwipeableCardProps) {
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

	const handleDragEnd = (_: any, info: PanInfo) => {
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
		<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
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
						<MobileProgressBar
							userId={userId}
							challengeId={challenge.id}
							challengeType={challenge.challenge_type}
							targetValue={challenge.target_value}
							startDate={challenge.start_date}
							endDate={challenge.end_date}
						/>
					)}

					<div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
						<div className="flex items-center gap-1">
							<Trophy className="w-3 h-3" />
							<span>{challenge.difficulty}</span>
						</div>
						<div className="flex items-center gap-1">
							<span>
								{Math.max(
									0,
									Math.ceil(
										(new Date(challenge.end_date).getTime() - Date.now()) /
											(1000 * 60 * 60 * 24),
									),
								)}{" "}
								days left
							</span>
						</div>
					</div>
				</div>
			</div>
		</Card>
	);
}

function MobileProgressBar({
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

export function ChallengesMobile() {
	const { user } = useAuth();
	const userId = user?.id ?? "";
	const [activeTab, setActiveTab] = useState("active");
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const { data: challenges, isPending } = useQuery(challengeListOptions());
	const { data: userChallenges } = useQuery(userChallengesOptions(userId));

	const joinMutation = useJoinChallenge();
	const leaveMutation = useLeaveChallenge();

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
	const discoverChallenges = (challenges ?? []).filter(
		(c) => !joinedIds.has(c.id) && !completedIds.has(c.id),
	);

	if (isPending) {
		return (
			<div className="min-h-screen bg-background pb-20">
				<header className="px-4 py-4 border-b border-secondary">
					<Skeleton className="h-8 w-32" />
				</header>
				<div className="px-4 py-4 space-y-4">
					{Array.from({ length: 3 }).map((_, i) => (
						<Skeleton key={i} className="h-32 w-full" />
					))}
				</div>
			</div>
		);
	}

	const handleViewChallenge = (challengeId: string) => {
		setExpandedId(expandedId === challengeId ? null : challengeId);
	};

	const handleLeaveChallenge = (challengeId: string) => {
		leaveMutation.mutate(challengeId);
	};

	return (
		<div className="min-h-screen bg-background pb-20">
			{/* Header */}
			<header className="px-4 py-4 border-b border-secondary">
				<h1 className="text-2xl font-bold">
					<span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
						Challenges
					</span>
				</h1>
			</header>

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
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

				{/* Active Challenges */}
				<TabsContent value="active" className="px-4 py-4 space-y-4 mt-0">
					{activeChallenges.filter((c) => joinedIds.has(c.id)).length === 0 ? (
						<div className="text-center py-12 text-muted">
							<Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
							<p>No active challenges right now</p>
							<p className="text-xs mt-1">
								Join a challenge from the Discover tab
							</p>
						</div>
					) : (
						<>
							<div className="text-xs text-muted mb-2">
								Swipe left to leave, right to view
							</div>
							{activeChallenges
								.filter((c) => joinedIds.has(c.id))
								.map((challenge) => (
									<SwipeableCard
										key={challenge.id}
										onSwipeRight={() => handleViewChallenge(challenge.id)}
										onSwipeLeft={() => handleLeaveChallenge(challenge.id)}
									>
										<MobileChallengeCard
											challenge={challenge}
											isJoined={true}
											userId={userId}
										/>
									</SwipeableCard>
								))}
						</>
					)}
				</TabsContent>

				{/* Past Challenges */}
				<TabsContent value="past" className="px-4 py-12 mt-0">
					{completedIds.size === 0 ? (
						<div className="text-center text-muted">
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
										className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary"
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

				{/* Discover */}
				<TabsContent value="discover" className="px-4 py-4 mt-0">
					{discoverChallenges.length === 0 ? (
						<div className="text-center py-12 text-muted">
							<Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
							<p>No new challenges available</p>
							<p className="text-xs mt-1">Check back soon</p>
						</div>
					) : (
						<div className="space-y-4">
							{discoverChallenges.map((challenge) => (
								<Card
									key={challenge.id}
									className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary"
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
											className="px-4 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-primary to-chart-2 text-white"
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
	);
}
