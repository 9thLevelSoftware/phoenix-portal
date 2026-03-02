import { beforeEach, describe, expect, it } from "vitest";
import {
	type CelebrationData,
	useCelebrationStore,
} from "../useCelebrationStore";

const prCelebration: CelebrationData = {
	type: "pr",
	exerciseName: "Bench Press",
	weight: 100,
	reps: 5,
	estimated1RM: 117,
	improvement: 10,
	prType: "weight",
};

const streakCelebration: CelebrationData = {
	type: "streak",
	streak: 7,
};

const workoutCelebration: CelebrationData = {
	type: "workout_complete",
	duration: "45 min",
	volume: "12,000 kg",
	prsAchieved: 2,
	streakContinued: true,
};

describe("useCelebrationStore", () => {
	beforeEach(() => {
		useCelebrationStore.setState({ queue: [], current: null });
	});

	it("has correct initial state", () => {
		const state = useCelebrationStore.getState();
		expect(state.queue).toEqual([]);
		expect(state.current).toBeNull();
	});

	it("trigger() sets current immediately when nothing is showing", () => {
		useCelebrationStore.getState().trigger(prCelebration);
		const state = useCelebrationStore.getState();
		expect(state.current).toEqual(prCelebration);
		expect(state.queue).toEqual([]);
	});

	it("trigger() enqueues when current is already set", () => {
		useCelebrationStore.getState().trigger(prCelebration);
		useCelebrationStore.getState().trigger(streakCelebration);
		const state = useCelebrationStore.getState();
		expect(state.current).toEqual(prCelebration);
		expect(state.queue).toHaveLength(1);
		expect(state.queue[0]).toEqual(streakCelebration);
	});

	it("dismiss() pops next from queue into current", () => {
		useCelebrationStore.getState().trigger(prCelebration);
		useCelebrationStore.getState().trigger(streakCelebration);
		useCelebrationStore.getState().dismiss();
		const state = useCelebrationStore.getState();
		expect(state.current).toEqual(streakCelebration);
		expect(state.queue).toEqual([]);
	});

	it("dismiss() sets current to null when queue is empty", () => {
		useCelebrationStore.getState().trigger(prCelebration);
		useCelebrationStore.getState().dismiss();
		const state = useCelebrationStore.getState();
		expect(state.current).toBeNull();
		expect(state.queue).toEqual([]);
	});

	it("clearAll() resets both queue and current", () => {
		useCelebrationStore.getState().trigger(prCelebration);
		useCelebrationStore.getState().trigger(streakCelebration);
		useCelebrationStore.getState().trigger(workoutCelebration);
		useCelebrationStore.getState().clearAll();
		const state = useCelebrationStore.getState();
		expect(state.queue).toEqual([]);
		expect(state.current).toBeNull();
	});

	it("trigger 3 then dismiss 3 returns to null", () => {
		const { trigger, dismiss } = useCelebrationStore.getState();
		trigger(prCelebration);
		trigger(streakCelebration);
		trigger(workoutCelebration);

		// current=pr, queue=[streak, workout]
		expect(useCelebrationStore.getState().current).toEqual(prCelebration);

		useCelebrationStore.getState().dismiss();
		expect(useCelebrationStore.getState().current).toEqual(streakCelebration);

		useCelebrationStore.getState().dismiss();
		expect(useCelebrationStore.getState().current).toEqual(workoutCelebration);

		useCelebrationStore.getState().dismiss();
		expect(useCelebrationStore.getState().current).toBeNull();
		expect(useCelebrationStore.getState().queue).toEqual([]);
	});
});
