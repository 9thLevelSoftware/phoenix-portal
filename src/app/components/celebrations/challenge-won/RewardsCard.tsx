import { Award, Star, Trophy, Zap } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/app/components/ui/card";
import type { ChallengeReward } from "./types";

interface RewardsCardProps {
	rewards: ChallengeReward[];
}

export function RewardsCard({ rewards }: RewardsCardProps) {
	const getRewardIcon = (reward: ChallengeReward) => {
		if (reward.icon) {
			return <span className="text-2xl">{reward.icon}</span>;
		}

		switch (reward.type) {
			case "badge":
				return <Award className="w-6 h-6 text-accent" />;
			case "premium":
				return <Zap className="w-6 h-6 text-warning" />;
			case "points":
				return <Star className="w-6 h-6 text-primary" />;
			case "title":
				return <Trophy className="w-6 h-6 text-success" />;
			default:
				return <Trophy className="w-6 h-6 text-muted-foreground" />;
		}
	};

	return (
		<motion.div
			initial={{ y: 50, opacity: 0 }}
			animate={{ y: 0, opacity: 1 }}
			transition={{
				type: "spring",
				damping: 20,
				delay: 3.0,
			}}
			className="w-full max-w-md mx-auto px-4"
		>
			<Card className="p-6 bg-surface-2 border-secondary">
				<h3 className="text-lg font-semibold text-white mb-4 text-center">
					REWARDS EARNED
				</h3>

				<div className="space-y-3">
					{rewards.map((reward, index) => (
						<motion.div
							key={index}
							initial={{ x: -20, opacity: 0 }}
							animate={{ x: 0, opacity: 1 }}
							transition={{
								delay: 3.2 + index * 0.1,
								type: "spring",
								damping: 20,
							}}
							className="flex items-center gap-3 p-3 bg-background rounded-lg border border-secondary"
						>
							<div className="flex-shrink-0">{getRewardIcon(reward)}</div>
							<div className="flex-1">
								<p className="text-white font-medium">{reward.name}</p>
								<p className="text-xs text-muted-foreground capitalize">
									{reward.type}
								</p>
							</div>
						</motion.div>
					))}
				</div>
			</Card>
		</motion.div>
	);
}
