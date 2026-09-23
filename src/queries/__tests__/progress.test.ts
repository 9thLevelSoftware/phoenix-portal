import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase mock ---------------------------------------------------------

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["select", "eq", "is", "order", "gte"]) {
		self[method] = vi.fn();
	}
	for (const method of Object.keys(self)) {
		self[method].mockReturnValue({ ...self, ...terminal });
	}
	return self;
}

let chain: ReturnType<typeof buildChain>;
const fromFn = vi.fn(() => chain);

interface RpcCall {
	fn: string;
	args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
let rpcHandler: (
	fn: string,
	args: Record<string, unknown>,
) => { data: unknown; error: unknown };

function rpcBuilder(fn: string, args: Record<string, unknown> = {}) {
	rpcCalls.push({ fn, args });
	const settle = async () => rpcHandler(fn, args);
	// A real promise (awaitable like PostgrestFilterBuilder) that also accepts
	// `.select(...)` for the embed form.
	return Object.assign(settle(), { select: () => settle() });
}

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: (...args: unknown[]) => fromFn(...args),
		rpc: (fn: string, args?: Record<string, unknown>) =>
			rpcBuilder(fn, args ?? {}),
	},
}));

// --- Seeded exercise_progress ---------------------------------------------
//
// R-17: 1,200 rows across 4 exercises, i.e. more than PostgREST's 1,000-row
// `max_rows`, so the pre-PR-40 "select every row ascending" shape could not
// return the newest ones.

const MAX_ROWS = 1000;
const EXERCISES = [
	"Bench Press",
	"Deadlift",
	"Overhead Press",
	"Zercher Squat",
];
const ROWS_PER_EXERCISE = 300;
const TOTAL_PROGRESS_ROWS = EXERCISES.length * ROWS_PER_EXERCISE;
const USER_ID = "22222222-2222-4222-8222-222222222222";

interface ProgressSeedRow {
	id: string;
	user_id: string;
	exercise_name: string;
	session_id: string;
	recorded_at: string;
	max_weight_kg: number;
	total_volume_kg: number;
	estimated_1rm_kg: number;
	velocity_estimated_1rm_kg: number | null;
	max_reps: number;
	set_count: number;
}

/** Ascending by recorded_at; the last element is the newest row overall. */
function seedProgress(): ProgressSeedRow[] {
	const base = Date.UTC(2024, 0, 1);
	const rows: ProgressSeedRow[] = [];
	for (let i = 0; i < TOTAL_PROGRESS_ROWS; i++) {
		rows.push({
			id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
			user_id: USER_ID,
			exercise_name: EXERCISES[i % EXERCISES.length],
			session_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
			recorded_at: new Date(base + i * 3_600_000).toISOString(),
			max_weight_kg: 50 + i,
			total_volume_kg: 1000 + i,
			estimated_1rm_kg: 60 + i,
			velocity_estimated_1rm_kg: null,
			max_reps: 8,
			set_count: 4,
		});
	}
	return rows;
}

const PROGRESS = seedProgress();
const NEWEST = PROGRESS[PROGRESS.length - 1];

/**
 * What the pre-PR-40 shape returned: every row, ascending, silently cut at
 * `max_rows`. The rows it drops are the NEWEST ones (F-034).
 */
function legacyAscendingSelect(store: ProgressSeedRow[]): ProgressSeedRow[] {
	return store.slice(0, MAX_ROWS);
}

function newestFirst(rows: ProgressSeedRow[]) {
	return [...rows].sort((a, b) =>
		a.recorded_at === b.recorded_at
			? b.id.localeCompare(a.id)
			: b.recorded_at.localeCompare(a.recorded_at),
	);
}

