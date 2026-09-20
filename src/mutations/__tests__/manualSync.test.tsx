import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: { from, functions: { invoke } },
}));

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
			mutations: { retry: false },
		},
	});
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

// PR 31 review R-1: process-sync-queue now drains pending sync_queue rows every
// 5 minutes, so a manual sync must not leave a claimable row behind while it
// dispatches the provider function directly.
describe("useManualSync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invokes the provider sync directly without inserting a sync_queue row", async () => {
		const { useManualSync } = await import("../integrations");
		invoke.mockResolvedValue({ data: { synced_count: 1 }, error: null });

		const { result } = renderHook(() => useManualSync(), {
			wrapper: createWrapper(),
		});
		result.current.mutate({ userId: "user-1", provider: "strava" });

		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(from).not.toHaveBeenCalled();
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledWith("strava-sync", {
			body: { user_id: "user-1", sync_type: "manual" },
		});
	});

	it("surfaces an invoke error without touching sync_queue", async () => {
		const { useManualSync } = await import("../integrations");
		invoke.mockResolvedValue({ data: null, error: new Error("boom") });

		const { result } = renderHook(() => useManualSync(), {
			wrapper: createWrapper(),
		});
		result.current.mutate({ userId: "user-1", provider: "hevy" });

		await waitFor(() => expect(result.current.isError).toBe(true));
		expect(result.current.error?.message).toBe("boom");
		expect(from).not.toHaveBeenCalled();
	});
});
