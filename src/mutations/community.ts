import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Database, Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

// ---------- useVote (confirmed pattern) ----------

interface VoteMutationArgs {
	itemId: string;
	itemType: "routine" | "cycle";
}

export function useVote() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ itemId, itemType }: VoteMutationArgs) => {
			if (!user) throw new Error("Must be logged in to vote");

			// Check if vote already exists
			const { data: existing, error: checkError } = await supabase
				.from("community_votes")
				.select("id")
				.eq("user_id", user.id)
				.eq("item_id", itemId)
				.eq("item_type", itemType)
				.maybeSingle();

			if (checkError) throw checkError;

			if (existing) {
				// Remove vote
				const { error } = await supabase
					.from("community_votes")
					.delete()
					.eq("id", existing.id);
				if (error) throw error;
				return { action: "removed" as const };
			} else {
				// Add vote
				const { error } = await supabase
					.from("community_votes")
					.insert({ user_id: user.id, item_id: itemId, item_type: itemType });
				if (error) throw error;
				return { action: "added" as const };
			}
		},

		onSuccess: () => {
			// Confirmed pattern: invalidate to refetch fresh data from server
			queryClient.invalidateQueries({
				queryKey: queryKeys.community.all,
			});
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.votes(user.id),
				});
			}
		},
	});
}

// ---------- useShareContent ----------

interface ShareContentArgs {
	type: "routine" | "cycle";
	sourceId: string;
	name: string;
	description: string;
	tags: string[];
	difficulty: "Beginner" | "Intermediate" | "Advanced";
}

type RoutineRow = Database["public"]["Tables"]["routines"]["Row"];
type RoutineExerciseRow =
	Database["public"]["Tables"]["routine_exercises"]["Row"];
type TrainingCycleRow = Database["public"]["Tables"]["training_cycles"]["Row"];
type CycleDayRow = Database["public"]["Tables"]["cycle_days"]["Row"];

type RoutineWithExercises = RoutineRow & {
	routine_exercises?: RoutineExerciseRow[];
};

type CycleWithDays = TrainingCycleRow & {
	cycle_days?: CycleDayRow[];
};

function toSharedDurationMinutes(duration: number | null | undefined): number {
	if (!duration) return 0;
	return Math.round(duration / 60);
}

function routineExerciseSnapshot(exercise: RoutineExerciseRow) {
	return {
		name: exercise.name,
		muscle_group: exercise.muscle_group,
		exercise_id: exercise.exercise_id,
		sets: exercise.sets,
		reps: exercise.reps,
		weight: exercise.weight,
		rest_seconds: exercise.rest_seconds,
		duration_seconds: exercise.duration_seconds,
		mode: exercise.mode,
		order_index: exercise.order_index,
		superset_id: exercise.superset_id,
		superset_color: exercise.superset_color,
		superset_order: exercise.superset_order,
		per_set_weights: exercise.per_set_weights,
		per_set_rest: exercise.per_set_rest,
		per_set_reps: exercise.per_set_reps,
		per_set_echo_levels: exercise.per_set_echo_levels,
		is_amrap: exercise.is_amrap,
		is_bodyweight: exercise.is_bodyweight,
		pr_percentage: exercise.pr_percentage,
		rep_count_timing: exercise.rep_count_timing,
		stop_at_position: exercise.stop_at_position,
		stall_detection: exercise.stall_detection,
		eccentric_load: exercise.eccentric_load,
		echo_level: exercise.echo_level,
		warmup_sets: exercise.warmup_sets,
	};
}

function routineSnapshot(routine: RoutineWithExercises) {
	const exercises = [...(routine.routine_exercises ?? [])]
		.sort((a, b) => a.order_index - b.order_index)
		.map(routineExerciseSnapshot);

	return {
		source_routine_id: routine.id,
		name: routine.name,
		description: routine.description,
		exercise_count: routine.exercise_count,
		estimated_duration: routine.estimated_duration,
		tags: routine.tags ?? [],
		exercises,
	};
}

async function fetchRoutineWithExercises(
	routineId: string,
	userId: string,
): Promise<RoutineWithExercises> {
	const { data, error } = await supabase
		.from("routines")
		.select("*, routine_exercises(*)")
		.eq("id", routineId)
		.eq("user_id", userId)
		.order("order_index", {
			referencedTable: "routine_exercises",
			ascending: true,
		})
		.single();

	if (error) throw error;
	return data as RoutineWithExercises;
}

async function fetchCycleWithDays(
	cycleId: string,
	userId: string,
): Promise<CycleWithDays> {
	const { data, error } = await supabase
		.from("training_cycles")
		.select("*, cycle_days(*)")
		.eq("id", cycleId)
		.eq("user_id", userId)
		.order("day_number", {
			referencedTable: "cycle_days",
			ascending: true,
		})
		.single();

	if (error) throw error;
	return data as CycleWithDays;
}

