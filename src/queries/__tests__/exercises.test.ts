import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogRow = {
	id: "BUxuV42l6oolZVde",
	name: "Tricep Pushdown",
	display_name: "Tricep Pushdown",
	description: null,
	muscle_group: "ARMS",
	muscle_groups: ["ARMS"],
	muscles: ["triceps"],
	equipment: ["SHORT_BAR"],
	movement: "tricep_extension",
	sidedness: "bilateral",
	grip: "pronated",
	grip_width: null,
	default_cable_config: "DOUBLE",
	min_rep_range: 5,
	popularity: 0,
	aliases: [],
	thumbnail_url:
		"https://example.invalid/XMK02bqNtt76JAbEvjknvG69J01KKPVYaDp6FWOPV9La8/thumbnail.jpg",
	archived: true,
	is_custom: false,
};

type AwaitableQuery = Promise<{ data: unknown; error: unknown }> & {
	select: ReturnType<typeof vi.fn>;
	order: ReturnType<typeof vi.fn>;
	eq: ReturnType<typeof vi.fn>;
	overlaps: ReturnType<typeof vi.fn>;
	or: ReturnType<typeof vi.fn>;
	maybeSingle: ReturnType<typeof vi.fn>;
};

function buildAwaitableQuery(terminal: { data: unknown; error: unknown }) {
	const query = Promise.resolve(terminal) as AwaitableQuery;

	query.select = vi.fn(() => query);
	query.order = vi.fn(() => query);
	query.eq = vi.fn(() => query);
	query.overlaps = vi.fn(() => query);
	query.or = vi.fn(() => query);
	query.maybeSingle = vi.fn(() => Promise.resolve(terminal));

	return query;
}

let query: ReturnType<typeof buildAwaitableQuery>;
const fromFn = vi.fn(() => query);

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (...args: unknown[]) => fromFn(...args) },
}));

describe("fetchExerciseCatalog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		query = buildAwaitableQuery({ data: [catalogRow], error: null });
	});

	it("filters archived exercises by default", async () => {
		const { fetchExerciseCatalog } = await import("../exercises");

		await fetchExerciseCatalog();

		expect(fromFn).toHaveBeenCalledWith("exercise_catalog");
		expect(query.eq).toHaveBeenCalledWith("archived", false);
	});

	it("omits the archived filter when includeArchived is true", async () => {
		const { fetchExerciseCatalog } = await import("../exercises");

		const result = await fetchExerciseCatalog({ includeArchived: true });

		expect(query.eq).not.toHaveBeenCalledWith("archived", false);
		expect(result[0]?.id).toBe("BUxuV42l6oolZVde");
	});
});
