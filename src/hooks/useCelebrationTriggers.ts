import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuth } from "@/app/hooks/useAuth";
import { queryKeys } from "@/queries/keys";
import type { PersonalRecord, WorkoutSession } from "@/schemas/transforms";
import { useCelebrationStore } from "@/stores/useCelebrationStore";

/**
 * Streak values at which we fire the StreakMilestone celebration.
 * Matches the milestoneMessages keys in StreakMilestone.tsx, plus 3-day starter.
 */
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90, 180, 365];

/**
 * PR count milestones that earn badges.
 * Maps count to { name, tier }.
 */
const PR_COUNT_BADGES: Record<
	number,
	{ name: string; tier: "bronze" | "silver" | "gold" | "platinum" }
> = {
	1: { name: "First Blood", tier: "bronze" },
	10: { name: "Record Breaker", tier: "silver" },
	25: { name: "PR Machine", tier: "gold" },
	50: { name: "Half Century", tier: "gold" },
	100: { name: "Century Legend", tier: "platinum" },
};

/** Workout count milestones that earn badges. */
const WORKOUT_COUNT_BADGES: Record<
	number,
	{ name: string; tier: "bronze" | "silver" | "gold" | "platinum" }
> = {
	1: { name: "First Workout", tier: "bronze" },
	10: { name: "Getting Serious", tier: "bronze" },
	25: { name: "Dedicated", tier: "silver" },
	50: { name: "Iron Regular", tier: "gold" },
	100: { name: "Century Club", tier: "gold" },
	250: { name: "Phoenix Veteran", tier: "platinum" },
};

/**
 * Monitors TanStack Query cache for data changes and triggers celebrations.
 *
 * Strategy: Subscribe to the query cache. When a query succeeds, compare
 * against a previous snapshot. On the FIRST successful load of each data
 * category, snapshot without triggering celebrations to avoid celebrating
 * every existing PR on login.
 *
 * Per-category initialization prevents race conditions when queries for
 * workouts, records, and challenges resolve at different times.
 */
