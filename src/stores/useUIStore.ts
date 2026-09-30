import { create } from "zustand";

export interface UIState {
	streak: number;
	setStreak: (streak: number) => void;
}

/** Coerce arbitrary numeric input to a finite, non-negative integer. */
function sanitizeCount(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.floor(value);
}

export const useUIStore = create<UIState>()((set) => ({
	streak: 0,
	setStreak: (streak) => set({ streak: sanitizeCount(streak) }),
}));
