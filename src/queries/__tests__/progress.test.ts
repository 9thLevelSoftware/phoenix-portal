import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "order"]) {
		self[method] = vi.fn();
	}
	for (const method of Object.keys(self)) {
		self[method].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

describe("progressionWorkbenchOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromFn.mockImplementation(() => chain);
	});

	it("fetches all exercise progress and personal records for the active profile", async () => {
		const progressChain = buildChain({
			data: [
				{
					id: "11111111-1111-4111-8111-111111111111",
					user_id: "22222222-2222-4222-8222-222222222222",
					exercise_name: "Bench Press",
					session_id: "33333333-3333-4333-8333-333333333333",
					recorded_at: "2026-06-05T00:00:00Z",
					max_weight_kg: 50,
					total_volume_kg: 1000,
					estimated_1rm_kg: 60,
					max_reps: 8,
					set_count: 4,
				},
			],
			error: null,
		});
		const recordsChain = buildChain({ data: [], error: null });
		let callCount = 0;
		fromFn.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? progressChain : recordsChain;
		});

		const { progressionWorkbenchOptions } = await import("../progress");
		const opts = progressionWorkbenchOptions("user-1", "profile-1");
		const result = await opts.queryFn?.({} as never);

		expect(opts.queryKey).toEqual(
			queryKeys.progress.summary("user-1", "workbench", "profile-1"),
		);
		expect(fromFn).toHaveBeenCalledWith("exercise_progress");
		expect(fromFn).toHaveBeenCalledWith("personal_records");
		expect(progressChain.eq).toHaveBeenCalledWith("user_id", "user-1");
		expect(progressChain.eq).toHaveBeenCalledWith(
			"local_profile_id",
			"profile-1",
		);
		expect(result.progressRows).toHaveLength(1);
		expect(result.records).toEqual([]);
	});
});
