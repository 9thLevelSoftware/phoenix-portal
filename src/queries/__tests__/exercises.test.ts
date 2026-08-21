import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogRow = {
	id: "Triceps_Pushdown",
	name: "Triceps Pushdown",
	display_name: "Triceps Pushdown",
	description: null,
	muscle_group: "ARMS",
	muscle_groups: ["ARMS"],
	muscles: ["triceps"],
	equipment: ["CABLE"],
	movement: "strength",
	sidedness: "bilateral",
	grip: null,
	grip_width: null,
	default_cable_config: "EITHER",
	min_rep_range: 5,
	popularity: 0,
	aliases: [],
	thumbnail_url:
		"https://ilzlswmatadlnsuxatcv.supabase.co/storage/v1/object/public/exercise-media/Triceps_Pushdown/0.jpg",
	archived: true,
	is_custom: false,
	source: "free-exercise-db",
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
		expect(result[0]?.id).toBe("Triceps_Pushdown");
	});
});
