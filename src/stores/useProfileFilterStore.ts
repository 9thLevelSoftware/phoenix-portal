import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface ProfileFilterState {
	/** null = show all profiles (unfiltered), string = filter by this local_profile_id */
	activeProfileId: string | null;
	/**
	 * Auth user id that owns the persisted `activeProfileId`. Used to drop a
	 * filter that was rehydrated for a different user (e.g. after sign-out and a
	 * new sign-in in the same browser session), which would otherwise leak the
	 * previous user's local profile into RLS-affecting create/import mutations.
	 */
	ownerUserId: string | null;
	setActiveProfileId: (profileId: string | null) => void;
	/**
	 * Bind the current filter to an authenticated user. If the persisted filter
	 * belongs to a different (or unknown) user, it is cleared.
	 */
	setOwnerUser: (userId: string | null) => void;
	reset: () => void;
}

export const useProfileFilterStore = create<ProfileFilterState>()(
	persist(
		(set) => ({
			activeProfileId: null,
			ownerUserId: null,
			setActiveProfileId: (profileId) => set({ activeProfileId: profileId }),
			setOwnerUser: (userId) =>
				set((state) =>
					state.ownerUserId === userId
						? { ownerUserId: userId }
						: { ownerUserId: userId, activeProfileId: null },
				),
			reset: () => set({ activeProfileId: null, ownerUserId: null }),
		}),
		{
			name: "phoenix-profile-filter",
			storage: createJSONStorage(() => sessionStorage),
		},
	),
);
