import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { queryKeys } from "@/queries/keys";
import { hasWorkoutsOptions, onboardingOptions } from "@/queries/onboarding";

const CURRENT_VERSION = "1.1";

/**
 * Onboarding state detection hook.
 *
 * Decision tree:
 * 1. No onboarding row + no workouts -> needsOnboarding (brand-new user)
 * 2. No onboarding row + has workouts -> needsWhatsNew (v1.0 mobile user)
 * 3. Has row + version_seen < '1.1' + !dismissed_whats_new -> needsWhatsNew
 * 4. Has row + version_seen >= '1.1' -> nothing needed
 */
export function useOnboarding() {
	const { user } = useAuth();
	const queryClient = useQueryClient();
	const userId = user?.id ?? "";

	const { data: onboarding, isPending: onboardingLoading } = useQuery({
		...onboardingOptions(userId),
		enabled: !!user,
	});

	// Only check for workouts if no onboarding row exists
	const { data: workoutCount, isPending: workoutsLoading } = useQuery({
		...hasWorkoutsOptions(userId),
		enabled: !!user && onboarding === null,
	});

	const isPending =
		onboardingLoading || (onboarding === null && workoutsLoading);
	const hasExistingData = (workoutCount ?? 0) > 0;

	// Decision tree
	const needsOnboarding = !isPending && onboarding === null && !hasExistingData;
	const needsWhatsNew =
		!isPending &&
		((onboarding === null && hasExistingData) ||
			(onboarding !== null &&
				onboarding !== undefined &&
				(!onboarding.version_seen ||
					onboarding.version_seen < CURRENT_VERSION) &&
				!onboarding.dismissed_whats_new));

	// Feature hints should only show after the user has workout data loaded
	const showHints =
		!isPending &&
		onboarding !== null &&
		onboarding !== undefined &&
		onboarding.version_seen === CURRENT_VERSION;

	// Mutation: complete onboarding (new user finishes the 3-step dialog)
	const completeOnboarding = useMutation({
		mutationFn: async () => {
			if (!user) throw new Error("Not authenticated");
			const { error } = await supabase.from("user_onboarding").upsert(
				{
					user_id: user.id,
					completed_at: new Date().toISOString(),
					version_seen: CURRENT_VERSION,
					dismissed_whats_new: true,
				},
				{ onConflict: "user_id" },
			);
			if (error) throw error;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.onboarding.byUser(userId),
			});
		},
		onError: (error: Error) => {
			toast.error(`Failed to save onboarding: ${error.message}`);
		},
	});

	// Mutation: dismiss What's New banner
	const dismissWhatsNew = useMutation({
		mutationFn: async () => {
			if (!user) throw new Error("Not authenticated");
			// If no onboarding row exists yet (v1.0 mobile user), create one
			const { error } = await supabase.from("user_onboarding").upsert(
				{
					user_id: user.id,
					completed_at: new Date().toISOString(),
					version_seen: CURRENT_VERSION,
					dismissed_whats_new: true,
				},
				{ onConflict: "user_id" },
			);
			if (error) throw error;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.onboarding.byUser(userId),
			});
		},
		onError: (error: Error) => {
			toast.error(`Failed to dismiss banner: ${error.message}`);
		},
	});

	// Mutation: dismiss a specific feature hint
	const dismissHint = useMutation({
		mutationFn: async ({ hintId }: { hintId: string }) => {
			if (!user) throw new Error("Not authenticated");

			// Fetch the latest dismissed_hints directly from the DB to avoid
			// overwriting concurrent updates from other tabs (stale cache risk).
			const { data: current, error: fetchError } = await supabase
				.from("user_onboarding")
				.select("dismissed_hints")
				.eq("user_id", user.id)
				.single();
			if (fetchError && fetchError.code !== "PGRST116") throw fetchError;

			const merged = {
				...((current?.dismissed_hints as Record<string, boolean>) ?? {}),
				[hintId]: true,
			};

			const { error } = await supabase
				.from("user_onboarding")
				.update({ dismissed_hints: merged })
				.eq("user_id", user.id);
			if (error) throw error;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.onboarding.byUser(userId),
			});
		},
		onError: (error: Error) => {
			toast.error(`Failed to dismiss hint: ${error.message}`);
		},
	});

	return {
		needsOnboarding,
		needsWhatsNew,
		showHints,
		onboarding,
		isPending,
		completeOnboarding,
		dismissWhatsNew,
		dismissHint,
	};
}
