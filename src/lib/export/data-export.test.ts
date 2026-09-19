import { FunctionsHttpError } from "@supabase/supabase-js";
import type JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_DATA_EXPORT_TABLES } from "../../../supabase/functions/_shared/userDataManifest.ts";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
	supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import {
	buildUserDataExport,
	type ExportCursor,
	type ExportPage,
	ExportRetryableError,
	exportAllUserData,
	requestExportPage,
} from "./data-export";

const PAGE = 1000;

/** Serves `rowsPerTable` rows per table in 1000-row keyset pages. */
function pagedEndpoint(rowsPerTable: number) {
	const calls: Array<{ table: string; cursor: ExportCursor | null }> = [];
	const requestPage = async (
		table: string,
		cursor: ExportCursor | null,
	): Promise<ExportPage> => {
		calls.push({ table, cursor });
		const start = cursor ? Number(cursor.id) + 1 : 0;
		const end = Math.min(start + PAGE, rowsPerTable);
		const rows = [];
		for (let i = start; i < end; i++) rows.push({ id: i, table });
		return {
			table,
			rows,
			nextCursor: end < rowsPerTable ? { id: end - 1 } : null,
		};
	};
	return { requestPage, calls };
}

async function readJson(zip: JSZip, path: string): Promise<unknown> {
	const file = zip.file(path);
	if (!file) throw new Error(`missing ${path}`);
	return JSON.parse(await file.async("string"));
}

async function readNdjson(zip: JSZip, table: string) {
	const files = zip.file(new RegExp(`^data/${table}/part-\\d+\\.ndjson$`));
	const rows: unknown[] = [];
	for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
		const text = await file.async("string");
		for (const line of text.split("\n")) if (line) rows.push(JSON.parse(line));
	}
	return { files, rows };
}

function httpError(status: number, body: unknown, headers: HeadersInit = {}) {
	return new FunctionsHttpError(
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json", ...headers },
		}),
	);
}

describe("buildUserDataExport", () => {
	it("exports every row of every table when each has more than 1,000 rows", async () => {
		const rowsPerTable = 2 * PAGE + 1;
		const { requestPage, calls } = pagedEndpoint(rowsPerTable);

		const { zip, tables, unavailableTables } = await buildUserDataExport({
			requestPage,
		});

		expect(unavailableTables).toEqual([]);
		expect(tables.map((t) => t.table)).toEqual([...USER_DATA_EXPORT_TABLES]);
		for (const table of USER_DATA_EXPORT_TABLES) {
			const rows =
				table === "rep_telemetry"
					? (await readNdjson(zip, table)).rows
					: ((await readJson(zip, `data/${table}.json`)) as unknown[]);
			expect(rows, table).toHaveLength(rowsPerTable);
			expect(new Set(rows.map((row) => (row as { id: number }).id)).size).toBe(
				rowsPerTable,
			);
			// Three pages per table, each resuming from the previous cursor.
			expect(
				calls.filter((c) => c.table === table).map((c) => c.cursor),
			).toEqual([null, { id: 999 }, { id: 1999 }]);
		}
		// Telemetry is written as one NDJSON part per page.
		expect((await readNdjson(zip, "rep_telemetry")).files).toHaveLength(3);

		const manifest = (await readJson(zip, "export-manifest.json")) as {
			tables: Array<{ table: string; rows: number }>;
		};
		expect(manifest.tables.every((t) => t.rows === rowsPerTable)).toBe(true);
		expect(await zip.file("README.txt")?.async("string")).toContain(
			"0 tables unavailable.",
		);
	});

	it("writes an empty array for a table with no rows", async () => {
		const { requestPage } = pagedEndpoint(0);
		const { zip } = await buildUserDataExport({
			requestPage,
			tables: ["workout_sessions"],
		});
		expect(await readJson(zip, "data/workout_sessions.json")).toEqual([]);
	});

	it("aborts the whole export when a page fails", async () => {
		const { requestPage } = pagedEndpoint(PAGE + 1);
		const failing = async (table: string, cursor: ExportCursor | null) => {
			if (table === "rep_summaries" && cursor) {
				throw new Error("Export failed for rep_summaries: Export query failed");
			}
			return requestPage(table, cursor);
		};

		await expect(buildUserDataExport({ requestPage: failing })).rejects.toThrow(
			"Export failed for rep_summaries",
		);
	});

	it("lists unavailable tables instead of dropping them silently", async () => {
		const { requestPage } = pagedEndpoint(1);
		const { zip, unavailableTables } = await buildUserDataExport({
			tables: ["workout_sessions", "goal_snapshots", "sync_tombstones"],
			requestPage: async (table, cursor) =>
				table === "workout_sessions"
					? requestPage(table, cursor)
					: { table, rows: [], nextCursor: null, tableMissing: true },
		});

		expect(unavailableTables).toEqual(["goal_snapshots", "sync_tombstones"]);
		expect(zip.file("data/goal_snapshots.json")).toBeNull();
		expect(await zip.file("README.txt")?.async("string")).toContain(
			"2 tables unavailable: goal_snapshots, sync_tombstones",
		);
		const manifest = (await readJson(zip, "export-manifest.json")) as {
			unavailableTables: string[];
		};
		expect(manifest.unavailableTables).toEqual([
			"goal_snapshots",
			"sync_tombstones",
		]);
	});

	it("waits for Retry-After and resumes from the last cursor", async () => {
		const { requestPage, calls } = pagedEndpoint(PAGE + 1);
		let limited = false;
		const sleep = vi.fn(async () => {});
		const { zip } = await buildUserDataExport({
			tables: ["sets"],
			sleep,
			requestPage: async (table, cursor) => {
				if (cursor && !limited) {
					limited = true;
					throw new ExportRetryableError("rate limited", 7);
				}
				return requestPage(table, cursor);
			},
		});

		expect(sleep).toHaveBeenCalledWith(7000);
		expect(calls.map((c) => c.cursor)).toEqual([null, { id: 999 }]);
		expect(await readJson(zip, "data/sets.json")).toHaveLength(PAGE + 1);
	});

	it("gives up after repeated 429s", async () => {
		const sleep = vi.fn(async () => {});
		await expect(
			buildUserDataExport({
				tables: ["sets"],
				sleep,
				requestPage: async () => {
					throw new ExportRetryableError("rate limited", 1);
				},
			}),
		).rejects.toThrow("rate limited");
		expect(sleep).toHaveBeenCalledTimes(5);
	});

	it("fails when the server does not advance the cursor", async () => {
		await expect(
			buildUserDataExport({
				tables: ["sets"],
				requestPage: async (table) => ({
					table,
					rows: [{ id: 1 }],
					nextCursor: { id: 1 },
				}),
			}),
		).rejects.toThrow("did not advance");
	});
});

