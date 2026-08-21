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

type CatalogQuery = {
	select: ReturnType<typeof vi.fn>;
	order: ReturnType<typeof vi.fn>;
	eq: ReturnType<typeof vi.fn>;
	overlaps: ReturnType<typeof vi.fn>;
	or: ReturnType<typeof vi.fn>;
	range: ReturnType<typeof vi.fn>;
	maybeSingle: ReturnType<typeof vi.fn>;
};

function buildAwaitableQuery(
	getTerminal: (
		from?: number,
		to?: number,
	) => { data: unknown; error: unknown },
) {
	const query = {} as CatalogQuery;

	query.select = vi.fn(() => query);
	query.order = vi.fn(() => query);
	query.eq = vi.fn(() => query);
	query.overlaps = vi.fn(() => query);
	query.or = vi.fn(() => query);
	query.range = vi.fn((from: number, to: number) =>
		Promise.resolve(getTerminal(from, to)),
	);
	query.maybeSingle = vi.fn(() => Promise.resolve(getTerminal()));

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
		query = buildAwaitableQuery(() => ({ data: [catalogRow], error: null }));
	});

	it("filters archived exercises by default", async () => {
		const { fetchExerciseCatalog } = await import("../exercises");

		await fetchExerciseCatalog();

		expect(fromFn).toHaveBeenCalledWith("exercise_catalog");
		expect(query.eq).toHaveBeenCalledWith("archived", false);
		expect(query.order).toHaveBeenCalledWith("popularity", {
			ascending: false,
		});
		expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
		expect(query.range).toHaveBeenCalledWith(0, 999);
	});

	it("omits the archived filter when includeArchived is true", async () => {
		const { fetchExerciseCatalog } = await import("../exercises");

		const result = await fetchExerciseCatalog({ includeArchived: true });

		expect(query.eq).not.toHaveBeenCalledWith("archived", false);
		expect(result[0]?.id).toBe("Triceps_Pushdown");
	});

	it("pages past the PostgREST 1000-row cap with a stable secondary order", async () => {
		const { CATALOG_PAGE_SIZE, fetchExerciseCatalog } = await import(
			"../exercises"
		);
		const pageOne = Array.from({ length: CATALOG_PAGE_SIZE }, (_, i) => ({
			...catalogRow,
			id: `ex_${String(i).padStart(4, "0")}`,
			name: `Exercise ${i}`,
			display_name: `Exercise ${i}`,
		}));
		const pageTwo = [
			{ ...catalogRow, id: "ex_1000", name: "Tail", display_name: "Tail" },
		];
		query = buildAwaitableQuery((from = 0) => ({
			data: from === 0 ? pageOne : pageTwo,
			error: null,
		}));

		const result = await fetchExerciseCatalog();

		expect(query.range).toHaveBeenCalledWith(0, CATALOG_PAGE_SIZE - 1);
		expect(query.range).toHaveBeenCalledWith(
			CATALOG_PAGE_SIZE,
			CATALOG_PAGE_SIZE * 2 - 1,
		);
		expect(result).toHaveLength(CATALOG_PAGE_SIZE + 1);
		expect(result[0]?.id).toBe("ex_0000");
		expect(result.at(-1)?.id).toBe("ex_1000");
	});
});