/** Serves the three progress RPCs from the seeded store. */
function progressHandler(store: ProgressSeedRow[]) {
	return (fn: string, args: Record<string, unknown>) => {
		if (fn === "exercise_names") {
			const names = [...new Set(store.map((row) => row.exercise_name))].sort();
			// A jsonb-returning RPC is one PostgREST row regardless of how many
			// elements its JSON array contains.
			return { data: names, error: null };
		}
		if (fn === "exercise_progress_series") {
			const limit = Math.min((args.p_limit as number) ?? 500, MAX_ROWS);
			const rows = newestFirst(
				store.filter((row) => row.exercise_name === args.p_exercise),
			).slice(0, limit);
			return { data: rows, error: null };
		}
		if (fn === "exercise_progress_series_many") {
			const limit = Math.min(
				(args.p_limit_per_exercise as number) ?? 100,
				MAX_ROWS,
			);
			const names = [...new Set(store.map((row) => row.exercise_name))];
			const groups = names.map((name) => {
				const rows = newestFirst(
					store.filter((row) => row.exercise_name === name),
				).slice(0, limit);
				return {
					exercise_name: name,
					latest_recorded_at: rows[0]?.recorded_at ?? null,
					rows,
				};
			});
			// The scalar JSON envelope is one PostgREST row even when it contains
			// more than max_rows exercise groups.
			return { data: groups, error: null };
		}
		return { data: null, error: { code: "42883", message: `no ${fn}` } };
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	rpcCalls.length = 0;
	chain = buildChain({ data: [], error: null });
	fromFn.mockImplementation(() => chain);
	rpcHandler = progressHandler(PROGRESS);
});

describe("exerciseListOptions", () => {
	it("de-duplicates names in SQL instead of reading every progress row", async () => {
		const { exerciseListOptions } = await import("../progress");
		const opts = exerciseListOptions("user-1", "profile-1");
		const names = await opts.queryFn?.({} as never);

		expect(opts.queryKey).toEqual(
			queryKeys.progress.exercises("user-1", "profile-1"),
		);
		expect(fromFn).not.toHaveBeenCalled();
		expect(rpcCalls).toEqual([
			{ fn: "exercise_names", args: { p_profile_id: "profile-1" } },
		]);
		expect(names).toEqual([...EXERCISES].sort());
	});

	it("keeps the alphabetically last exercise that the 1,000-row cap dropped", async () => {
		// 1,200 exercises, one progress row each (R-17).
		const manyNames = Array.from({ length: 1200 }, (_, index) => ({
			...PROGRESS[0],
			id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
			exercise_name: `Exercise ${String(index).padStart(4, "0")}`,
		}));
		rpcHandler = progressHandler(manyNames);
		const lastName = manyNames[manyNames.length - 1].exercise_name;

		const { exerciseListOptions } = await import("../progress");
		const names = await exerciseListOptions("user-1").queryFn?.({} as never);

		expect(names).toHaveLength(1200);
		expect(names).toContain(lastName);
		// A row-returning RPC or direct select is cut at max_rows, so the tail of
		// the alphabet disappears. The scalar JSON response keeps every name.
		const legacyNames = new Set(
			[...manyNames]
				.sort((a, b) => a.exercise_name.localeCompare(b.exercise_name))
				.slice(0, MAX_ROWS)
				.map((row) => row.exercise_name),
		);
		expect(legacyNames.has(lastName)).toBe(false);
	});

	it("omits the profile argument rather than passing null", async () => {
		const { exerciseListOptions } = await import("../progress");
		await exerciseListOptions("user-1").queryFn?.({} as never);
		expect(rpcCalls[0].args).toEqual({});
	});
});

describe("exerciseProgressOptions", () => {
	it("reads the newest rows through exercise_progress_series and returns them ascending", async () => {
		const { exerciseProgressOptions, EXERCISE_PROGRESS_SERIES_LIMIT } =
			await import("../progress");
		const opts = exerciseProgressOptions("user-1", "Bench Press", "profile-1");
		const rows = await opts.queryFn?.({} as never);
		if (!rows) throw new Error("Expected exercise progress query to run");

		expect(fromFn).not.toHaveBeenCalled();
		expect(rpcCalls).toEqual([
			{
				fn: "exercise_progress_series",
				args: {
					p_exercise: "Bench Press",
					p_limit: EXERCISE_PROGRESS_SERIES_LIMIT,
					p_profile_id: "profile-1",
				},
			},
		]);
		expect(EXERCISE_PROGRESS_SERIES_LIMIT).toBeLessThanOrEqual(MAX_ROWS);
		expect(rows).toHaveLength(ROWS_PER_EXERCISE);
		// Callers chart chronologically.
		expect(rows[0].recorded_at.getTime()).toBeLessThan(
			rows[rows.length - 1].recorded_at.getTime(),
		);
		const newestBench = newestFirst(
			PROGRESS.filter((row) => row.exercise_name === "Bench Press"),
		)[0];
		expect(rows[rows.length - 1].recorded_at).toEqual(
			new Date(newestBench.recorded_at),
		);
	});
});

