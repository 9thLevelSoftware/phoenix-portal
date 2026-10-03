import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

const rpcFn = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: {
		rpc: (...args: unknown[]) => rpcFn(...args),
	},
}));

function mockRpc(result: { data: unknown; error: unknown }) {
	rpcFn.mockResolvedValue(result);
}

describe("exerciseFrequencyOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("is the single query key for profile and analytics", async () => {
		const { exerciseFrequencyOptions } = await import("../exercise-frequency");
		const { topExercisesOptions } = await import("../profile");
		const { muscleGroupOptions } = await import("../analytics");

		const shared = exerciseFrequencyOptions("user-1", "profile-1").queryKey;
		expect(shared).toEqual(
			queryKeys.analytics.exerciseFrequency("user-1", "profile-1"),
		);
		expect(topExercisesOptions("user-1", "profile-1").queryKey).toEqual(shared);
		expect(muscleGroupOptions("user-1", "profile-1").queryKey).toEqual(shared);
		expect(
			exerciseFrequencyOptions("user-2", "profile-1").queryKey,
		).not.toEqual(shared);
	});

	it("fetches exercise_frequency once when both screens load together", async () => {
		mockRpc({
			data: [
				{
					exercise_name: "Bench Press",
					muscle_group: "General",
					sessions: 4,
				},
				{
					exercise_name: "Bent Over Row",
					muscle_group: "General",
					sessions: 2,
				},
			],
			error: null,
		});
		const { topExercisesOptions } = await import("../profile");
		const { muscleGroupOptions } = await import("../analytics");
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
		});
		const top = topExercisesOptions("user-1", "profile-1");
		const muscle = muscleGroupOptions("user-1", "profile-1");

		await Promise.all([
			client.prefetchQuery(top),
			client.prefetchQuery(muscle),
		]);

		expect(rpcFn).toHaveBeenCalledTimes(1);
		expect(rpcFn).toHaveBeenCalledWith("exercise_frequency", {
			p_profile_id: "profile-1",
		});

		const cached = client.getQueryData(top.queryKey);
		expect(top.select?.(cached as never)).toEqual([
			{ name: "Bench Press", count: 4 },
			{ name: "Bent Over Row", count: 2 },
		]);
		expect(muscle.select?.(cached as never)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "Chest", value: 67 }),
				expect.objectContaining({ name: "Back", value: 33 }),
			]),
		);
	});
});
