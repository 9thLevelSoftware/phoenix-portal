import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface ProfileFilterState {
	/** null = show all profiles (unfiltered), string = filter by this local_profile_id */
	activeProfileId: string | null;
	setActiveProfileId: (profileId: string | null) => void;
	reset: () => void;
}

export const useProfileFilterStore = create<ProfileFilterState>()(
	persist(
		(set) => ({
			activeProfileId: null,
			setActiveProfileId: (profileId) => set({ activeProfileId: profileId }),
			reset: () => set({ activeProfileId: null }),
		}),
		{
			name: "phoenix-profile-filter",
			storage: createJSONStorage(() => sessionStorage),
		},
	),
);
