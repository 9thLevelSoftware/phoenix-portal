import { beforeEach, describe, expect, it } from "vitest";
import { useReplayStore } from "../useReplayStore";

describe("useReplayStore", () => {
	beforeEach(() => {
		useReplayStore.setState({
			isPlaying: false,
			currentTimeMs: 0,
			speed: 1,
			viewMode: "set",
			currentSetIndex: 0,
			activeChart: "force",
			currentRepIndex: 0,
		});
	});

	it("has correct initial state", () => {
		const state = useReplayStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTimeMs).toBe(0);
		expect(state.speed).toBe(1);
		expect(state.viewMode).toBe("set");
		expect(state.currentSetIndex).toBe(0);
		expect(state.activeChart).toBe("force");
		expect(state.currentRepIndex).toBe(0);
	});

	it("play() sets isPlaying to true", () => {
		useReplayStore.getState().play();
		expect(useReplayStore.getState().isPlaying).toBe(true);
	});

	it("pause() sets isPlaying to false", () => {
		useReplayStore.getState().play();
		useReplayStore.getState().pause();
		expect(useReplayStore.getState().isPlaying).toBe(false);
	});

	it("togglePlayPause() flips isPlaying", () => {
		expect(useReplayStore.getState().isPlaying).toBe(false);
		useReplayStore.getState().togglePlayPause();
		expect(useReplayStore.getState().isPlaying).toBe(true);
		useReplayStore.getState().togglePlayPause();
		expect(useReplayStore.getState().isPlaying).toBe(false);
	});

	it("setSpeed() updates speed", () => {
		useReplayStore.getState().setSpeed(2);
		expect(useReplayStore.getState().speed).toBe(2);
	});

	it("seek() updates currentTimeMs", () => {
		useReplayStore.getState().seek(5000);
		expect(useReplayStore.getState().currentTimeMs).toBe(5000);
	});

	it("setViewMode() updates viewMode", () => {
		useReplayStore.getState().setViewMode("session");
		expect(useReplayStore.getState().viewMode).toBe("session");
	});

	it("nextSet() increments currentSetIndex", () => {
		useReplayStore.getState().nextSet();
		expect(useReplayStore.getState().currentSetIndex).toBe(1);
		useReplayStore.getState().nextSet();
		expect(useReplayStore.getState().currentSetIndex).toBe(2);
	});

	it("prevSet() decrements currentSetIndex", () => {
		useReplayStore.setState({ currentSetIndex: 3 });
		useReplayStore.getState().prevSet();
		expect(useReplayStore.getState().currentSetIndex).toBe(2);
	});

	it("prevSet() floors at 0 (cannot go below 0)", () => {
		expect(useReplayStore.getState().currentSetIndex).toBe(0);
		useReplayStore.getState().prevSet();
		expect(useReplayStore.getState().currentSetIndex).toBe(0);
	});

	it("setActiveChart() updates activeChart", () => {
		useReplayStore.getState().setActiveChart("velocity");
		expect(useReplayStore.getState().activeChart).toBe("velocity");
	});

	it("setCurrentRepIndex() updates currentRepIndex", () => {
		useReplayStore.getState().setCurrentRepIndex(5);
		expect(useReplayStore.getState().currentRepIndex).toBe(5);
	});

	it("reset() resets isPlaying, currentTimeMs, currentRepIndex but preserves speed/viewMode/currentSetIndex", () => {
		useReplayStore.setState({
			isPlaying: true,
			currentTimeMs: 5000,
			speed: 2,
			viewMode: "session",
			currentSetIndex: 3,
			currentRepIndex: 7,
		});

		useReplayStore.getState().reset();
		const state = useReplayStore.getState();
		expect(state.isPlaying).toBe(false);
		expect(state.currentTimeMs).toBe(0);
		expect(state.currentRepIndex).toBe(0);
		// These should be preserved
		expect(state.speed).toBe(2);
		expect(state.viewMode).toBe("session");
		expect(state.currentSetIndex).toBe(3);
	});
});