async function fetchRoutinesById(
	routineIds: string[],
	userId: string,
): Promise<Map<string, RoutineWithExercises>> {
	if (routineIds.length === 0) return new Map();

	const { data, error } = await supabase
		.from("routines")
		.select("*, routine_exercises(*)")
		.eq("user_id", userId)
		.in("id", routineIds)
		.order("order_index", {
			referencedTable: "routine_exercises",
			ascending: true,
		});

	if (error) throw error;

	return new Map(
		((data ?? []) as RoutineWithExercises[]).map((routine) => [
			routine.id,
			routine,
		]),
	);
}

export function useShareContent() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (args: ShareContentArgs) => {
			if (!user) throw new Error("Must be logged in to share");

			if (args.type === "routine") {
				const routine = await fetchRoutineWithExercises(args.sourceId, user.id);
				const exercisesSnapshot = (routine.routine_exercises ?? [])
					.sort((a, b) => a.order_index - b.order_index)
					.map(routineExerciseSnapshot);

				const { error } = await supabase.from("shared_routines").insert({
					user_id: user.id,
					routine_id: args.sourceId,
					name: args.name,
					description: args.description,
					tags: args.tags,
					difficulty: args.difficulty,
					exercise_count: routine.exercise_count ?? exercisesSnapshot.length,
					estimated_duration: toSharedDurationMinutes(
						routine.estimated_duration,
					),
					exercises_snapshot: exercisesSnapshot as Json,
				});
				if (error) throw error;
			} else {
				const cycle = await fetchCycleWithDays(args.sourceId, user.id);
				const days = [...(cycle.cycle_days ?? [])].sort(
					(a, b) => a.day_number - b.day_number,
				);
				const routineIds = [
					...new Set(
						days
							.map((day) => day.routine_id)
							.filter((id): id is string => id !== null),
					),
				];
				const routineMap = await fetchRoutinesById(routineIds, user.id);
				const cycleSnapshot = {
					duration_weeks: cycle.duration_weeks,
					workout_days: cycle.workout_days,
					rest_days: cycle.rest_days,
					progression_settings: cycle.progression_settings,
					deload_settings: cycle.deload_settings,
					days: days.map((day) => {
						const embeddedRoutine = day.routine_id
							? routineMap.get(day.routine_id)
							: undefined;
						return {
							day_number: day.day_number,
							day_type: day.day_type,
							routine_id: day.routine_id,
							weight_adjustment: day.weight_adjustment,
							rep_modifier: day.rep_modifier,
							rest_override: day.rest_override,
							notes: day.notes,
							rest_type: day.rest_type,
							routine: embeddedRoutine
								? routineSnapshot(embeddedRoutine)
								: null,
						};
					}),
				};

				const { error } = await supabase.from("shared_cycles").insert({
					user_id: user.id,
					cycle_id: args.sourceId,
					name: args.name,
					description: args.description,
					tags: args.tags,
					difficulty: args.difficulty,
					duration_weeks: cycle.duration_weeks,
					cycle_snapshot: cycleSnapshot as Json,
				});
				if (error) throw error;
			}
		},

		onSuccess: () => {
			// Invalidate community feed so new item appears
			queryClient.invalidateQueries({ queryKey: queryKeys.community.all });
		},

		onError: (error: Error) => {
			console.error("[useShareContent] failed:", error);
			toast.error("Failed to share content. Please try again.");
		},
	});
}

// ---------- useFollowCreator ----------

interface FollowCreatorArgs {
	followedId: string;
}

export function useFollowCreator() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ followedId }: FollowCreatorArgs) => {
			if (!user) throw new Error("Must be logged in to follow");

			// TODO: `creator_follows` is not in the generated Supabase types (database.types.ts).
			// Run `npm run gen:types` after adding the table to the schema to remove these casts.
			const { data: existing, error: checkError } = await supabase
				.from("creator_follows" as never)
				.select("id")
				.eq("follower_id", user.id)
				.eq("followed_id", followedId)
				.maybeSingle();

			if (checkError) throw checkError;

			if (existing) {
				const { error } = await supabase
					.from("creator_follows" as never)
					.delete()
					.eq("id", (existing as { id: string }).id);
				if (error) throw error;
				return { action: "unfollowed" as const };
			}
			const { error } = await supabase.from("creator_follows" as never).insert({
				follower_id: user.id,
				followed_id: followedId,
			} as never);
			if (error) throw error;
			return { action: "followed" as const };
		},

		onSuccess: (_data, variables) => {
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.follows(user.id, variables.followedId),
				});
			}
		},

		onError: (error: Error) => {
			console.error("[useFollowCreator] failed:", error);
			toast.error("Failed to complete action. Please try again.");
		},
	});
}

// ---------- useReportContent ----------

interface ReportContentArgs {
	contentId: string;
	contentType: "routine" | "cycle" | "comment";
	category: "harmful_content" | "impersonation" | "spam" | "malware" | "other";
	description?: string;
}

