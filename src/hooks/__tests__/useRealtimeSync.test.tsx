import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
];

const mocks = vi.hoisted(() => {
	let broadcastHandler: ((payload: unknown) => void) | undefined;
	let subscribeHandler: ((status: string) => void) | undefined;
	const invalidateQueries = vi.fn();
	const removeChannel = vi.fn();
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

function TestComponent() {
	useRealtimeSync();
	return null;
}

describe("useRealtimeSync", () => {
	it("invalidates targeted query keys on sync_complete", async () => {
		vi.useFakeTimers();
		const { unmount } = render(<TestComponent />);

		// Topic carries a per-mount unique suffix to avoid remount channel collisions.
		expect(mocks.mockSupabase.channel).toHaveBeenCalledWith(
			expect.stringMatching(new RegExp(`^sync:${USER_ID}:`)),
		);
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
});
