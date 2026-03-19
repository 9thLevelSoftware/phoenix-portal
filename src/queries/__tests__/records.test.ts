import { describe, expect, it, vi, beforeEach } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "order"];
	for (const m of methods) {
		self[m] = vi.fn();
	}
	for (const m of methods) {
		self[m].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

// --- Test data ------------------------------------------------------------

const recordRow = {
	id: "11111111-1111-4111-8111-111111111111",
	user_id: "22222222-2222-4222-8222-222222222222",
	exercise_name: "Bench Press",
	muscle_group: "Chest",
	record_type: "1RM",
	value: 80,
	unit: "kg",
	achieved_at: "2026-03-10T14:30:00Z",
	previous_value: 75,
};

// --- Tests ----------------------------------------------------------------

describe("personalRecordsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses records.byUser query key", async () => {
		chain = buildChain({ data: [], error: null });
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.records.byUser("user-1"));
	});

	it("returns Zod-transformed records with doubled weights", async () => {
		chain = buildChain({ data: [recordRow], error: null });
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		const result = await opts.queryFn!({} as never);

		expect(result).toHaveLength(1);
		// value should be doubled (80 * 2 = 160)
		expect(result[0].value).toBe(160);
		// previous_value should be doubled (75 * 2 = 150)
		expect(result[0].previous_value).toBe(150);
		// achieved_at should be a Date
		expect(result[0].achieved_at).toBeInstanceOf(Date);
		expect(result[0].exercise_name).toBe("Bench Press");
	});

	it("handles null previous_value", async () => {
		chain = buildChain({
			data: [{ ...recordRow, previous_value: null }],
			error: null,
		});
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result[0].previous_value).toBeNull();
	});

	it("throws on Supabase error", async () => {
		chain = buildChain({
			data: null,
			error: { message: "records table error" },
		});
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		await expect(opts.queryFn!({} as never)).rejects.toEqual(
			expect.objectContaining({ message: "records table error" }),
		);
	});

	it("returns empty array when no records exist", async () => {
		chain = buildChain({ data: [], error: null });
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		const result = await opts.queryFn!({} as never);
		expect(result).toEqual([]);
	});

	it("queries the personal_records table", async () => {
		chain = buildChain({ data: [], error: null });
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		await opts.queryFn!({} as never);
		expect(fromFn).toHaveBeenCalledWith("personal_records");
	});
});
