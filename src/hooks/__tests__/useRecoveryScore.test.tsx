import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecoveryScore } from "@/hooks/useRecoveryScore";
import { useProfileFilterStore } from "@/stores/useProfileFilterStore";

type QueryResult = { data: unknown; error: unknown };

const queries = vi.hoisted(() => ({
	workout_sessions: Promise.resolve({
		data: [] as unknown,
		error: null as unknown,
	}),
	external_activities: Promise.resolve({
		data: null as unknown,
		error: null as unknown,
	}),
	training_cycles: Promise.resolve({
		data: null as unknown,
		error: null as unknown,
	}),
}));

const eqCalls: Array<[unknown, unknown]> = [];

function queryBuilder(result: Promise<QueryResult>) {
	const self: object = new Proxy(
		{},
		{
			get(_target, prop) {
				if (prop === "then") {
					return (
						onFulfilled: (value: QueryResult) => unknown,
						onRejected?: (reason: unknown) => unknown,
					) => result.then(onFulfilled, onRejected);
				}
				return (...args: unknown[]) => {
					if (prop === "eq") eqCalls.push([args[0], args[1]]);
					return self;
				};
			},
		},
	);
	return self;
}

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (table: keyof typeof queries) => queryBuilder(queries[table]),
	},
}));

vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1" } }),
}));

function settled<T>(data: T, error: unknown = null): Promise<QueryResult> {
	return Promise.resolve({ data, error });
}

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

const sessionRow = {
	started_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
	total_volume: 1200,
};

describe("useRecoveryScore", () => {
	beforeEach(() => {
		eqCalls.length = 0;
		useProfileFilterStore.getState().reset();
		queries.workout_sessions = settled([sessionRow]);
		queries.external_activities = settled(null);
		queries.training_cycles = settled(null);
	});

	it("resolves the readiness score while the wearable query is still pending", async () => {
		let releaseWearable: (value: QueryResult) => void = () => {};
		queries.external_activities = new Promise((resolve) => {
			releaseWearable = resolve;
		});

		const { result, unmount } = renderHook(() => useRecoveryScore(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.recovery).not.toBeNull();
		expect(result.current.isError).toBe(false);
		expect(result.current.error).toBeNull();
		expect(result.current.isWearablePending).toBe(true);
		expect(result.current.isWearableError).toBe(false);
		expect(result.current.wearable).toBeNull();

		releaseWearable({ data: null, error: null });
		unmount();
	});

	it("does not treat a failed wearable fetch as a readiness-score error", async () => {
		queries.external_activities = settled(null, new Error("wearable failed"));

		const { result } = renderHook(() => useRecoveryScore(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isWearableError).toBe(true));

		expect(result.current.isLoading).toBe(false);
		expect(result.current.isWearablePending).toBe(false);
		expect(result.current.isError).toBe(false);
		expect(result.current.error).toBeNull();
		expect(result.current.recovery).not.toBeNull();
		expect(result.current.wearable).toBeNull();
	});

	it("keeps a sessions failure on the score and off the wearable flags", async () => {
		const sessionsError = new Error("sessions failed");
		queries.workout_sessions = settled(null, sessionsError);
		queries.external_activities = settled([
			{
				id: "00000000-0000-4000-8000-000000000001",
				provider: "garmin",
				raw_data: { hrv: 42 },
				synced_at: "2026-10-01T00:00:00.000Z",
			},
		]);

		const { result } = renderHook(() => useRecoveryScore(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => {
			expect(result.current.isError).toBe(true);
			expect(result.current.wearable).toHaveLength(1);
		});

		expect(result.current.error).toBe(sessionsError);
		expect(result.current.recovery).toBeNull();
		expect(result.current.isWearablePending).toBe(false);
		expect(result.current.isWearableError).toBe(false);
	});

	it("does not filter readiness when the sidebar is set to all profiles", async () => {
		const { result } = renderHook(() => useRecoveryScore(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(eqCalls.filter(([column]) => column === "local_profile_id")).toEqual(
			[],
		);
	});

	it("filters readiness sessions and the active cycle by the sidebar profile", async () => {
		useProfileFilterStore.getState().setActiveProfileId("profile-1");

		const { result } = renderHook(() => useRecoveryScore(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		const profileFilters = eqCalls.filter(
			([column]) => column === "local_profile_id",
		);
		expect(profileFilters).toEqual([
			["local_profile_id", "profile-1"],
			["local_profile_id", "profile-1"],
		]);
	});
});
