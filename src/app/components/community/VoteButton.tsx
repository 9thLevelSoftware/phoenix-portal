import { ArrowBigUp } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/components/ui/utils";
import { useAuth } from "@/app/hooks/useAuth";
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
	const { user } = useAuth();

	const handleClick = (event: React.MouseEvent) => {
		// Prevent triggering a parent clickable card/drawer trigger.
		event.stopPropagation();
		if (!user) {
			toast.error("Sign in to vote on community content.");
			return;
		}
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
					isVoted && "text-primary hover:text-primary/80",
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
						isVoted ? "text-primary" : "text-muted-foreground",
					)}
				>
					{voteCount}
				</span>
			</Button>
		</motion.div>
	);
}
