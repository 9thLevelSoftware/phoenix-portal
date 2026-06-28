import { create } from "zustand";

interface CommunityFilters {
	muscleGroup?: string;
	difficulty?: string;
}

interface CommunityState {
	activeTab: "routines" | "cycles";
	sort: "hot" | "top" | "new";
	search: string;
	filters: CommunityFilters;
	selectedItemId: string | null;
	blockedUserIds: Set<string>;
	setActiveTab: (tab: "routines" | "cycles") => void;
	setSort: (sort: "hot" | "top" | "new") => void;
	setSearch: (search: string) => void;
	setFilters: (filters: CommunityFilters) => void;
	setSelectedItemId: (id: string | null) => void;
	setBlockedUserIds: (ids: Set<string>) => void;
	resetAll: () => void;
}

// Factory so every reset produces a fresh state object with a fresh Set,
// rather than re-sharing a single module-level instance (whose mutation would
// silently leak across resets and bypass Zustand subscribers).
const createInitialState = () => ({
	activeTab: "routines" as const,
	sort: "top" as const,
	search: "",
	filters: {} as CommunityFilters,
	selectedItemId: null as string | null,
	blockedUserIds: new Set<string>(),
});

export const useCommunityStore = create<CommunityState>()((set) => ({
	...createInitialState(),
	setActiveTab: (activeTab) => set({ activeTab }),
	setSort: (sort) => set({ sort }),
	setSearch: (search) => set({ search }),
	setFilters: (filters) => set({ filters }),
	setSelectedItemId: (selectedItemId) => set({ selectedItemId }),
	// Defensively copy into a fresh Set so callers can't later mutate the stored
	// instance without going through `set`.
	setBlockedUserIds: (ids) => set({ blockedUserIds: new Set(ids) }),
	resetAll: () => set(createInitialState()),
}));
