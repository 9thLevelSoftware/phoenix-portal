import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";
import { DEGRADED_POLL_INTERVAL_MS, useRealtimeSync } from "../useRealtimeSync";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TARGETED_INVALIDATIONS = [
	queryKeys.workouts.all,
	queryKeys.records.all,
	queryKeys.routines.all,
	queryKeys.cycles.all,
	queryKeys.analytics.all,
	queryKeys.telemetry.all,
	queryKeys.biomechanics.all,
	queryKeys.progress.all,
	queryKeys.recovery.all,
	queryKeys.replay.all,
	queryKeys.profile.all,
	queryKeys.challenges.all,
	queryKeys.integrations.external(USER_ID),
	queryKeys.localProfiles.byUser(USER_ID),
	queryKeys.onboarding.all,
	queryKeys.goals.all,
	queryKeys.insights.all,
];

const mocks = vi.hoisted(() => {
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

	return {
		get broadcastHandler() {
			return broadcastHandler;
		},
		get subscribeHandler() {
			return subscribeHandler;
		},
		invalidateQueries,
		removeChannel,
		toastError,
		mockChannel,
		mockSupabase: {
			channel: vi.fn(() => mockChannel),
			removeChannel,
		},
		authState: {
			user: { id: "00000000-0000-4000-8000-000000000001" },
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
	useSubscription: () => ({ tier: "EMBER", isLoading: false }),
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

describe("useRealtimeSync", () => {
	beforeEach(() => {
		mocks.invalidateQueries.mockClear();
		mocks.removeChannel.mockClear();
		mocks.mockChannel.on.mockClear();
		mocks.mockChannel.subscribe.mockClear();
		mocks.mockSupabase.channel.mockClear();
		mocks.toastError.mockClear();
	});

	it("invalidates targeted query keys on sync_complete", async () => {
		vi.useFakeTimers();
		const { unmount } = await renderHook();

		expect(mocks.mockSupabase.channel).toHaveBeenCalledWith(`sync:${USER_ID}`, {
			config: { private: true },
		});
		expect(mocks.subscribeHandler).toBeTypeOf("function");

		mocks.broadcastHandler?.({});
		await vi.advanceTimersByTimeAsync(400);

		expect(mocks.invalidateQueries).toHaveBeenCalledTimes(
			TARGETED_INVALIDATIONS.length,
		);
		expect(mocks.invalidateQueries.mock.calls).toEqual(
			TARGETED_INVALIDATIONS.map((queryKey) => [{ queryKey }]),
		);

		unmount();

		expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.mockChannel);
		vi.useRealTimers();
	});

	it("does not invalidate on the first SUBSCRIBED of a mount", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			mocks.subscribeHandler?.("SUBSCRIBED");
			await vi.advanceTimersByTimeAsync(1000);
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("invalidates on a re-subscribe to catch up on missed broadcasts", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			mocks.subscribeHandler?.("SUBSCRIBED");
			await vi.advanceTimersByTimeAsync(400);
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();

			// Socket drops and the client rejoins the same channel.
			mocks.subscribeHandler?.("SUBSCRIBED");
			await vi.advanceTimersByTimeAsync(400);
			expect(mocks.invalidateQueries.mock.calls).toEqual(
				TARGETED_INVALIDATIONS.map((queryKey) => [{ queryKey }]),
			);
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("toasts on TIMED_OUT and polls workouts every 60s until SUBSCRIBED", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			mocks.subscribeHandler?.("TIMED_OUT");
			expect(mocks.toastError).toHaveBeenCalledWith(
				"Live sync unavailable. Refresh to retry.",
				{ id: "phoenix-realtime-sync-unavailable" },
			);
			expect(DEGRADED_POLL_INTERVAL_MS).toBe(60_000);

			await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS - 1);
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(mocks.invalidateQueries.mock.calls).toEqual([
				[{ queryKey: queryKeys.workouts.all }],
			]);

			// A repeated degraded status does not stack a second interval.
			mocks.subscribeHandler?.("CLOSED");
			await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS);
			expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);

			// Recovery: SUBSCRIBED stops polling and catches up once, even
			// though it is the first SUBSCRIBED of this mount.
			mocks.invalidateQueries.mockClear();
			mocks.subscribeHandler?.("SUBSCRIBED");
			await vi.advanceTimersByTimeAsync(400);
			expect(mocks.invalidateQueries).toHaveBeenCalledTimes(
				TARGETED_INVALIDATIONS.length,
			);
			mocks.invalidateQueries.mockClear();
			await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS * 3);
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("toasts on CLOSED and stops polling on unmount", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			mocks.subscribeHandler?.("CLOSED");
			expect(mocks.toastError).toHaveBeenCalledTimes(1);
			unmount();
			await vi.advanceTimersByTimeAsync(DEGRADED_POLL_INTERVAL_MS * 2);
			expect(mocks.invalidateQueries).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("toasts CHANNEL_ERROR and does not fall back to a public topic", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			const callsBefore = mocks.mockSupabase.channel.mock.calls.length;
			mocks.subscribeHandler?.("CHANNEL_ERROR");
			expect(mocks.toastError).toHaveBeenCalledWith(
				"Live sync unavailable. Refresh to retry.",
				{ id: "phoenix-realtime-sync-unavailable" },
			);
			expect(mocks.mockSupabase.channel.mock.calls.length).toBe(callsBefore);
			for (const call of mocks.mockSupabase.channel.mock.calls) {
				expect(call[1]).toEqual({ config: { private: true } });
			}
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});
});
