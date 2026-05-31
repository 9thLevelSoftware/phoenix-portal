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

const initialState = {
	activeTab: "routines" as const,
	sort: "top" as const,
	search: "",
	filters: {},
	selectedItemId: null,
	blockedUserIds: new Set<string>(),
};

export const useCommunityStore = create<CommunityState>()((set) => ({
	...initialState,
	setActiveTab: (activeTab) => set({ activeTab }),
	setSort: (sort) => set({ sort }),
	setSearch: (search) => set({ search }),
	setFilters: (filters) => set({ filters }),
	setSelectedItemId: (selectedItemId) => set({ selectedItemId }),
	setBlockedUserIds: (blockedUserIds) => set({ blockedUserIds }),
	resetAll: () => set(initialState),
}));
