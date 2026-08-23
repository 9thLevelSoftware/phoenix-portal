import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";
import { useRealtimeSync } from "../useRealtimeSync";

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

	it("invalidates on SUBSCRIBED catch-up", async () => {
		vi.useFakeTimers();
		try {
			const { unmount } = await renderHook();
			mocks.subscribeHandler?.("SUBSCRIBED");
			await vi.advanceTimersByTimeAsync(400);
			expect(mocks.invalidateQueries).toHaveBeenCalledTimes(
				TARGETED_INVALIDATIONS.length,
			);
			unmount();
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
