import { useNavigate } from "react-router";
import { BadgeEarned } from "@/app/components/celebrations/BadgeEarned";
import { ChallengeWon } from "@/app/components/celebrations/ChallengeWon";
import { PRCelebration } from "@/app/components/celebrations/PRCelebration";
import { StreakMilestone } from "@/app/components/celebrations/StreakMilestone";
import { WorkoutComplete } from "@/app/components/celebrations/WorkoutComplete";
import { useCelebrationStore } from "@/stores/useCelebrationStore";

/**
 * Global celebration overlay -- renders celebration animations on top of any page.
 * Mount once in AppLayout. Reads from the Zustand celebration store.
 */
export function CelebrationOverlay() {
	const current = useCelebrationStore((s) => s.current);
	const dismiss = useCelebrationStore((s) => s.dismiss);
	const navigate = useNavigate();

	if (!current) return null;

	switch (current.type) {
		case "pr":
			return (
				<PRCelebration
					isOpen
					onClose={dismiss}
					prData={{
						exerciseName: current.exerciseName,
						weight: current.weight,
						reps: current.reps,
						estimated1RM: current.estimated1RM,
						improvement: current.improvement,
						type: current.prType,
					}}
				/>
			);

		case "streak":
			return (
				<StreakMilestone isOpen onClose={dismiss} streak={current.streak} />
			);

		case "workout_complete":
			return (
				<WorkoutComplete
					isOpen
					onClose={dismiss}
					duration={current.duration}
					volume={current.volume}
					prsAchieved={current.prsAchieved}
					streakContinued={current.streakContinued}
					onViewSummary={() => {
						dismiss();
						navigate("/history");
					}}
				/>
			);

		case "challenge_won":
			return (
				<ChallengeWon
					placement={current.placement}
					challengeName={current.challengeName}
					challengeType={current.challengeType}
					rewards={current.rewards}
					onDismiss={dismiss}
					onViewResults={() => {
						dismiss();
						navigate("/challenges");
					}}
				/>
			);

		case "badge":
			return (
				<BadgeEarned
					isOpen
					onClose={dismiss}
					badgeData={{
						name: current.name,
						description: current.description,
						tier: current.tier,
						icon: current.icon,
					}}
				/>
			);

		default:
			return null;
	}
}
