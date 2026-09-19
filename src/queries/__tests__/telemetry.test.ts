import { beforeEach, describe, expect, it, vi } from "vitest";

// --- In-memory PostgREST fake ---------------------------------------------
// A stateful query builder over seeded tables. It applies eq/or/order/limit/
// range the way PostgREST does and, like hosted Supabase, silently caps every
// response at MAX_ROWS. An unpaged select therefore returns only the first
// 1,000 rows, which is exactly the truncation these tests guard against.

const MAX_ROWS = 1000;
type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const requests: Array<{ table: string; returned: number }> = [];

const KEYSET_OR =
	/^timestamp_ms\.gt\.(\d+),and\(timestamp_ms\.eq\.(\d+),id\.gt\.(.+)\)$/;

function compare(a: unknown, b: unknown): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function queryBuilder(table: string) {
	const filters: Array<(row: Row) => boolean> = [];
	const orders: Array<{ column: string; ascending: boolean }> = [];
	let limit: number | null = null;
	let range: [number, number] | null = null;

	const run = () => {
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
		rows = rows.slice(0, MAX_ROWS);
		requests.push({ table, returned: rows.length });
		return { data: rows, error: null };
	};

	const builder = {
		select: () => builder,
		eq: (column: string, value: unknown) => {
			filters.push((row) => row[column] === value);
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

/** Deterministic, non-monotonic UUID so id order differs from insert order. */
function uuidFor(n: number): string {
	const scrambled = ((n * 2654435761) >>> 0).toString(16).padStart(8, "0");
	const tail = n.toString(16).padStart(12, "0");
	return `${scrambled}-0000-4000-8000-${tail}`;
}

/**
 * 2,500 rows = 1,250 timestamps x cables A/B, like real 50 Hz dual-cable
 * capture. Every timestamp is shared by two rows, so the page boundaries at
 * 1,000 and 2,000 fall inside timestamp ties and only the id tiebreaker keeps
 * paging from skipping or repeating a sample. Inserted in shuffled order.
 */
function seedTelemetry(): Row[] {
	const rows: Row[] = [];
	for (let i = 0; i < SAMPLES; i++) {
		const sample = Math.floor(i / 2);
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

function expectedOrder(rows: Row[]) {
	return rows
		.filter((row) => row.set_id === SET_ID)
		.sort(
			(a, b) => compare(a.timestamp_ms, b.timestamp_ms) || compare(a.id, b.id),
		)
		.map((row) => ({
			timestamp_ms: row.timestamp_ms,
			force_n: row.force_n,
			velocity_mps: row.velocity_mps,
			position_mm: row.position_mm,
			cable: row.cable,
		}));
}

beforeEach(() => {
	requests.length = 0;
	const telemetry = seedTelemetry();
	tables.rep_telemetry = telemetry;
	tables.telemetry_points = telemetry; // view over rep_telemetry
	tables.rep_summaries = [];
});

describe("repTelemetryOptions", () => {
	it("returns all 2,500 samples of a set in (timestamp_ms, id) order despite the 1,000-row cap", async () => {
		const { repTelemetryOptions } = await import("../telemetry");
		const result = await repTelemetryOptions(SET_ID).queryFn?.({} as never);

		expect(result).toHaveLength(SAMPLES);
		expect(result).toEqual(expectedOrder(tables.rep_telemetry));
		// Paged: three reads (1000 + 1000 + 500), none above the cap.
		expect(requests.map((r) => r.returned)).toEqual([1000, 1000, 500]);
	});

	it("stops after one read when the set fits in a single short page", async () => {
		tables.rep_telemetry = tables.rep_telemetry.filter(
			(row) => row.set_id === OTHER_SET_ID,
		);
		const { repTelemetryOptions } = await import("../telemetry");
		const result = await repTelemetryOptions(OTHER_SET_ID).queryFn?.(
			{} as never,
		);

		expect(result).toHaveLength(50);
		expect(requests).toHaveLength(1);
	});
});

describe("replayTelemetryOptions", () => {
	it("returns all 2,500 samples with chart columns only, plus rep summaries", async () => {
		tables.rep_summaries = [
			{ id: "s2", set_id: SET_ID, rep_number: 2 },
			{ id: "s1", set_id: SET_ID, rep_number: 1 },
		];
		const { replayTelemetryOptions } = await import("../replay");
		const result = await replayTelemetryOptions(SET_ID).queryFn?.({} as never);

		expect(result?.telemetry).toHaveLength(SAMPLES);
		expect(result?.telemetry).toEqual(expectedOrder(tables.telemetry_points));
		expect(Object.keys(result?.telemetry[0] ?? {}).sort()).toEqual([
			"cable",
			"force_n",
			"position_mm",
			"timestamp_ms",
			"velocity_mps",
		]);
		expect(
			result?.repSummaries.map((s: { rep_number: number }) => s.rep_number),
		).toEqual([1, 2]);
	});
});
