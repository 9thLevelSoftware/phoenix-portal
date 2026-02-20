import { create } from "zustand";

export interface UIState {
	streak: number;
	notifications: {
		challenges: number;
		community: number;
	};
	setStreak: (streak: number) => void;
	setNotifications: (notifications: Partial<UIState["notifications"]>) => void;
}

export const useUIStore = create<UIState>()((set) => ({
	streak: 0,
	notifications: {
		challenges: 0,
		community: 0,
	},
	setStreak: (streak) => set({ streak }),
	setNotifications: (notifications) =>
		set((state) => ({
			notifications: { ...state.notifications, ...notifications },
		})),
}));
