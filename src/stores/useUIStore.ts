import { create } from "zustand";

export interface UIState {
	streak: number;
	notifications: {
		challenges: number;
		community: number;
	};
	setStreak: (streak: number) => void;
	setNotifications: (notifications: Partial<UIState["notifications"]>) => void;
	reset: () => void;
}

/** Coerce arbitrary numeric input to a finite, non-negative integer badge count. */
function sanitizeCount(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.floor(value);
}

const initialState = {
	streak: 0,
	notifications: {
		challenges: 0,
		community: 0,
	},
};

export const useUIStore = create<UIState>()((set) => ({
	...initialState,
	setStreak: (streak) => set({ streak: sanitizeCount(streak) }),
	setNotifications: (notifications) =>
		set((state) => ({
			notifications: {
				challenges:
					notifications.challenges !== undefined
						? sanitizeCount(notifications.challenges)
						: state.notifications.challenges,
				community:
					notifications.community !== undefined
						? sanitizeCount(notifications.community)
						: state.notifications.community,
			},
		})),
	reset: () =>
		set({
			streak: initialState.streak,
			notifications: { ...initialState.notifications },
		}),
}));