export function useReportContent() {
	const { user } = useAuth();

	return useMutation({
		mutationFn: async ({
			contentId,
			contentType,
			category,
			description,
		}: ReportContentArgs) => {
			if (!user) throw new Error("Must be logged in to report content");

			// TODO: `content_reports` is not in the generated Supabase types (database.types.ts).
			// Run `npm run gen:types` after adding the table to the schema to remove these casts.
			const { error } = await supabase.from("content_reports" as never).insert({
				reporter_id: user.id,
				content_id: contentId,
				content_type: contentType,
				category,
				...(description ? { description } : {}),
			} as never);

			if (error) {
				if (error.code === "23505") {
					throw new Error("You have already reported this content");
				}
				throw error;
			}
		},

		onSuccess: () => {
			toast.success(
				"Report submitted. Thank you for keeping the community safe.",
			);
		},

		onError: (error: Error) => {
			console.error("[useReportContent] failed:", error);
			if (error.message === "You have already reported this content") {
				toast.error("You have already reported this content.");
			} else {
				toast.error("Failed to submit report. Please try again.");
			}
		},
	});
}

// ---------- useBlockUser ----------

interface BlockUserArgs {
	blockedId: string;
}

export function useBlockUser() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ blockedId }: BlockUserArgs) => {
			if (!user) throw new Error("Must be logged in to block a user");
			if (blockedId === user.id) throw new Error("You cannot block yourself");

			const { error } = await supabase.from("user_blocks" as never).insert({
				blocker_id: user.id,
				blocked_id: blockedId,
			} as never);

			if (error) throw error;
		},

		onSuccess: () => {
			toast.success("User blocked");
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.comments.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.blocks(user.id),
				});
			}
		},

		onError: (error: Error) => {
			console.error("[useBlockUser] failed:", error);
			toast.error("Failed to block user. Please try again.");
		},
	});
}

// ---------- useUnblockUser ----------

interface UnblockUserArgs {
	blockedId: string;
}

export function useUnblockUser() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ blockedId }: UnblockUserArgs) => {
			if (!user) throw new Error("Must be logged in to unblock a user");

			const { error } = await supabase
				.from("user_blocks" as never)
				.delete()
				.eq("blocker_id", user.id)
				.eq("blocked_id", blockedId);

			if (error) throw error;
		},

		onSuccess: () => {
			toast.success("User unblocked");
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.comments.all,
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.blocks(user.id),
				});
			}
		},

		onError: (error: Error) => {
			console.error("[useUnblockUser] failed:", error);
			toast.error("Failed to unblock user. Please try again.");
		},
	});
}

// ---------- useDeleteSharedContent ----------

interface DeleteSharedContentArgs {
	contentId: string;
	contentType: "routine" | "cycle";
}

export function useDeleteSharedContent() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ contentId, contentType }: DeleteSharedContentArgs) => {
			if (!user) throw new Error("Must be logged in to delete");

			const table =
				contentType === "routine" ? "shared_routines" : "shared_cycles";
			const { data: deleted, error } = await supabase
				.from(table)
				.delete()
				.eq("id", contentId)
				.eq("user_id", user.id)
				.select("id")
				.maybeSingle();
			if (error) throw error;
			if (!deleted)
				throw new Error(
					"Content not found or you don't have permission to remove it.",
				);
		},

		onSuccess: () => {
			toast.success("Content removed from community");
			queryClient.invalidateQueries({ queryKey: queryKeys.community.all });
		},

		onError: (error: Error) => {
			console.error("[useDeleteSharedContent] failed:", error);
			toast.error("Failed to remove content. Please try again.");
		},
	});
}

// ---------- useSaveItem ----------

interface SaveItemArgs {
	sharedItemId: string;
	itemType: "routine" | "cycle";
}

export function useSaveItem() {
	const { user } = useAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ sharedItemId, itemType }: SaveItemArgs) => {
			if (!user) throw new Error("Must be logged in to save");

			const activeProfileId = useProfileFilterStore.getState().activeProfileId;
			const { data, error } =
				itemType === "routine"
					? await supabase.rpc("import_shared_routine", {
							p_shared_routine_id: sharedItemId,
							p_local_profile_id: activeProfileId,
						})
					: await supabase.rpc("import_shared_cycle", {
							p_shared_cycle_id: sharedItemId,
							p_local_profile_id: activeProfileId,
						});

			if (error) throw error;
			return {
				action: "imported" as const,
				importedId: data as string,
				itemType,
			};
		},

		onSuccess: (data) => {
			toast.success(
				data.itemType === "routine"
					? "Routine saved to My Routines"
					: "Cycle saved to My Cycles",
			);
			if (user) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.community.saves(user.id),
				});
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.community.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.routines.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.cycles.all });
		},

		onError: (error: Error) => {
			console.error("[useSaveItem] failed:", error);
			toast.error("Failed to save content. Please try again.");
		},
	});
}
