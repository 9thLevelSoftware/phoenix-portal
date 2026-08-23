/**
 * useRealtimeSync — expanded invalidation coverage.
 *
 * Audit 05 flagged useRealtimeSync as having only one test despite being a
 * critical feature. This file expands coverage to:
 *   - Assert every documented query key family is invalidated on a
 *     `sync_complete` broadcast (workouts, records, analytics, routines,
 *     cycles, telemetry, biomechanics, progress, replay, integrations,
 *     profile, challenges).
 *   - 400ms debounce collapses rapid-fire broadcasts into one burst.
 *   - Cleanup on unmount removes the Supabase channel.
 *   - Re-subscribes after the auth user changes (logout → login cycle).
 *   - Does NOT subscribe for FREE tier users (no WebSocket cost).
 *
 * Existing narrow test lives in ./useRealtimeSync.test.tsx and covers the
 * happy path for EMBER. This file exercises the code paths that test
 * missed, without duplicating the happy-path assertion.
 */

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";
import { useRealtimeSync } from "../useRealtimeSync";

// Keep these in sync with USER_ID / ALT_USER_ID used inside vi.hoisted below.
// vi.hoisted runs before module-level const initialization, so we inline the
// values there and mirror them here for test-body use.
const USER_ID = "00000000-0000-4000-8000-000000000001";
const ALT_USER_ID = "00000000-0000-4000-8000-000000000099";

// Every query key family that useRealtimeSync invalidates on broadcast.
// Order matches src/hooks/useRealtimeSync.ts so we can compare against
// the exact invocation sequence.
const TARGETED_INVALIDATIONS = [
	{ queryKey: queryKeys.workouts.all, label: "workouts" },
	{ queryKey: queryKeys.records.all, label: "records" },
	{ queryKey: queryKeys.routines.all, label: "routines" },
	{ queryKey: queryKeys.cycles.all, label: "cycles" },
	{ queryKey: queryKeys.analytics.all, label: "analytics" },
	{ queryKey: queryKeys.telemetry.all, label: "telemetry" },
	{ queryKey: queryKeys.biomechanics.all, label: "biomechanics" },
	{ queryKey: queryKeys.progress.all, label: "progress" },
	{ queryKey: queryKeys.recovery.all, label: "recovery" },
	{ queryKey: queryKeys.replay.all, label: "replay" },
	{ queryKey: queryKeys.profile.all, label: "profile" },
	{ queryKey: queryKeys.challenges.all, label: "challenges" },
	{
		queryKey: queryKeys.integrations.external(USER_ID),
		label: "integrations.external",
	},
	{
		queryKey: queryKeys.localProfiles.byUser(USER_ID),
		label: "localProfiles.byUser",
	},
	{ queryKey: queryKeys.onboarding.all, label: "onboarding" },
	{ queryKey: queryKeys.insights.all, label: "insights" },
] as const;

const mocks = vi.hoisted(() => {
	// vi.hoisted runs before top-level const initialization. Inline the UUIDs
	// to avoid the TDZ reference error the top-level USER_ID/ALT_USER_ID
	// constants would trigger.
	const HOISTED_USER_ID = "00000000-0000-4000-8000-000000000001";
	let broadcastHandler: ((payload: unknown) => void) | undefined;
	let subscribeHandler: ((status: string) => void) | undefined;
	const invalidateQueries = vi.fn();
	const removeChannel = vi.fn(() => Promise.resolve("ok"));
	const toastError = vi.fn();

	const mockChannel = {
		on: vi.fn(
			(
				_type: string,
				_filter: unknown,
				callback: (payload: unknown) => void,
			) => {
				broadcastHandler = callback;
				return mockChannel;
			},
		),
		subscribe: vi.fn((callback?: (status: string) => void) => {
			subscribeHandler = callback;
			return mockChannel;
		}),
	};

	const authState: {
		user: { id: string } | null;
	} = {
		user: { id: HOISTED_USER_ID },
	};

	const subscriptionState: {
		tier: "FREE" | "EMBER" | "FLAME" | "INFERNO";
		isLoading: boolean;
		isError: boolean;
	} = {
		tier: "EMBER",
		isLoading: false,
		isError: false,
	};

	return {
		get broadcastHandler() {
			return broadcastHandler;
		},
		get subscribeHandler() {
			return subscribeHandler;
		},
		setBroadcastHandler(handler: ((payload: unknown) => void) | undefined) {
			broadcastHandler = handler;
		},
		invalidateQueries,
		removeChannel,
		toastError,
		mockChannel,
		authState,
		subscriptionState,
		mockSupabase: {
			channel: vi.fn(() => mockChannel),
			removeChannel,
		},
	};
});

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/app/hooks/useAuth", () => ({
	useAuth: () => mocks.authState,
}));

vi.mock("@/hooks/useSubscription", () => ({
	useSubscription: () => mocks.subscriptionState,
}));

