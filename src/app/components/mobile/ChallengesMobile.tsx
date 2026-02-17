import { ChevronRight, Target, TrendingUp, Trophy } from "lucide-react";
import {
	motion,
	type PanInfo,
	useMotionValue,
	useTransform,
} from "motion/react";
import { useState } from "react";
import { Card } from "@/app/components/ui/card";
import { Progress } from "@/app/components/ui/progress";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/app/components/ui/tabs";

interface Challenge {
	id: string;
	name: string;
	icon: string;
	progress: number;
	rank: number;
	totalParticipants: number;
	daysRemaining: number;
	metric: string;
	currentValue: number;
}

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
			{/* Background Actions */}
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

			{/* Draggable Content */}
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

function ChallengeCard({
	challenge,
	onView,
}: {
	challenge: Challenge;
	onView: () => void;
}) {
	return (
		<Card className="p-4 bg-gradient-to-br from-surface-2 to-background border-secondary">
			<div className="flex items-start gap-3">
				<div className="text-3xl">{challenge.icon}</div>
				<div className="flex-1 min-w-0">
					<h3 className="text-white font-semibold mb-2 truncate">
						{challenge.name}
					</h3>

					{/* Progress Bar */}
					<div className="mb-3">
						<div className="flex items-center justify-between mb-1">
							<span className="text-xs text-muted-foreground">Progress</span>
							<span className="text-xs font-semibold text-primary">
								{challenge.progress}%
							</span>
						</div>
						<Progress value={challenge.progress} className="h-2" />
					</div>

					{/* Stats */}
					<div className="flex items-center gap-4 text-xs text-muted-foreground">
						<div className="flex items-center gap-1">
							<Trophy className="w-3 h-3" />
							<span>
								Rank #{challenge.rank} of {challenge.totalParticipants}
							</span>
						</div>
						<div className="flex items-center gap-1">
							<span>{challenge.daysRemaining} days left</span>
						</div>
					</div>

					{/* Current Value */}
					<div className="mt-2 text-sm">
						<span className="text-muted">{challenge.metric}: </span>
						<span className="text-white font-semibold">
							{challenge.currentValue.toLocaleString()}
						</span>
					</div>
				</div>

				<button
					onClick={onView}
					className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
				>
					<ChevronRight className="w-5 h-5" />
				</button>
			</div>
		</Card>
	);
}

function LeaderboardRow({
	rank,
	name,
	value,
	isUser = false,
}: {
	rank: number;
	name: string;
	value: string;
	isUser?: boolean;
}) {
	const medal =
		rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

	return (
		<div
			className={`flex items-center gap-3 p-3 rounded-lg ${
				isUser
					? "bg-primary/10 border border-primary/30 sticky top-0"
					: "bg-background"
			}`}
		>
			<div className="w-10 text-center">
				{medal || (
					<span className="text-muted text-sm font-semibold">{rank}</span>
				)}
			</div>
			<div className="flex-1 min-w-0">
				<p
					className={`font-medium truncate ${isUser ? "text-white" : "text-secondary-foreground"}`}
				>
					{name}
					{isUser && <span className="ml-2 text-xs text-primary">(You)</span>}
				</p>
			</div>
			<div className="text-right">
				<p className="text-white font-semibold">{value}</p>
			</div>
			{isUser && (
				<div className="text-success text-xs">
					<TrendingUp className="w-4 h-4" />
				</div>
			)}
		</div>
	);
}

export function ChallengesMobile() {
	const [activeTab, setActiveTab] = useState("active");

	const activeChallenges: Challenge[] = [
		{
			id: "1",
			name: "January Volume Challenge",
			icon: "🔥",
			progress: 68,
			rank: 12,
			totalParticipants: 150,
			daysRemaining: 12,
			metric: "Total Volume",
			currentValue: 186500,
		},
		{
			id: "2",
			name: "PR Hunter",
			icon: "💎",
			progress: 45,
			rank: 8,
			totalParticipants: 50,
			daysRemaining: 12,
			metric: "PRs Achieved",
			currentValue: 9,
		},
		{
			id: "3",
			name: "30-Day Streak",
			icon: "🔥",
			progress: 87,
			rank: 25,
			totalParticipants: 100,
			daysRemaining: 4,
			metric: "Days Trained",
			currentValue: 26,
		},
	];

	const leaderboard = [
		{ rank: 1, name: "Marcus Chen", value: "274,200 kg" },
		{ rank: 2, name: "Sarah Williams", value: "268,500 kg" },
		{ rank: 3, name: "David Rodriguez", value: "251,800 kg" },
		{ rank: 4, name: "Emma Thompson", value: "243,100 kg" },
		{ rank: 5, name: "James Lee", value: "238,900 kg" },
		{ rank: 6, name: "Lisa Park", value: "235,600 kg" },
		{ rank: 7, name: "Chris Anderson", value: "232,100 kg" },
		{ rank: 8, name: "Amy Zhang", value: "228,400 kg" },
		{ rank: 9, name: "Mike Johnson", value: "225,700 kg" },
		{ rank: 10, name: "Rachel Kim", value: "222,300 kg" },
		{ rank: 11, name: "Tom Wilson", value: "219,500 kg" },
		{ rank: 12, name: "You", value: "186,500 kg" },
		{ rank: 13, name: "Mike Johnson", value: "184,200 kg" },
		{ rank: 14, name: "Anna Davis", value: "181,800 kg" },
		{ rank: 15, name: "John Smith", value: "179,400 kg" },
	];

	const handleViewChallenge = (challengeId: string) => {
		console.log("View challenge:", challengeId);
	};

	const handleLeaveChallenge = (challengeId: string) => {
		console.log("Leave challenge:", challengeId);
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
							value="leaderboard"
							className="px-4 py-3 text-sm font-medium whitespace-nowrap data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-primary"
						>
							Board
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
					<div className="text-xs text-muted mb-2">
						← Swipe for actions →
					</div>
					{activeChallenges.map((challenge) => (
						<SwipeableCard
							key={challenge.id}
							onSwipeRight={() => handleViewChallenge(challenge.id)}
							onSwipeLeft={() => handleLeaveChallenge(challenge.id)}
						>
							<ChallengeCard
								challenge={challenge}
								onView={() => handleViewChallenge(challenge.id)}
							/>
						</SwipeableCard>
					))}
				</TabsContent>

				{/* Leaderboard */}
				<TabsContent value="leaderboard" className="mt-0">
					<div className="p-4 border-b border-secondary bg-surface-2">
						<h2 className="text-white font-semibold mb-1">
							January Volume Challenge
						</h2>
						<p className="text-sm text-muted-foreground">Your Rank: #12 of 150</p>
					</div>

					<div className="px-4 py-4 space-y-2">
						{leaderboard.map((entry) => (
							<LeaderboardRow
								key={entry.rank}
								rank={entry.rank}
								name={entry.name}
								value={entry.value}
								isUser={entry.name === "You"}
							/>
						))}
					</div>
				</TabsContent>

				{/* Past Challenges */}
				<TabsContent value="past" className="px-4 py-12 mt-0">
					<div className="text-center text-muted">
						<Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
						<p>No past challenges yet</p>
						<p className="text-xs mt-1">
							Complete your first challenge to see it here
						</p>
					</div>
				</TabsContent>

				{/* Discover */}
				<TabsContent value="discover" className="px-4 py-12 mt-0">
					<div className="text-center text-muted">
						<Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
						<p>Discover new challenges</p>
						<p className="text-xs mt-1">Coming soon</p>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