describe("progressionWorkbenchOptions", () => {
	it("fetches every exercise's series in one batched call and no personal records", async () => {
		const { progressionWorkbenchOptions, WORKBENCH_ROWS_PER_EXERCISE } =
			await import("../progress");
		const opts = progressionWorkbenchOptions("user-1", "profile-1");
		const result = await opts.queryFn?.({} as never);
		if (!result) throw new Error("Expected progression workbench query to run");

		expect(opts.queryKey).toEqual(
			queryKeys.progress.summary("user-1", "workbench", "profile-1"),
		);
		// One call, not one per exercise, and no `p_exercises: null`.
		expect(rpcCalls).toEqual([
			{
				fn: "exercise_progress_series_many",
				args: {
					p_limit_per_exercise: WORKBENCH_ROWS_PER_EXERCISE,
					p_profile_id: "profile-1",
				},
			},
		]);
		// Records now come from the shared personalRecordsOptions query, so the
		// workbench issues no record request of its own (the duplicate fetch).
		expect(fromFn).not.toHaveBeenCalled();
		expect(result).not.toHaveProperty("records");
		expect(result.progressRows.length).toBe(
			EXERCISES.length *
				Math.min(WORKBENCH_ROWS_PER_EXERCISE, ROWS_PER_EXERCISE),
		);
	});

	it("keeps the newest progress row that the 1,000-row cap dropped", async () => {
		const { progressionWorkbenchOptions } = await import("../progress");
		const result = await progressionWorkbenchOptions("user-1").queryFn?.(
			{} as never,
		);
		if (!result) throw new Error("Expected progression workbench query to run");

		const ids = result.progressRows.map((row) => row.id);
		expect(ids).toContain(NEWEST.id);
		// The shape this replaces returned every row ascending and was cut at
		// max_rows, so the newest row was the first thing lost.
		const legacyIds = legacyAscendingSelect(PROGRESS).map((row) => row.id);
		expect(legacyIds).not.toContain(NEWEST.id);
		expect(legacyIds).toHaveLength(MAX_ROWS);
		expect(TOTAL_PROGRESS_ROWS).toBeGreaterThan(MAX_ROWS);
	});

	it("parses each jsonb rows element with the exercise progress schema", async () => {
		const { progressionWorkbenchOptions } = await import("../progress");
		const result = await progressionWorkbenchOptions("user-1").queryFn?.(
			{} as never,
		);
		if (!result) throw new Error("Expected progression workbench query to run");

		const row = result.progressRows[0];
		expect(row.recorded_at).toBeInstanceOf(Date);
		// Was "weightTransform doubles stored kilograms" — that constant is
		// gone (KD-8). perCableWeight is z.number(), so the parsed value is
		// the stored per-cable one.
		const source = PROGRESS.find((seed) => seed.id === row.id);
		expect(row.max_weight_kg).toBe(source?.max_weight_kg ?? 0);
	});

	it("throws when the RPC fails", async () => {
		rpcHandler = () => ({ data: null, error: { message: "boom" } });
		const { progressionWorkbenchOptions } = await import("../progress");
		await expect(
			progressionWorkbenchOptions("user-1").queryFn?.({} as never),
		).rejects.toMatchObject({ message: "boom" });
	});
});

describe("weeklySummaryOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// NF-36: velocity_estimated_1rm_kg is INFERNO-only and not client-readable
	// (20260923100000), so a `*` select would be refused for every user.
	it("selects explicit columns without the INFERNO-only VBT 1RM", async () => {
		chain = buildChain({
			data: [
				{
					id: "00000000-0000-4000-8000-000000000001",
					user_id: "00000000-0000-4000-8000-0000000000aa",
					exercise_name: "Bench Press",
					session_id: "00000000-0000-4000-8000-0000000000bb",
					recorded_at: "2026-09-20T10:00:00Z",
					max_weight_kg: 40,
					total_volume_kg: 400,
					estimated_1rm_kg: 50,
					max_reps: 10,
					set_count: 3,
				},
			],
			error: null,
		});
		const { weeklySummaryOptions } = await import("../progress");
		const rows = await weeklySummaryOptions("user-1", "week").queryFn!(
			{} as never,
		);

		const columns = String(chain.select.mock.calls[0]?.[0]);
		expect(columns).not.toContain("*");
		expect(columns).not.toContain("velocity_estimated_1rm_kg");
		expect(rows[0]?.velocity_estimated_1rm_kg).toBeNull();
	});
});
