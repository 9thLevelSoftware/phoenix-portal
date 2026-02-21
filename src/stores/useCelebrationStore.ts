import { create } from "zustand";
import type { ChallengeReward } from "@/app/components/celebrations/challenge-won/types";

// ---- Celebration payload types ----

export interface PRCelebrationData {
	type: "pr";
	exerciseName: string;
	weight: number;
	reps: number;
	estimated1RM: number;
	improvement: number;
	prType: "weight" | "volume" | "1rm";
}

export interface StreakCelebrationData {
	type: "streak";
	streak: number;
}

export interface WorkoutCompleteCelebrationData {
	type: "workout_complete";
	duration: string;
	volume: string;
	prsAchieved: number;
	streakContinued: boolean;
}

export interface ChallengeWonCelebrationData {
	type: "challenge_won";
	placement: 1 | 2 | 3;
	challengeName: string;
	challengeType: string;
	rewards: ChallengeReward[];
}

export interface BadgeEarnedCelebrationData {
	type: "badge";
	name: string;
	description: string;
	tier: "bronze" | "silver" | "gold" | "platinum";
	icon: string;
}

export type CelebrationData =
	| PRCelebrationData
	| StreakCelebrationData
	| WorkoutCompleteCelebrationData
	| ChallengeWonCelebrationData
	| BadgeEarnedCelebrationData;

// ---- Store ----

interface CelebrationState {
	/** Queue of celebrations waiting to be shown */
	queue: CelebrationData[];
	/** The currently displayed celebration (first in queue) */
	current: CelebrationData | null;

	/** Enqueue a celebration. If nothing is showing, it becomes current immediately. */
	trigger: (celebration: CelebrationData) => void;
	/** Dismiss the current celebration and show the next in queue (if any). */
	dismiss: () => void;
	/** Clear all celebrations (e.g., on logout). */
	clearAll: () => void;
}

export const useCelebrationStore = create<CelebrationState>()((set) => ({
	queue: [],
	current: null,

	trigger: (celebration) =>
		set((state) => {
			if (state.current === null) {
				// Nothing showing -- show immediately
				return { current: celebration };
			}
			// Something already showing -- enqueue
			return { queue: [...state.queue, celebration] };
		}),

	dismiss: () =>
		set((state) => {
			const [next, ...rest] = state.queue;
			if (next) {
				return { current: next, queue: rest };
			}
			return { current: null, queue: [] };
		}),

	clearAll: () => set({ queue: [], current: null }),
}));