vi.mock("@/lib/supabase", () => ({
	supabase: mocks.mockSupabase,
}));

vi.mock("sonner", () => ({
	toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));

function TestComponent() {
	useRealtimeSync();
	return null;
}

async function renderHook() {
	const view = render(<TestComponent />);
	await act(async () => {
		await Promise.resolve();
	});
	return view;
}

describe("useRealtimeSync — invalidation coverage", () => {
	beforeEach(() => {
		mocks.invalidateQueries.mockClear();
		mocks.removeChannel.mockClear();
		mocks.mockChannel.on.mockClear();
		mocks.mockChannel.subscribe.mockClear();
		mocks.mockSupabase.channel.mockClear();
		mocks.setBroadcastHandler(undefined);
		mocks.authState.user = { id: USER_ID };
		mocks.subscriptionState.tier = "EMBER";
		mocks.subscriptionState.isLoading = false;
		mocks.subscriptionState.isError = false;
	});

	it.each(
		TARGETED_INVALIDATIONS,
	)("invalidates $label family on sync_complete broadcast", async ({
		queryKey,
	}) => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			mocks.broadcastHandler?.({});
			await vi.advanceTimersByTimeAsync(400);

			expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey });
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("collapses rapid broadcasts into one invalidation burst within the 400ms debounce window", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();

			// Fire three broadcasts inside the debounce window
			mocks.broadcastHandler?.({});
			await vi.advanceTimersByTimeAsync(100);
			mocks.broadcastHandler?.({});
			await vi.advanceTimersByTimeAsync(100);
			mocks.broadcastHandler?.({});

			// Still within 300ms cumulative — nothing should have fired yet
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();

			// Cross the debounce threshold from the last broadcast
			await vi.advanceTimersByTimeAsync(400);

			// Exactly one burst of invalidations (one per targeted family)
			expect(mocks.invalidateQueries).toHaveBeenCalledTimes(
				TARGETED_INVALIDATIONS.length,
			);
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("removes the channel on unmount and clears any in-flight debounce timer", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			expect(mocks.mockSupabase.channel).toHaveBeenCalledWith(
				`sync:${USER_ID}`,
				{ config: { private: true } },
			);

			// Queue a broadcast inside the debounce window, then unmount
			// BEFORE the 400ms debounce fires. The cleanup in
			// src/hooks/useRealtimeSync.ts clears the in-flight timer so
			// invalidations do not leak past unmount.
			mocks.broadcastHandler?.({});
			await vi.advanceTimersByTimeAsync(200); // within debounce window
			unmount();

			// Supabase channel teardown happened synchronously on unmount
			expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.mockChannel);

			// Let the original debounce deadline pass — cleared timer means
			// invalidateQueries is never called for the pre-unmount broadcast.
			mocks.invalidateQueries.mockClear();
			await vi.advanceTimersByTimeAsync(500);
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("re-subscribes with a new channel after the auth user changes", async () => {
		vi.useFakeTimers();
		try {
			const { rerender, unmount } = await renderHook();
			expect(mocks.mockSupabase.channel).toHaveBeenCalledWith(
				`sync:${USER_ID}`,
				{ config: { private: true } },
			);
			expect(mocks.mockSupabase.channel).toHaveBeenCalledTimes(1);

			// Simulate logout → login as a different user
			act(() => {
				mocks.authState.user = { id: ALT_USER_ID };
			});
			rerender(<TestComponent />);
			await act(async () => {
				await Promise.resolve();
			});

			// The prior channel should be torn down and a new one opened for
			// the new user ID.
			expect(mocks.removeChannel).toHaveBeenCalled();
			expect(mocks.mockSupabase.channel).toHaveBeenCalledWith(
				`sync:${ALT_USER_ID}`,
				{ config: { private: true } },
			);
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("does NOT subscribe when user tier is confirmed FREE", async () => {
		mocks.subscriptionState.tier = "FREE";
		mocks.subscriptionState.isError = false;
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			// useRealtimeSync short-circuits before .channel() is called.
			expect(mocks.mockSupabase.channel).not.toHaveBeenCalled();

			// Even if a broadcast were emitted, no handler is installed, so
			// invalidateQueries must remain untouched.
			await vi.advanceTimersByTimeAsync(1000);
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();
			unmount();
			// Nothing to remove because nothing was ever subscribed.
			expect(mocks.removeChannel).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("subscribes when billing status isError even if last-known tier is FREE", async () => {
		mocks.subscriptionState.tier = "FREE";
		mocks.subscriptionState.isError = true;
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			expect(mocks.mockSupabase.channel).toHaveBeenCalledWith(
				`sync:${USER_ID}`,
				{ config: { private: true } },
			);
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("waits for subscription data to load before subscribing (no speculative channel)", async () => {
		mocks.subscriptionState.isLoading = true;
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			expect(mocks.mockSupabase.channel).not.toHaveBeenCalled();
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});
});
