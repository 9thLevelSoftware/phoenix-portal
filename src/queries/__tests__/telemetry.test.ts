import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAllKeysetPages } from "@/lib/supabasePaging";

// --- In-memory PostgREST fake ---------------------------------------------
// A stateful query builder over seeded tables. It applies select/eq/gte/or/
// order/limit/range the way PostgREST does and, like hosted Supabase, silently
// caps every response at MAX_ROWS. An unpaged select therefore returns only
// the first 1,000 rows, which is exactly the truncation these tests guard
// against.

const MAX_ROWS = 1000;
type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const requests: Array<{
	table: string;
	columns: string;
	/** Lower bound sent via gte("timestamp_ms", …), if any. */
	lowerBound: number | null;
	returned: number;
}> = [];
/** Makes the Nth request (0-based) to `table` return a PostgREST error. */
let failOn: { table: string; nth: number } | null = null;

const KEYSET_OR =
	/^timestamp_ms\.gt\.(\d+),and\(timestamp_ms\.eq\.(\d+),id\.gt\.(.+)\)$/;

function compare(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function project(row: Row, columns: string): Row {
	if (columns.trim() === "*") return { ...row };
	const out: Row = {};
	for (const column of columns.split(",").map((c) => c.trim())) {
		out[column] = row[column];
	}
	return out;
}

function queryBuilder(table: string) {
	const filters: Array<(row: Row) => boolean> = [];
	const orders: Array<{ column: string; ascending: boolean }> = [];
	let columns = "*";
	let lowerBound: number | null = null;
	let limit: number | null = null;
	let range: [number, number] | null = null;

	const run = () => {
		const nth = requests.filter((r) => r.table === table).length;
		if (failOn && failOn.table === table && failOn.nth === nth) {
			requests.push({ table, columns, lowerBound, returned: 0 });
			return { data: null, error: { message: "boom", code: "57014" } };
		}
		let rows = (tables[table] ?? []).filter((row) =>
			filters.every((f) => f(row)),
		);
		rows = [...rows].sort((a, b) => {
			for (const { column, ascending } of orders) {
				const c = compare(a[column], b[column]);
				if (c !== 0) return ascending ? c : -c;
			}
			return 0;
		});
		if (range) rows = rows.slice(range[0], range[1] + 1);
		if (limit != null) rows = rows.slice(0, limit);
		rows = rows.slice(0, MAX_ROWS).map((row) => project(row, columns));
		requests.push({ table, columns, lowerBound, returned: rows.length });
		return { data: rows, error: null };
	};

	const builder = {
		select: (cols = "*") => {
			columns = cols;
			return builder;
		},
		eq: (column: string, value: unknown) => {
			filters.push((row) => row[column] === value);
			return builder;
		},
		gte: (column: string, value: number) => {
			if (column === "timestamp_ms") lowerBound = value;
			filters.push((row) => (row[column] as number) >= value);
			return builder;
		},
		or: (expr: string) => {
			const match = KEYSET_OR.exec(expr);
			if (!match) throw new Error(`fake does not understand or(${expr})`);
			const ts = Number(match[1]);
			const eqTs = Number(match[2]);
			const id = match[3];
			filters.push(
				(row) =>
					(row.timestamp_ms as number) > ts ||
					((row.timestamp_ms as number) === eqTs && String(row.id) > id),
			);
			return builder;
		},
		order: (column: string, opts?: { ascending?: boolean }) => {
			orders.push({ column, ascending: opts?.ascending ?? true });
			return builder;
		},
		limit: (n: number) => {
			limit = n;
			return builder;
		},
		range: (from: number, to: number) => {
			range = [from, to];
			return builder;
		},
		// biome-ignore lint/suspicious/noThenProperty: mimics the PromiseLike Supabase builder
		then: <R>(resolve: (value: ReturnType<typeof run>) => R) =>
			Promise.resolve(run()).then(resolve),
	};
	return builder;
}

vi.mock("@/lib/supabase", () => ({
	supabase: { from: (table: string) => queryBuilder(table) },
}));

// --- Seed data --------------------------------------------------------------

const SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAMPLES = 2500;
const CHART_COLUMNS = [
	"cable",
	"force_n",
	"position_mm",
	"timestamp_ms",
	"velocity_mps",
];

/** Deterministic, non-monotonic UUID so id order differs from insert order. */
function uuidFor(n: number): string {
	const scrambled = ((n * 2654435761) >>> 0).toString(16).padStart(8, "0");
	const tail = n.toString(16).padStart(12, "0");
	return `${scrambled}-0000-4000-8000-${tail}`;
}

/**
 * 2,500 rows for one set, like real 50 Hz dual-cable capture: row 0 is a
 * single-cable sample at t=0, then every later timestamp has cables A and B.
 * That one-row offset puts sorted rows 999/1000 and 1999/2000 on the same
 * timestamp, so both page boundaries split a tie and only the id tiebreaker
 * keeps paging from skipping or repeating a sample. Inserted in reverse order.
 */
function seedTelemetry(): Row[] {
	const rows: Row[] = [];
	for (let i = 0; i < SAMPLES; i++) {
		const sample = Math.floor((i + 1) / 2);
		rows.push({
			id: uuidFor(i),
			set_id: SET_ID,
			timestamp_ms: sample * 20,
			force_n: 100 + (i % 7),
			velocity_mps: 0.5,
			position_mm: sample % 400,
			cable: i % 2 === 0 ? "A" : "B",
		});
	}
	for (let i = 0; i < 50; i++) {
		rows.push({
			id: uuidFor(SAMPLES + i),
			set_id: OTHER_SET_ID,
			timestamp_ms: i * 20,
			force_n: 1,
			velocity_mps: 1,
			position_mm: 1,
			cable: "A",
		});
	}
	return rows.reverse();
}

function sortedRows(rows: Row[], setId = SET_ID) {
	return rows
		.filter((row) => row.set_id === setId)
		.sort(
			(a, b) => compare(a.timestamp_ms, b.timestamp_ms) || compare(a.id, b.id),
		);
}

function expectedOrder(rows: Row[], setId = SET_ID) {
	return sortedRows(rows, setId).map((row) => ({
		timestamp_ms: row.timestamp_ms,
		force_n: row.force_n,
		velocity_mps: row.velocity_mps,
		position_mm: row.position_mm,
		cable: row.cable,
	}));
}

beforeEach(() => {
	requests.length = 0;
	failOn = null;
	const telemetry = seedTelemetry();
	tables.rep_telemetry = telemetry;
	tables.telemetry_points = telemetry; // view over rep_telemetry
	tables.rep_summaries = [];
});

describe("repTelemetryOptions", () => {
	it("returns all 2,500 samples of a set in (timestamp_ms, id) order despite the 1,000-row cap", async () => {
		// Guard the seed: both page boundaries must split a timestamp tie.
		const sorted = sortedRows(tables.rep_telemetry);
		expect(sorted[999].timestamp_ms).toBe(sorted[1000].timestamp_ms);
		expect(sorted[1999].timestamp_ms).toBe(sorted[2000].timestamp_ms);

		const { repTelemetryOptions } = await import("../telemetry");
		const result = await repTelemetryOptions(SET_ID).queryFn?.({} as never);

		expect(result).toHaveLength(SAMPLES);
		expect(result).toEqual(expectedOrder(tables.rep_telemetry));
		// Paged: three reads (1000 + 1000 + 500), none above the cap.
		expect(requests.map((r) => r.returned)).toEqual([1000, 1000, 500]);
		// Later pages carry an index-usable lower bound at the cursor timestamp.
		expect(requests.map((r) => r.lowerBound)).toEqual([
			null,
			sorted[999].timestamp_ms,
			sorted[1999].timestamp_ms,
		]);
	});

	it("stops after one read when the set fits in a single short page", async () => {
		const { repTelemetryOptions } = await import("../telemetry");
		const result = await repTelemetryOptions(OTHER_SET_ID).queryFn?.(
			{} as never,
		);

		expect(result).toHaveLength(50);
		expect(requests).toHaveLength(1);
	});

	it("makes one extra empty read when the set is exactly one full page", async () => {
		tables.rep_telemetry = sortedRows(tables.rep_telemetry).slice(0, 1000);
		const { repTelemetryOptions } = await import("../telemetry");
		const result = await repTelemetryOptions(SET_ID).queryFn?.({} as never);

		expect(result).toHaveLength(1000);
		expect(requests.map((r) => r.returned)).toEqual([1000, 0]);
	});

	it("rejects instead of returning a partial set when a later page errors", async () => {
		failOn = { table: "rep_telemetry", nth: 1 };
		const { repTelemetryOptions } = await import("../telemetry");

		await expect(
			repTelemetryOptions(SET_ID).queryFn?.({} as never),
		).rejects.toMatchObject({ message: "boom" });
	});

	it("drops invalid samples (null metrics, unknown cable) instead of failing the set", async () => {
		const sorted = sortedRows(tables.rep_telemetry);
		const nullForceId = sorted[10].id;
		const nullCableId = sorted[1500].id;
		const oddCableId = sorted[2400].id;
		tables.rep_telemetry = tables.rep_telemetry.map((row) => {
			if (row.id === nullForceId) return { ...row, force_n: null };
			if (row.id === nullCableId) return { ...row, cable: null };
			if (row.id === oddCableId) return { ...row, cable: "left" };
			return row;
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const { repTelemetryOptions } = await import("../telemetry");
		const result = await repTelemetryOptions(SET_ID).queryFn?.({} as never);

		const bad = new Set([nullForceId, nullCableId, oddCableId]);
		expect(result).toHaveLength(SAMPLES - 3);
		expect(result).toEqual(
			expectedOrder(tables.rep_telemetry.filter((row) => !bad.has(row.id))),
		);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 3"));
		warn.mockRestore();
	});
});

describe("replayTelemetryOptions", () => {
	it("returns all 2,500 samples, selecting chart columns rather than *, plus rep summaries", async () => {
		tables.rep_summaries = [
			{ id: "s2", set_id: SET_ID, rep_number: 2 },
			{ id: "s1", set_id: SET_ID, rep_number: 1 },
		];
		const { replayTelemetryOptions } = await import("../replay");
		const result = await replayTelemetryOptions(SET_ID).queryFn?.({} as never);

		expect(result?.telemetry).toHaveLength(SAMPLES);
		expect(result?.telemetry).toEqual(expectedOrder(tables.telemetry_points));
		expect(Object.keys(result?.telemetry[0] ?? {}).sort()).toEqual(
			CHART_COLUMNS,
		);
		// What goes over the wire: chart columns plus the cursor id, never *.
		const telemetryReads = requests.filter(
			(r) => r.table === "telemetry_points",
		);
		expect(telemetryReads).toHaveLength(3);
		for (const read of telemetryReads) {
			expect(
				read.columns
					.split(",")
					.map((c) => c.trim())
					.sort(),
			).toEqual([...CHART_COLUMNS, "id"].sort());
		}
		expect(
			result?.repSummaries.map((s: { rep_number: number }) => s.rep_number),
		).toEqual([1, 2]);
	});

	it("keeps replaying the valid samples when some rows are null", async () => {
		const sorted = sortedRows(tables.telemetry_points);
		const nullIds = new Set([sorted[0].id, sorted[1234].id]);
		tables.telemetry_points = tables.telemetry_points.map((row) =>
			nullIds.has(row.id) ? { ...row, velocity_mps: null, cable: null } : row,
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const { replayTelemetryOptions } = await import("../replay");
		const result = await replayTelemetryOptions(SET_ID).queryFn?.({} as never);

		expect(result?.telemetry).toHaveLength(SAMPLES - 2);
		warn.mockRestore();
	});

	it("rejects when the rep summaries read errors", async () => {
		failOn = { table: "rep_summaries", nth: 0 };
		const { replayTelemetryOptions } = await import("../replay");

		await expect(
			replayTelemetryOptions(SET_ID).queryFn?.({} as never),
		).rejects.toMatchObject({ message: "boom" });
	});
});

describe("fetchAllKeysetPages", () => {
	it("splits a three-row timestamp tie across pages without skipping or repeating", async () => {
		const rows = [
			{ t: 1, id: "a" },
			{ t: 2, id: "a" },
			{ t: 2, id: "b" },
			{ t: 2, id: "c" },
			{ t: 3, id: "a" },
		];
		const pages: number[] = [];
		const result = await fetchAllKeysetPages<
			(typeof rows)[number],
			{ t: number; id: string }
		>(
			async (after, limit) => {
				const page = rows
					.filter(
						(r) =>
							!after || r.t > after.t || (r.t === after.t && r.id > after.id),
					)
					.slice(0, limit);
				pages.push(page.length);
				return { data: page, error: null };
			},
			(row) => ({ t: row.t, id: row.id }),
			2,
		);

		expect(result).toEqual(rows);
		expect(pages).toEqual([2, 2, 1]);
	});
});
