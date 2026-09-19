import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import type JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_DATA_EXPORT_TABLES } from "../../../supabase/functions/_shared/userDataManifest.ts";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
	supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import {
	buildUserDataExport,
	cancelUserDataExport,
	ExportAlreadyRunningError,
	ExportCancelledError,
	type ExportCursor,
	type ExportPage,
	ExportRateLimitedError,
	ExportTransientError,
	exportAllUserData,
	getRunningUserDataExport,
	MAX_RATE_LIMIT_WAITS,
	MAX_TRANSIENT_ATTEMPTS,
	readRetryAfterSeconds,
	requestExportPage,
	transientBackoffSeconds,
} from "./data-export";

const PAGE = 1000;

/** Serves `rowsPerTable` rows per table in keyset pages of `pageSize`. */
function pagedEndpoint(rowsPerTable: number, pageSize = PAGE) {
	const calls: Array<{ table: string; cursor: ExportCursor | null }> = [];
	const requestPage = async (
		table: string,
		cursor: ExportCursor | null,
	): Promise<ExportPage> => {
		calls.push({ table, cursor });
		const start = cursor ? Number(cursor.id) + 1 : 0;
		const end = Math.min(start + pageSize, rowsPerTable);
		const rows = [];
		for (let i = start; i < end; i++) {
			rows.push(
				table === "storage_avatars"
					? { id: i, table, bucket: "avatars", path: `u1/${i}.png` }
					: { id: i, table },
			);
		}
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

function httpResponse(
	status: number,
	body: unknown,
	headers: HeadersInit = {},
) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function httpError(status: number, body: unknown, headers: HeadersInit = {}) {
	return new FunctionsHttpError(httpResponse(status, body, headers));
}

/** A cross-origin response whose Retry-After the browser hides (no CORS expose). */
function httpErrorWithHiddenHeaders(status: number, body: unknown) {
	const response = httpResponse(status, body, { "Retry-After": "9" });
	vi.spyOn(response.headers, "get").mockReturnValue(null);
	const clone = response.clone.bind(response);
	vi.spyOn(response, "clone").mockImplementation(() => {
		const copy = clone();
		vi.spyOn(copy.headers, "get").mockReturnValue(null);
		return copy;
	});
	return new FunctionsHttpError(response);
}

const noSleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {});

describe("buildUserDataExport", () => {
	beforeEach(() => {
		noSleep.mockClear();
	});
	afterEach(() => vi.restoreAllMocks());

	it("exports every row of every table when each has more than 1,000 rows", async () => {
		const rowsPerTable = 2 * PAGE + 1;
		const { requestPage, calls } = pagedEndpoint(rowsPerTable);
		const stringify = vi.spyOn(JSON, "stringify");

		const { zip, tables, unavailableTables, files } = await buildUserDataExport(
			{ requestPage, downloadFile: async () => new Blob(["img"]) },
		);
		expect(files).toHaveLength(rowsPerTable);

		// No serialization of a whole table (or the whole export) at once:
		// every JSON.stringify call gets one row or a small manifest object.
		expect(
			stringify.mock.calls.every(
				([value]) => !Array.isArray(value) || value.length <= PAGE,
			),
		).toBe(true);
		expect(
			stringify.mock.calls.filter(([value]) => Array.isArray(value)),
		).toEqual([]);
		stringify.mockRestore();

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
		const readme = await zip.file("README.txt")?.async("string");
		expect(readme).toContain("0 tables unavailable.");
		expect(readme).toContain(
			"rows with a non-null deleted_at are records you deleted",
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
				throw new Error("Export failed for rep_summaries: cursor is invalid");
			}
			return requestPage(table, cursor);
		};

		await expect(
			buildUserDataExport({
				requestPage: failing,
				sleep: noSleep,
				downloadFile: async () => new Blob(["img"]),
			}),
		).rejects.toThrow("Export failed for rep_summaries");
		expect(noSleep).not.toHaveBeenCalled();
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

	it("waits for the rate limit and resumes from the last cursor", async () => {
		const { requestPage, calls } = pagedEndpoint(PAGE + 1);
		let limited = false;
		const { zip } = await buildUserDataExport({
			tables: ["sets"],
			sleep: noSleep,
			requestPage: async (table, cursor) => {
				if (cursor && !limited) {
					limited = true;
					throw new ExportRateLimitedError("rate limited", 7);
				}
				return requestPage(table, cursor);
			},
		});

		expect(noSleep).toHaveBeenCalledWith(7000, undefined);
		expect(calls.map((c) => c.cursor)).toEqual([null, { id: 999 }]);
		expect(await readJson(zip, "data/sets.json")).toHaveLength(PAGE + 1);
	});

	it("fails (not 'paused') with a retry time after repeated 429s", async () => {
		const error = await buildUserDataExport({
			tables: ["sets"],
			sleep: noSleep,
			requestPage: async () => {
				throw new ExportRateLimitedError("rate limited", 1500);
			},
		}).then(
			() => new Error("expected a failure"),
			(e: Error) => e,
		);

		expect(error.message).toBe(
			"Export failed for sets: the server is rate-limiting exports; try again in about 25 minutes",
		);
		expect(error.message).not.toMatch(/paused/);
		expect(noSleep).toHaveBeenCalledTimes(MAX_RATE_LIMIT_WAITS - 1);
	});

	it("retries transient failures with capped exponential backoff on the same cursor", async () => {
		const { requestPage, calls } = pagedEndpoint(PAGE + 1);
		let failures = 0;
		const { zip } = await buildUserDataExport({
			tables: ["sets"],
			sleep: noSleep,
			requestPage: async (table, cursor) => {
				if (cursor && failures < MAX_TRANSIENT_ATTEMPTS - 1) {
					failures++;
					throw new ExportTransientError("HTTP 502");
				}
				return requestPage(table, cursor);
			},
		});

		expect(await readJson(zip, "data/sets.json")).toHaveLength(PAGE + 1);
		expect(noSleep.mock.calls.map(([ms]) => ms)).toEqual([
			2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000,
		]);
		expect(calls.map((c) => c.cursor)).toEqual([null, { id: 999 }]);
		expect(transientBackoffSeconds(3, 60)).toBe(60);
	});

	it("resets the transient budget after a good page", async () => {
		// Every page fails (budget - 1) times before succeeding: never exhausted.
		const { requestPage } = pagedEndpoint(3 * PAGE);
		const failuresByCursor = new Map<string, number>();
		const { zip } = await buildUserDataExport({
			tables: ["sets"],
			sleep: noSleep,
			requestPage: async (table, cursor) => {
				const key = JSON.stringify(cursor);
				const n = failuresByCursor.get(key) ?? 0;
				if (n < MAX_TRANSIENT_ATTEMPTS - 1) {
					failuresByCursor.set(key, n + 1);
					throw new ExportTransientError("network");
				}
				return requestPage(table, cursor);
			},
		});
		expect(await readJson(zip, "data/sets.json")).toHaveLength(3 * PAGE);
	});

	it("fails once the transient budget is exhausted", async () => {
		await expect(
			buildUserDataExport({
				tables: ["sets"],
				sleep: noSleep,
				requestPage: async () => {
					throw new ExportTransientError("HTTP 500");
				},
			}),
		).rejects.toThrow(
			`Export failed for sets after ${MAX_TRANSIENT_ATTEMPTS} attempts: HTTP 500`,
		);
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

	it("downloads the avatar objects into files/ and records missing ones", async () => {
		const downloadFile = vi.fn(async (_bucket: string, path: string) =>
			path.endsWith("gone.png") ? null : new Blob(["PNGDATA"]),
		);
		const { zip, files, missingFiles } = await buildUserDataExport({
			tables: ["storage_avatars"],
			downloadFile,
			requestPage: async (table) => ({
				table,
				rows: [
					{ bucket: "avatars", path: "u1/me.png", size: 7 },
					{ bucket: "avatars", path: "u1/gone.png", size: 1 },
				],
				nextCursor: null,
			}),
		});

		expect(downloadFile.mock.calls.map(([b, p]) => [b, p])).toEqual([
			["avatars", "u1/me.png"],
			["avatars", "u1/gone.png"],
		]);
		expect(await zip.file("files/avatars/me.png")?.async("string")).toBe(
			"PNGDATA",
		);
		expect(files).toEqual([
			{ bucket: "avatars", path: "u1/me.png", file: "files/avatars/me.png" },
		]);
		expect(missingFiles).toEqual([
			{ bucket: "avatars", path: "u1/gone.png", file: null },
		]);
		const manifest = (await readJson(zip, "export-manifest.json")) as {
			files: unknown[];
			missingFiles: unknown[];
		};
		expect(manifest.files).toHaveLength(1);
		expect(manifest.missingFiles).toHaveLength(1);
	});

	it("aborts when an avatar download fails or the reference is unsafe", async () => {
		const source = (path: string) => async (table: string) => ({
			table,
			rows: [{ bucket: "avatars", path }],
			nextCursor: null,
		});
		await expect(
			buildUserDataExport({
				tables: ["storage_avatars"],
				requestPage: source("u1/me.png"),
				downloadFile: async () => {
					throw new Error("Export failed for avatars/u1/me.png: boom");
				},
			}),
		).rejects.toThrow("boom");
		await expect(
			buildUserDataExport({
				tables: ["storage_avatars"],
				requestPage: source("u1/../u2/me.png"),
				downloadFile: async () => new Blob(["x"]),
			}),
		).rejects.toThrow("malformed file reference");
	});

	it("stops with ExportCancelledError when the signal aborts", async () => {
		const controller = new AbortController();
		const { requestPage } = pagedEndpoint(3 * PAGE);
		await expect(
			buildUserDataExport({
				tables: ["sets"],
				signal: controller.signal,
				requestPage: async (table, cursor) => {
					if (cursor) controller.abort();
					return requestPage(table, cursor);
				},
			}),
		).rejects.toBeInstanceOf(ExportCancelledError);
	});
});

describe("readRetryAfterSeconds", () => {
	it("prefers the JSON body, then the header (seconds or HTTP date), clamped to [0, 3600]", () => {
		expect(readRetryAfterSeconds({ retryAfterSeconds: 1800 }, "5")).toBe(1800);
		expect(readRetryAfterSeconds({ retryAfterSeconds: 99999 }, null)).toBe(
			3600,
		);
		expect(readRetryAfterSeconds(null, "42")).toBe(42);
		expect(readRetryAfterSeconds(null, null)).toBeUndefined();
		const future = new Date(Date.now() + 120_000).toUTCString();
		const inTwoMinutes = readRetryAfterSeconds(null, future) ?? -1;
		expect(inTwoMinutes).toBeGreaterThanOrEqual(118);
		expect(inTwoMinutes).toBeLessThanOrEqual(120);
		const farFuture = new Date(Date.now() + 86_400_000).toUTCString();
		expect(readRetryAfterSeconds(null, farFuture)).toBe(3600);
		const past = new Date(Date.now() - 60_000).toUTCString();
		expect(readRetryAfterSeconds(null, past)).toBe(0);
	});
});

describe("requestExportPage", () => {
	beforeEach(() => {
		invoke.mockReset();
	});
	afterEach(() => vi.restoreAllMocks());

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

	it("reads the 429 wait from the body when the browser hides Retry-After", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpErrorWithHiddenHeaders(429, {
				error: "rate_limit_exceeded",
				retryAfterSeconds: 1800,
			}),
		});
		const error = await requestExportPage("sets", null).catch((e) => e);
		expect(error).toBeInstanceOf(ExportRateLimitedError);
		expect(error.retryAfterSeconds).toBe(1800);

		// ...and the export then sleeps the full 1,800 s.
		const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {});
		let first = true;
		await buildUserDataExport({
			tables: ["sets"],
			sleep,
			requestPage: async (table, cursor) => {
				if (first) {
					first = false;
					return requestExportPage(table, cursor);
				}
				return { table, rows: [], nextCursor: null };
			},
		});
		expect(sleep).toHaveBeenCalledWith(1_800_000, undefined);
	});

	it.each([
		[
			"429 with a numeric header",
			429,
			{ "Retry-After": "42" },
			ExportRateLimitedError,
			42,
		],
		["429 with no wait anywhere", 429, {}, ExportRateLimitedError, 5],
		["503 with no header", 503, {}, ExportTransientError, undefined],
		["502 gateway", 502, {}, ExportTransientError, undefined],
		["500 query failure", 500, {}, ExportTransientError, undefined],
	])("%s", async (_name, status, headers, type, retryAfter) => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(status, { error: "x" }, headers),
		});
		const error = await requestExportPage("sets", null).catch((e) => e);
		expect(error).toBeInstanceOf(type);
		expect(error.retryAfterSeconds).toBe(retryAfter);
	});

	it("treats network and relay errors as transient", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: new FunctionsFetchError(new TypeError("Failed to fetch")),
		});
		await expect(requestExportPage("sets", null)).rejects.toBeInstanceOf(
			ExportTransientError,
		);
		invoke.mockImplementation(async () => {
			throw new TypeError("Failed to fetch");
		});
		const thrown = await requestExportPage("sets", null).catch((e) => e);
		expect(thrown).toBeInstanceOf(ExportTransientError);
	});

	it("fails without retry on a 4xx contract error, with the server's message", async () => {
		invoke.mockResolvedValue({
			data: null,
			error: httpError(400, { error: "cursor is invalid" }),
		});
		const error = await requestExportPage("sets", null).catch((e) => e);
		expect(error).not.toBeInstanceOf(ExportTransientError);
		expect(error).not.toBeInstanceOf(ExportRateLimitedError);
		expect(error.message).toBe("Export failed for sets: cursor is invalid");
	});

	it("rejects a malformed response", async () => {
		invoke.mockResolvedValue({ data: { rows: "nope" }, error: null });
		await expect(requestExportPage("sets", null)).rejects.toThrow(
			"malformed response",
		);
	});

	it("finishes a ~700-page telemetry export through a 600/hour fixed window", async () => {
		const PAGES = 700;
		const ROWS_PER_PAGE = 10;
		const WINDOW_MS = 3_600_000;
		let clock = 0;
		let windowStart = 0;
		let used = 0;
		invoke.mockImplementation(
			async (
				_name: string,
				{ body }: { body: { table: string; cursor?: { id: number } } },
			) => {
				if (clock - windowStart >= WINDOW_MS) {
					windowStart = clock;
					used = 0;
				}
				if (used >= 600) {
					return {
						data: null,
						error: httpErrorWithHiddenHeaders(429, {
							error: "rate_limit_exceeded",
							retryAfterSeconds: Math.ceil(
								(windowStart + WINDOW_MS - clock) / 1000,
							),
						}),
					};
				}
				used++;
				clock += 1000; // each page takes a second
				const page = body.cursor ? body.cursor.id + 1 : 0;
				return {
					data: {
						table: body.table,
						rows: Array.from({ length: ROWS_PER_PAGE }, (_, i) => ({
							id: page * ROWS_PER_PAGE + i,
						})),
						nextCursor: page + 1 < PAGES ? { id: page } : null,
					},
					error: null,
				};
			},
		);
		const sleep = vi.fn(async (ms: number) => {
			clock += ms;
		});

		const { zip, tables } = await buildUserDataExport({
			tables: ["rep_telemetry"],
			requestPage: requestExportPage,
			sleep,
		});

		expect(tables[0].rows).toBe(PAGES * ROWS_PER_PAGE);
		const { files, rows } = await readNdjson(zip, "rep_telemetry");
		expect(files).toHaveLength(PAGES);
		expect(new Set(rows.map((r) => (r as { id: number }).id)).size).toBe(
			PAGES * ROWS_PER_PAGE,
		);
		// One wait for the rest of the first window (3600 s - 600 s used).
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3_000_000]);
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
							error: httpError(400, { error: "cursor is invalid" }),
						}
					: {
							data: { table: body.table, rows: [], nextCursor: null },
							error: null,
						},
		);

		await expect(exportAllUserData("user-1")).rejects.toThrow(
			"Data export failed: Export failed for workout_sessions: cursor is invalid",
		);
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(getRunningUserDataExport()).toBeNull();
	});

	it("allows one export at a time and can be cancelled", async () => {
		const createObjectURL = vi.fn(() => "blob:x");
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURL,
		});
		// The endpoint never answers until the request is aborted.
		invoke.mockImplementation(
			(_name: string, { signal }: { signal: AbortSignal }) =>
				new Promise((_, reject) => {
					signal.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const progress = vi.fn();

		const first = exportAllUserData("user-1");
		await expect(exportAllUserData("user-1")).rejects.toBeInstanceOf(
			ExportAlreadyRunningError,
		);
		const running = getRunningUserDataExport();
		expect(running).not.toBeNull();
		running?.subscribe(progress);
		expect(progress).toHaveBeenCalledWith(
			expect.stringContaining("Exporting"),
			1,
			USER_DATA_EXPORT_TABLES.length + 2,
		);

		expect(cancelUserDataExport()).toBe(true);
		await expect(first).rejects.toBeInstanceOf(ExportCancelledError);
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(getRunningUserDataExport()).toBeNull();
		expect(cancelUserDataExport()).toBe(false);
	});
});
