import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/queries/keys";

// --- Supabase chainable mock builder -------------------------------------

function buildChain(terminal: { data: unknown; error: unknown }) {
	const self: Record<string, ReturnType<typeof vi.fn>> = {};
	const methods = ["select", "eq", "in", "is", "order"];
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

// --- RPC mock --------------------------------------------------------------
//
// `supabase.rpc(...)` returns a PostgrestFilterBuilder: awaitable on its own
// and `.select(...)`-able for an embed. The mock supports both and records
// every call so tests can count real network round trips.

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

// --- Seeded personal-record history ---------------------------------------
//
// R-17: more than PostgREST's 1,000-row `max_rows`, so a single unbounded
// select cannot return the whole history.

const TOTAL_RECORDS = 1100;
const USER_ID = "22222222-2222-4222-8222-222222222222";

interface SeedRow {
	id: string;
	user_id: string;
	exercise_name: string;
	muscle_group: string;
	record_type: string;
	value: number;
	unit: string;
	achieved_at: string;
	previous_value: number | null;
}

/** Newest first. Index 0 is the most recent PR in the account. */
function seedRecords(total = TOTAL_RECORDS): SeedRow[] {
	const base = Date.UTC(2026, 8, 20, 12, 0, 0);
	return Array.from({ length: total }, (_, index) => ({
		id: `00000000-0000-4000-8000-${String(total - index).padStart(12, "0")}`,
		user_id: USER_ID,
		exercise_name: `Exercise ${total - index}`,
		muscle_group: "Chest",
		record_type: "MAX_WEIGHT",
		value: 100 + (total - index),
		unit: "kg",
		// Microsecond precision, exactly as PostgREST renders timestamptz. A JS
		// `Date` round trip truncates the trailing "789".
		achieved_at: `${new Date(base - index * 3_600_000)
			.toISOString()
			.replace("Z", "")}789+00:00`,
		previous_value: null,
	}));
}

const RECORDS = seedRecords();
const NEWEST = RECORDS[0];
const OLDEST = RECORDS[RECORDS.length - 1];

/** PostgREST's silent 1,000-row cap (F-012). */
const MAX_ROWS = 1000;

/**
 * What the pre-PR-40 query shape returned: one unbounded, ascending select,
 * silently cut to `max_rows`. Kept in the test to state the defect this PR
 * fixes — the rows it drops are the NEWEST ones.
 */
function legacyAscendingSelect(store: SeedRow[]): SeedRow[] {
	return [...store].reverse().slice(0, MAX_ROWS);
}

function keyOf(row: { achieved_at: string; id: string }) {
	return `${row.achieved_at}|${row.id}`;
}

/** Serves `personal_record_history` from the seeded store. */
function historyHandler(store: SeedRow[]) {
	return (fn: string, args: Record<string, unknown>) => {
		if (fn !== "personal_record_history") {
			return { data: null, error: { code: "42883", message: `no ${fn}` } };
		}
		const before = args.p_before as string | undefined;
		const beforeId = args.p_before_id as string | undefined;
		if ((before == null) !== (beforeId == null)) {
			return {
				data: null,
				error: { code: "22023", message: "cursor halves must be paired" },
			};
		}
		let rows = store;
		if (before != null && beforeId != null) {
			// The RPC verifies the cursor against a real row and raises 22023
			// rather than skipping rows silently.
			const cursorRow = store.find(
				(row) => row.id === beforeId && row.achieved_at === before,
			);
			if (!cursorRow) {
				return {
					data: null,
					error: { code: "22023", message: "cursor does not match a record" },
				};
			}
			rows = store.filter((row) => keyOf(row) < keyOf(cursorRow));
		}
		const limit = Math.min((args.p_limit as number) ?? 200, MAX_ROWS);
		return { data: rows.slice(0, limit), error: null };
	};
}

const recordRow = {
	id: "11111111-1111-4111-8111-111111111111",
	user_id: USER_ID,
	exercise_name: "Bench Press",
	muscle_group: "Chest",
	record_type: "1RM",
	value: 80,
	unit: "kg",
	achieved_at: "2026-03-10T14:30:00Z",
	previous_value: 75,
};

/** Serves a fixed row set from a single page. */
function staticHandler(data: unknown, error: unknown = null) {
	return () => ({ data, error });
}

async function firstPage(userId = "user-1", profileId?: string | null) {
	const { personalRecordsOptions } = await import("../records");
	const opts = personalRecordsOptions(userId, profileId);
	return opts.queryFn?.({ pageParam: null } as never);
}

// --- Tests ----------------------------------------------------------------

describe("personalRecordsOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rpcCalls.length = 0;
		chain = buildChain({ data: [], error: null });
		fromFn.mockImplementation(() => chain);
		rpcHandler = staticHandler([]);
	});

	it("uses records.byUser query key", async () => {
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		expect(opts.queryKey).toEqual(queryKeys.records.byUser("user-1"));
	});

	it("reads newest-first through personal_record_history, not an unbounded select", async () => {
		rpcHandler = historyHandler(RECORDS);
		const { PERSONAL_RECORDS_PAGE_SIZE } = await import("../records");

		const page = await firstPage("user-1", "profile-1");

		expect(fromFn).not.toHaveBeenCalledWith("personal_records");
		expect(rpcCalls).toHaveLength(1);
		expect(rpcCalls[0].fn).toBe("personal_record_history");
		expect(rpcCalls[0].args.p_limit).toBe(PERSONAL_RECORDS_PAGE_SIZE);
		expect(rpcCalls[0].args.p_profile_id).toBe("profile-1");
		// Defaulted arguments are omitted, never passed as null.
		expect(rpcCalls[0].args).not.toHaveProperty("p_before");
		expect(rpcCalls[0].args).not.toHaveProperty("p_before_id");
		// Page size stays under PostgREST's max_rows so a short page really
		// means "no more rows".
		expect(PERSONAL_RECORDS_PAGE_SIZE).toBeLessThan(MAX_ROWS);
		expect(page?.records[0].exercise_name).toBe(NEWEST.exercise_name);
	});

	it("puts the newest PR on the first page of a 1,100-record history", async () => {
		rpcHandler = historyHandler(RECORDS);

		const page = await firstPage();
		const names = page?.records.map((record) => record.exercise_name) ?? [];

		expect(names).toContain(NEWEST.exercise_name);
		// The shape this replaces lost exactly that record.
		const legacyNames = legacyAscendingSelect(RECORDS).map(
			(row) => row.exercise_name,
		);
		expect(legacyNames).not.toContain(NEWEST.exercise_name);
		expect(legacyNames).toHaveLength(MAX_ROWS);
	});

	it("carries the cursor as the raw achieved_at string plus id", async () => {
		rpcHandler = historyHandler(RECORDS);
		const { PERSONAL_RECORDS_PAGE_SIZE } = await import("../records");

		const page = await firstPage();
		const lastRow = RECORDS[PERSONAL_RECORDS_PAGE_SIZE - 1];

		expect(page?.nextCursor).toEqual({
			before: lastRow.achieved_at,
			beforeId: lastRow.id,
		});
		// Microseconds survive: a JS Date round trip would truncate them and the
		// RPC would answer 22023 instead of paging.
		expect(page?.nextCursor?.before).toMatch(/\.\d{6}\+00:00$/);
		expect(new Date(page?.nextCursor?.before ?? "").toISOString()).not.toBe(
			page?.nextCursor?.before,
		);
	});

	it("pages the whole 1,100-record history, newest first and without gaps", async () => {
		rpcHandler = historyHandler(RECORDS);
		const { personalRecordsOptions, PERSONAL_RECORDS_PAGE_SIZE } = await import(
			"../records"
		);
		const opts = personalRecordsOptions("user-1");

		const collected: string[] = [];
		let cursor = opts.initialPageParam;
		let pages = 0;
		do {
			const page = await opts.queryFn?.({ pageParam: cursor } as never);
			if (!page) break;
			collected.push(...page.records.map((record) => record.exercise_name));
			cursor = page.nextCursor;
			pages++;
		} while (cursor && pages < 10);

		expect(pages).toBe(Math.ceil(TOTAL_RECORDS / PERSONAL_RECORDS_PAGE_SIZE));
		expect(collected).toHaveLength(TOTAL_RECORDS);
		expect(new Set(collected).size).toBe(TOTAL_RECORDS);
		expect(collected[0]).toBe(NEWEST.exercise_name);
		expect(collected[collected.length - 1]).toBe(OLDEST.exercise_name);
	});

	it("stops paging on a short page", async () => {
		rpcHandler = historyHandler(RECORDS.slice(0, 3));
		const page = await firstPage();
		expect(page?.nextCursor).toBeNull();
	});

	it("does not refetch when a consumer mounts later in the same page view", async () => {
		rpcHandler = historyHandler(RECORDS);
		const { personalRecordsOptions } = await import("../records");
		// QueryProvider's defaults (src/providers/QueryProvider.tsx).
		const client = new QueryClient({
			defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } },
		});

		// The workbench on page load, then the Records tab when the user
		// switches to it.
		await client.ensureInfiniteQueryData(personalRecordsOptions("user-1"));
		await client.ensureInfiniteQueryData(personalRecordsOptions("user-1"));

		expect(
			rpcCalls.filter((call) => call.fn === "personal_record_history"),
		).toHaveLength(1);
	});

	it("fetches records once when two consumers mount the same query", async () => {
		rpcHandler = historyHandler(RECORDS);
		const { personalRecordsOptions } = await import("../records");
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		// The Records tab and the progression workbench on one page view.
		await Promise.all([
			client.fetchInfiniteQuery(personalRecordsOptions("user-1", "profile-1")),
			client.fetchInfiniteQuery(personalRecordsOptions("user-1", "profile-1")),
		]);

		expect(
			rpcCalls.filter((call) => call.fn === "personal_record_history"),
		).toHaveLength(1);
	});

	it("flattens loaded pages for consumers", async () => {
	it("returns Zod-transformed records with per-cable weights", async () => {
		chain = buildChain({ data: [recordRow], error: null });
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");
		const flattened = opts.select?.({
			pages: [
				{ records: ["a", "b"], nextCursor: null },
				{ records: ["c"], nextCursor: null },
			],
			pageParams: [null, null],
		} as never);
		expect(flattened).toEqual(["a", "b", "c"]);
	});

	it("does not retry a stale cursor and recognises the 22023 guard", async () => {
		const { personalRecordsOptions, isStalePersonalRecordCursorError } =
			await import("../records");
		const opts = personalRecordsOptions("user-1");
		const staleError = { code: "22023", message: "cursor does not match" };

		expect(isStalePersonalRecordCursorError(staleError)).toBe(true);
		expect(isStalePersonalRecordCursorError({ code: "PGRST116" })).toBe(false);
		expect(
			typeof opts.retry === "function"
				? opts.retry(0, staleError as never)
				: true,
		).toBe(false);
		expect(
			typeof opts.retry === "function"
				? opts.retry(0, { code: "08006" } as never)
				: false,
		).toBe(true);
	});

	it("surfaces the 22023 guard instead of silently skipping rows", async () => {
		rpcHandler = historyHandler(RECORDS);
		const { personalRecordsOptions } = await import("../records");
		const opts = personalRecordsOptions("user-1");

		// A millisecond-truncated cursor, i.e. the Date round trip the RPC
		// rejects by design.
		const truncated = new Date(NEWEST.achieved_at).toISOString();
		await expect(
			opts.queryFn?.({
				pageParam: { before: truncated, beforeId: NEWEST.id },
			} as never),
		).rejects.toMatchObject({ code: "22023" });
	});

	it("returns Zod-transformed records with doubled weights", async () => {
		rpcHandler = staticHandler([recordRow]);
		const page = await firstPage();

		expect(page?.records).toHaveLength(1);
		expect(page?.records[0].value).toBe(160);
		expect(page?.records[0].previous_value).toBe(150);
		expect(page?.records[0].achieved_at).toBeInstanceOf(Date);
		expect(page?.records[0].exercise_name).toBe("Bench Press");
		expect(result).toHaveLength(1);
		// Records stay per cable (KD-8); no doubling.
		expect(result[0].value).toBe(80);
		expect(result[0].previous_value).toBe(75);
		// achieved_at should be a Date
		expect(result[0].achieved_at).toBeInstanceOf(Date);
		expect(result[0].exercise_name).toBe("Bench Press");
	});

	it("normalizes leaked catalog IDs to catalog display names", async () => {
		rpcHandler = staticHandler([
			{
				...recordRow,
				exercise_name: "Barbell_Curl",
				exercise_id: "Barbell_Curl",
				catalog: {
					id: "Barbell_Curl",
					name: "Bayesian Curl",
					display_name: "Bayesian Curl (Handles)",
				},
			},
		]);
		const page = await firstPage();
		expect(page?.records[0].exercise_name).toBe("Bayesian Curl (Handles)");
	});

	it("normalizes leaked session exercise row IDs to exercise names", async () => {
		rpcHandler = staticHandler([
			{
				...recordRow,
				exercise_name: "77f8d4e5-d97c-43ac-b4fc-d5ff35f67f8d",
				exercise_id: null,
				session_id: "33333333-3333-4333-8333-333333333333",
			},
		]);
		chain = buildChain({
			data: [
				{
					id: "77f8d4e5-d97c-43ac-b4fc-d5ff35f67f8d",
					session_id: "33333333-3333-4333-8333-333333333333",
					name: "Seated Row",
					exercise_id: "Seated_Row",
					catalog: null,
				},
			],
			error: null,
		});
		fromFn.mockImplementation(() => chain);

		const page = await firstPage();
		expect(fromFn).toHaveBeenCalledWith("exercises");
		expect(page?.records[0].exercise_name).toBe("Seated Row");
	});

	it("handles null previous_value", async () => {
		rpcHandler = staticHandler([{ ...recordRow, previous_value: null }]);
		const page = await firstPage();
		expect(page?.records[0].previous_value).toBeNull();
	});

	it("throws on Supabase error", async () => {
		rpcHandler = staticHandler(null, { message: "boom" });
		await expect(firstPage()).rejects.toMatchObject({ message: "boom" });
	});

	it("returns empty array when no records exist", async () => {
		rpcHandler = staticHandler([]);
		const page = await firstPage();
		expect(page?.records).toEqual([]);
		expect(page?.nextCursor).toBeNull();
	});
});