describe("requestExportPage", () => {
	beforeEach(() => invoke.mockReset());

	it("posts table and cursor to export-user-data", async () => {
		invoke.mockResolvedValue({
			data: { table: "sets", rows: [{ id: "a" }], nextCursor: null },
			error: null,
		});
		await expect(requestExportPage("sets", { id: "z" })).resolves.toEqual({
			table: "sets",
			rows: [{ id: "a" }],
			nextCursor: null,
			tableMissing: false,
		});
		expect(invoke).toHaveBeenCalledWith("export-user-data", {
			body: { table: "sets", cursor: { id: "z" } },
		});
	});

	it("turns a 429 into a retryable error carrying Retry-After", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(
				429,
				{ error: "Too many requests" },
				{ "Retry-After": "42" },
			),
		});
		const error = await requestExportPage("sets", null).catch((e) => e);
		expect(error).toBeInstanceOf(ExportRetryableError);
		expect(error.retryAfterSeconds).toBe(42);
	});

	it("fails on any other HTTP error with the server's message", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(500, { error: "Export query failed" }),
		});
		await expect(requestExportPage("sets", null)).rejects.toThrow(
			"Export failed for sets: Export query failed",
		);
	});

	it("rejects a malformed response", async () => {
		invoke.mockResolvedValue({ data: { rows: "nope" }, error: null });
		await expect(requestExportPage("sets", null)).rejects.toThrow(
			"malformed response",
		);
	});
});

describe("exportAllUserData", () => {
	beforeEach(() => {
		invoke.mockReset();
		vi.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	it("downloads nothing and throws a visible error when a page fails", async () => {
		const createObjectURL = vi.fn(() => "blob:x");
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		invoke.mockImplementation(
			async (_name: string, { body }: { body: { table: string } }) =>
				body.table === "workout_sessions"
					? {
							data: null,
							error: httpError(500, { error: "Export query failed" }),
						}
					: {
							data: { table: body.table, rows: [], nextCursor: null },
							error: null,
						},
		);

		await expect(exportAllUserData("user-1")).rejects.toThrow(
			"Data export failed: Export failed for workout_sessions: Export query failed",
		);
		expect(createObjectURL).not.toHaveBeenCalled();
	});
});
