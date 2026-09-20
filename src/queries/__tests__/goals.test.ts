import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";
import { personalRecordSchema } from "@/schemas/transforms";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
	supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

beforeEach(() => {
	rpc.mockReset();
});

describe("goalPrBestsOptions", () => {
	it("uses the records cache prefix so sync invalidation refreshes goal progress", async () => {
		rpc.mockResolvedValue({ data: [], error: null });
		const { goalPrBestsOptions } = await import("../goals");
		const options = goalPrBestsOptions("user-1", "profile-1");

		expect(options.queryKey).toEqual([
			...queryKeys.records.byUser("user-1", "profile-1"),
			"goal-pr-bests",
		]);
	});

	it("converts stored per-cable PR values to the total weight shown by goals", async () => {
		rpc.mockResolvedValue({
			data: [
				{
					exercise_id: null,
					exercise_name: "Squat",
					record_type: "MAX_WEIGHT",
					value: 50,
				},
			],
			error: null,
		});
		const { goalPrBestsOptions } = await import("../goals");
		const options = goalPrBestsOptions("user-1");
		const result = await options.queryFn?.({} as never);
		const standardRecordValue = personalRecordSchema.parse({
			id: "00000000-0000-4000-8000-000000000001",
			user_id: "00000000-0000-4000-8000-000000000002",
			exercise_name: "Squat",
			muscle_group: "Legs",
			record_type: "MAX_WEIGHT",
			value: 50,
			unit: "kg",
			achieved_at: "2026-09-20T12:00:00Z",
			previous_value: null,
		}).value;

		expect(result).toEqual([
			{
				exercise_id: null,
				exercise_name: "Squat",
				record_type: "MAX_WEIGHT",
				value: standardRecordValue,
			},
		]);
		expect(rpc).toHaveBeenCalledWith("personal_record_bests", {});
	});
});
