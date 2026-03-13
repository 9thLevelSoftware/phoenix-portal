import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRealtimeSync } from "../useRealtimeSync";

const mocks = vi.hoisted(() => {
	let broadcastHandler: ((payload: unknown) => void) | undefined;
	let subscribeHandler: ((status: string) => void) | undefined;
	const invalidateQueries = vi.fn();
	const removeChannel = vi.fn();
	const mockChannel = {
		on: vi.fn(
			(_type: string, _filter: unknown, callback: (payload: unknown) => void) => {
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

vi.mock("@/lib/supabase", () => ({
	supabase: mocks.mockSupabase,
}));

function TestComponent() {
	useRealtimeSync();
	return null;
}

describe("useRealtimeSync", () => {
	it("invalidates the full query cache on sync_complete", () => {
		const { unmount } = render(<TestComponent />);

		expect(mocks.mockSupabase.channel).toHaveBeenCalledWith(
			"sync:00000000-0000-4000-8000-000000000001",
		);
		expect(mocks.subscribeHandler).toBeTypeOf("function");

		mocks.broadcastHandler?.({});

		expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
		expect(mocks.invalidateQueries.mock.calls[0]).toHaveLength(0);

		unmount();

		expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.mockChannel);
	});
});
