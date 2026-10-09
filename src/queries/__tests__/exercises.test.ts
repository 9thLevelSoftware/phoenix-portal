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
		const { SUPABASE_PAGE_SIZE } = await import("@/lib/supabasePaging");
		const { fetchExerciseCatalog } = await import("../exercises");

		await fetchExerciseCatalog();

		expect(fromFn).toHaveBeenCalledWith("exercise_catalog");
		expect(query.eq).toHaveBeenCalledWith("archived", false);
		expect(query.order).toHaveBeenCalledWith("popularity", {
			ascending: false,
		});
		expect(query.order).toHaveBeenCalledWith("id", { ascending: true });
		expect(query.range).toHaveBeenCalledWith(0, SUPABASE_PAGE_SIZE - 1);
	});

	it("omits the archived filter when includeArchived is true", async () => {
		const { fetchExerciseCatalog } = await import("../exercises");

		const result = await fetchExerciseCatalog({ includeArchived: true });

		expect(query.eq).not.toHaveBeenCalledWith("archived", false);
		expect(result[0]?.id).toBe("Triceps_Pushdown");
		expect(result[0]?.thumbnail_url).toBe(
			"https://test-project.supabase.co/storage/v1/object/public/exercise-media/Triceps_Pushdown/0.jpg",
		);
	});

	it("resolves relative exercise-media keys onto the active Supabase host", async () => {
		query = buildAwaitableQuery(() => ({
			data: [{ ...catalogRow, thumbnail_url: "Triceps_Pushdown/0.jpg" }],
			error: null,
		}));
		const { fetchExerciseCatalog } = await import("../exercises");

		const result = await fetchExerciseCatalog({ includeArchived: true });

		expect(result[0]?.thumbnail_url).toBe(
			"https://test-project.supabase.co/storage/v1/object/public/exercise-media/Triceps_Pushdown/0.jpg",
		);
	});

	it("pages past the PostgREST cap on popularity then id and returns one array", async () => {
		const { SUPABASE_PAGE_SIZE } = await import("@/lib/supabasePaging");
		const { fetchExerciseCatalog } = await import("../exercises");
		const pageOne = Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => ({
			...catalogRow,
			id: `ex_${String(i).padStart(4, "0")}`,
			name: `Exercise ${i}`,
			display_name: `Exercise ${i}`,
		}));
		const tailId = `ex_${String(SUPABASE_PAGE_SIZE).padStart(4, "0")}`;
		const pageTwo = [
			{ ...catalogRow, id: tailId, name: "Tail", display_name: "Tail" },
		];
		query = buildAwaitableQuery((from = 0) => ({
			data: from === 0 ? pageOne : pageTwo,
			error: null,
		}));

		const result = await fetchExerciseCatalog();

		expect(query.range).toHaveBeenCalledWith(0, SUPABASE_PAGE_SIZE - 1);
		expect(query.range).toHaveBeenCalledWith(
			SUPABASE_PAGE_SIZE,
			SUPABASE_PAGE_SIZE * 2 - 1,
		);
		expect(result).toHaveLength(SUPABASE_PAGE_SIZE + 1);
		expect(result[0]?.id).toBe("ex_0000");
		expect(result.at(-1)?.id).toBe(tailId);
	});

	it("throws on Supabase error", async () => {
		query = buildAwaitableQuery(() => ({
			data: null,
			error: { message: "fetch failed" },
		}));
		const { fetchExerciseCatalog } = await import("../exercises");

		await expect(fetchExerciseCatalog()).rejects.toEqual(
			expect.objectContaining({ message: "fetch failed" }),
		);
	});
});
