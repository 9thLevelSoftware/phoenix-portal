/**
 * Tests for usePlayback hook.
 *
 * Mocking strategy:
 *   - useReplayStore is mocked via vi.mock so we can control isPlaying, currentTimeMs,
 *     speed, seek, and pause without a real Zustand store.
 *   - useAnimationFrame (motion/react) is mocked to be a synchronous stub that
 *     immediately invokes the callback with a synthetic delta, letting us test the
 *     arithmetic without a real RAF loop.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePlayback } from "./usePlayback";

// ── mock stores / deps ────────────────────────────────────────────────────────

const mockSeek = vi.fn();
const mockPause = vi.fn();

const storeState = {
	isPlaying: true,
	currentTimeMs: 0,
	speed: 1,
	seek: mockSeek,
	pause: mockPause,
};

vi.mock("@/stores/useReplayStore", () => ({
	useReplayStore: () => storeState,
}));

// Captures the last callback registered by useAnimationFrame so tests can
// invoke it directly with a chosen delta.
let capturedCallback: ((_time: number, delta: number) => void) | null = null;

vi.mock("motion/react", () => ({
	useAnimationFrame: (cb: (_time: number, delta: number) => void) => {
		capturedCallback = cb;
	},
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function invokeFrame(delta: number) {
	if (!capturedCallback) throw new Error("useAnimationFrame callback not registered");
	capturedCallback(0, delta);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("usePlayback", () => {
	beforeEach(() => {
		mockSeek.mockClear();
		mockPause.mockClear();
		capturedCallback = null;
		storeState.isPlaying = true;
		storeState.currentTimeMs = 0;
		storeState.speed = 1;
	});

	it("speed=1: delta of 16.67 ms advances currentTimeMs by ~16.67", () => {
		const maxTimeMs = 300_000;
		renderHook(() => usePlayback(maxTimeMs));

		invokeFrame(16.67);

		expect(mockPause).not.toHaveBeenCalled();
		expect(mockSeek).toHaveBeenCalledWith(16.67);
	});

	it("speed=2: delta of 16.67 ms advances currentTimeMs by ~33.34", () => {
		storeState.speed = 2;
		const maxTimeMs = 300_000;
		renderHook(() => usePlayback(maxTimeMs));

		invokeFrame(16.67);

		expect(mockPause).not.toHaveBeenCalled();
		expect(mockSeek).toHaveBeenCalledWith(33.34);
	});

	it("seeks to maxTimeMs and pauses when newTime >= maxTimeMs", () => {
		storeState.currentTimeMs = 299_990;
		const maxTimeMs = 300_000;
		renderHook(() => usePlayback(maxTimeMs));

		// delta of 20 ms puts newTime at 300010, which exceeds maxTimeMs
		invokeFrame(20);

		expect(mockSeek).toHaveBeenCalledWith(maxTimeMs);
		expect(mockPause).toHaveBeenCalledTimes(1);
	});

	it("does nothing when isPlaying is false", () => {
		storeState.isPlaying = false;
		renderHook(() => usePlayback(300_000));

		invokeFrame(16.67);

		expect(mockSeek).not.toHaveBeenCalled();
		expect(mockPause).not.toHaveBeenCalled();
	});
});