export function useCelebrationTriggers() {
	const { user } = useAuth();
	const queryClient = useQueryClient();
	const trigger = useCelebrationStore((s) => s.trigger);

	// Per-category initialization flags
	const workoutsInitialized = useRef(false);
	const recordsInitialized = useRef(false);
	const challengesInitialized = useRef(false);

	// Refs to track what we've already seen
	const seenPRIds = useRef<Set<string>>(new Set());
	const seenWorkoutIds = useRef<Set<string>>(new Set());
	const lastStreak = useRef<number | null>(null);
	const lastChallengeCompletedIds = useRef<Set<string>>(new Set());

	// Last known counts for badge milestones
	const lastPRCount = useRef(0);
	const lastWorkoutCount = useRef(0);

	useEffect(() => {
		if (!user) return;

		const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
			// Only react to successful query updates
			if (
				event.type !== "updated" ||
				event.action.type !== "success"
			) {
				return;
			}

			const queryKey = event.query.queryKey;

			// ---- Workout list updated ----
			if (matchesQueryKey(queryKey, queryKeys.workouts.all)) {
				const data = event.query.state.data;
				if (!Array.isArray(data)) return;
				const workouts = data as WorkoutSession[];

				if (!workoutsInitialized.current) {
					// Snapshot on first load -- don't celebrate
					for (const w of workouts) seenWorkoutIds.current.add(w.id);
					lastWorkoutCount.current = workouts.length;
					lastStreak.current = computeStreak(workouts);
					workoutsInitialized.current = true;
					return;
				}

				// Detect new workouts
				const newWorkouts = workouts.filter(
					(w) => !seenWorkoutIds.current.has(w.id),
				);
				for (const w of workouts) seenWorkoutIds.current.add(w.id);

				// Fire WorkoutComplete for each new workout
				for (const workout of newWorkouts) {
					const duration = `${workout.duration_seconds} min`;
					const volume = `${workout.total_volume.toLocaleString()} kg`;

					trigger({
						type: "workout_complete",
						duration,
						volume,
						prsAchieved: workout.pr_count,
						streakContinued: computeStreak(workouts) > 0,
					});
				}

				// Check streak milestones
				const currentStreak = computeStreak(workouts);
				if (
					lastStreak.current !== null &&
					currentStreak > lastStreak.current
				) {
					// Did we cross a milestone boundary?
					for (const milestone of STREAK_MILESTONES) {
						if (
							lastStreak.current < milestone &&
							currentStreak >= milestone
						) {
							trigger({ type: "streak", streak: milestone });
							break; // Only fire the highest crossed milestone
						}
					}
				}
				lastStreak.current = currentStreak;

				// Check workout count badges
				const prevCount = lastWorkoutCount.current;
				const newCount = workouts.length;
				if (newCount > prevCount) {
					for (const [countStr, badge] of Object.entries(
						WORKOUT_COUNT_BADGES,
					)) {
						const count = Number(countStr);
						if (prevCount < count && newCount >= count) {
							trigger({
								type: "badge",
								name: badge.name,
								description: `Completed ${count} workout${count > 1 ? "s" : ""}`,
								tier: badge.tier,
								icon: "\u{1F4AA}",
							});
						}
					}
				}
				lastWorkoutCount.current = newCount;
			}

			// ---- Personal records updated ----
			if (matchesQueryKey(queryKey, queryKeys.records.all)) {
				const data = event.query.state.data;
				if (!Array.isArray(data)) return;
				const records = data as PersonalRecord[];

				if (!recordsInitialized.current) {
					for (const r of records) seenPRIds.current.add(r.id);
					lastPRCount.current = records.length;
					recordsInitialized.current = true;
					return;
				}

				// Detect new PRs
				const newPRs = records.filter(
					(r) => !seenPRIds.current.has(r.id),
				);
				for (const r of records) seenPRIds.current.add(r.id);

				// Fire PRCelebration for each new PR
				for (const pr of newPRs) {
					const improvement = pr.previous_value
						? pr.value - pr.previous_value
						: 0;

					trigger({
						type: "pr",
						exerciseName: pr.exercise_name,
						weight: pr.value,
						reps: 1, // Records don't store reps separately
						estimated1RM: pr.value, // Best approximation from record data
						improvement: Math.max(0, improvement),
						prType:
							pr.record_type === "1rm"
								? "1rm"
								: pr.record_type === "volume"
									? "volume"
									: "weight",
					});
				}

				// Check PR count badges
				const prevPRCount = lastPRCount.current;
				const newPRCount = records.length;
				if (newPRCount > prevPRCount) {
					for (const [countStr, badge] of Object.entries(
						PR_COUNT_BADGES,
					)) {
						const count = Number(countStr);
						if (prevPRCount < count && newPRCount >= count) {
							trigger({
								type: "badge",
								name: badge.name,
								description: `Achieved ${count} personal record${count > 1 ? "s" : ""}`,
								tier: badge.tier,
								icon: "\u{1F3C6}",
							});
						}
					}
				}
				lastPRCount.current = newPRCount;
			}

			// ---- Challenge data updated (user challenges with completed_at) ----
			if (matchesQueryKey(queryKey, queryKeys.challenges.all)) {
				const data = event.query.state.data;
				if (!Array.isArray(data)) return;

				// UserChallenge rows have completed_at and a nested challenges object
				const completedChallenges = data.filter(
					(uc: { completed_at: string | null; challenge_id?: string }) =>
						uc.completed_at != null,
				);

				if (!challengesInitialized.current) {
					for (const uc of completedChallenges) {
						lastChallengeCompletedIds.current.add(
							uc.challenge_id ?? uc.id,
						);
					}
					challengesInitialized.current = true;
					return;
				}

				for (const uc of completedChallenges) {
					const id = uc.challenge_id ?? uc.id;
					if (!lastChallengeCompletedIds.current.has(id)) {
						lastChallengeCompletedIds.current.add(id);

						// Extract challenge name from the nested join
						const challengeName =
							uc.challenges?.name ?? "Challenge Complete";

						trigger({
							type: "challenge_won",
							placement: 1, // We don't have leaderboard placement yet
							challengeName,
							challengeType:
								uc.challenges?.challenge_type ?? "Challenge",
							rewards: [
								{
									type: "badge",
									name: "Challenge Champion",
									icon: "\u{1F3C6}",
								},
							],
						});
					}
				}
			}
		});

		return () => {
			unsubscribe();
			// Reset on unmount (e.g., logout)
			workoutsInitialized.current = false;
			recordsInitialized.current = false;
			challengesInitialized.current = false;
			seenPRIds.current.clear();
			seenWorkoutIds.current.clear();
			lastStreak.current = null;
			lastChallengeCompletedIds.current.clear();
			lastPRCount.current = 0;
			lastWorkoutCount.current = 0;
		};
	}, [user, queryClient, trigger]);
}

// ---- Helpers ----

/** Check if a query key starts with the given prefix */
function matchesQueryKey(key: readonly unknown[], prefix: readonly string[]) {
	if (key.length < prefix.length) return false;
	return prefix.every((segment, i) => key[i] === segment);
}

/**
 * Compute consecutive workout-day streak from sessions.
 * Mirrors src/hooks/useStreak.ts logic.
 */
function computeStreak(workouts: WorkoutSession[]): number {
	if (workouts.length === 0) return 0;

	const uniqueDays = new Set(
		workouts.map((w) => {
			const d = w.started_at;
			return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		}),
	);

	let count = 0;
	const today = new Date();
	for (let i = 0; i < 365; i++) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		if (uniqueDays.has(key)) {
			count++;
		} else if (i > 0) {
			break;
		}
	}
	return count;
}
