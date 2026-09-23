import { create } from "zustand";

type Speed = 0.25 | 0.5 | 1 | 2 | 4;
type ViewMode = "set" | "session";
type ActiveChart = "force" | "velocity";

interface ReplayState {
	isPlaying: boolean;
	currentTimeMs: number;
	speed: Speed;
	viewMode: ViewMode;
	currentSetIndex: number;
	activeChart: ActiveChart;
	currentRepIndex: number;
	play: () => void;
	pause: () => void;
	togglePlayPause: () => void;
	setSpeed: (speed: Speed) => void;
	seek: (timeMs: number) => void;
	setViewMode: (mode: ViewMode) => void;
	nextSet: () => void;
	prevSet: () => void;
	setActiveChart: (chart: ActiveChart) => void;
	setCurrentRepIndex: (index: number) => void;
	reset: () => void;
}

const initialState = {
	isPlaying: false,
	currentTimeMs: 0,
	speed: 1 as Speed,
	viewMode: "set" as ViewMode,
	currentSetIndex: 0,
	activeChart: "force" as ActiveChart,
	currentRepIndex: 0,
};

export const useReplayStore = create<ReplayState>()((set) => ({
	...initialState,
	play: () => set({ isPlaying: true }),
	pause: () => set({ isPlaying: false }),
	togglePlayPause: () => set((state) => ({ isPlaying: !state.isPlaying })),
	setSpeed: (speed) => set({ speed }),
	// Clamp to a finite, non-negative time so imperative/keyboard callers can't
	// push the store into an invalid (NaN/negative) playback position.
	seek: (timeMs) =>
		set({ currentTimeMs: Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0 }),
	setViewMode: (viewMode) => set({ viewMode }),
	nextSet: () =>
		set((state) => ({ currentSetIndex: state.currentSetIndex + 1 })),
	prevSet: () =>
		set((state) => ({
			currentSetIndex: Math.max(0, state.currentSetIndex - 1),
		})),
	setActiveChart: (activeChart) => set({ activeChart }),
	setCurrentRepIndex: (currentRepIndex) =>
		set({
			currentRepIndex: Number.isFinite(currentRepIndex)
				? Math.max(0, Math.floor(currentRepIndex))
				: 0,
		}),
	// Full reset (used on session/page mount). Restores currentSetIndex to 0 so
	// navigating from a high set index to a shorter session starts at set 1.
	reset: () => set({ ...initialState }),
}));
