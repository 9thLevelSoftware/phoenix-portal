import { ArrowBigUp } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { useVote } from "@/mutations/community";

interface VoteButtonProps {
	itemId: string;
	itemType: "routine" | "cycle";
	voteCount: number;
	isVoted: boolean;
	compact?: boolean;
}

export function VoteButton({
	itemId,
	itemType,
	voteCount,
	isVoted,
	compact = false,
}: VoteButtonProps) {
	const vote = useVote();

	const handleClick = () => {
		vote.mutate({ itemId, itemType });
	};

	return (
		<motion.div whileTap={{ scale: 0.9 }}>
			<Button
				variant="ghost"
				size={compact ? "sm" : "default"}
				className={cn(
					"flex items-center gap-1",
					compact && "h-8 px-2",
					isVoted && "text-[#FF6B35] hover:text-[#FF6B35]/80",
					!isVoted && "text-muted-foreground hover:text-foreground",
				)}
				onClick={handleClick}
				disabled={vote.isPending}
			>
				<ArrowBigUp
					className={cn(
						compact ? "h-4 w-4" : "h-5 w-5",
						isVoted && "fill-[#FF6B35]",
					)}
				/>
				<span
					className={cn(
						"text-sm font-medium tabular-nums",
						isVoted ? "text-[#FF6B35]" : "text-muted-foreground",
					)}
				>
					{voteCount}
				</span>
			</Button>
		</motion.div>
	);
}
