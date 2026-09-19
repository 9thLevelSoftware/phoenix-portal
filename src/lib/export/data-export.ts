import { FunctionsHttpError } from "@supabase/supabase-js";
import JSZip from "jszip";
import { supabase } from "@/lib/supabase";
// Deploy order: any change to USER_DATA_MANIFEST ships the Edge Function
// first and the SPA second, or the SPA requests a table the deployed
// endpoint rejects and every export fails (PR 37 R-15).
import { USER_DATA_EXPORT_TABLES } from "../../../supabase/functions/_shared/userDataManifest.ts";

type ProgressCallback = (step: string, current: number, total: number) => void;

export { exportAnalyticsTablesZip } from "./analytics-tables";

export const EXPORT_FUNCTION_NAME = "export-user-data";

/** Tables written as NDJSON, one zip entry per endpoint page. */
const NDJSON_TABLES: ReadonlySet<string> = new Set(["rep_telemetry"]);
const AVATAR_SOURCE = "storage_avatars";

/** 429 waits allowed per page (the budget resets after each good page). */
export const MAX_RATE_LIMIT_WAITS = 6;
/** Attempts per page for network errors and 5xx (resets after each good page). */
export const MAX_TRANSIENT_ATTEMPTS = 10;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_RETRY_AFTER_SECONDS = 3600;
const TRANSIENT_BACKOFF_BASE_SECONDS = 2;
const TRANSIENT_BACKOFF_MAX_SECONDS = 300;

export type ExportCursor = Record<string, string | number>;
type Row = Record<string, unknown>;

export interface ExportPage {
	table: string;
	rows: Row[];
	nextCursor: ExportCursor | null;
	tableMissing?: boolean;
}

/** HTTP 429: wait `retryAfterSeconds`, then request the same page again. */
export class ExportRateLimitedError extends Error {
	constructor(
		message: string,
		readonly retryAfterSeconds: number,
	) {
		super(message);
		this.name = "ExportRateLimitedError";
	}
}

/** Network, relay or 5xx failure: retried with exponential backoff. */
export class ExportTransientError extends Error {
	constructor(
		message: string,
		readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "ExportTransientError";
	}
}

export class ExportCancelledError extends Error {
	constructor() {
		super("Export cancelled");
		this.name = "ExportCancelledError";
	}
}

export class ExportAlreadyRunningError extends Error {
	constructor() {
		super("A data export is already running");
		this.name = "ExportAlreadyRunningError";
	}
}

export type ExportPageRequester = (
	table: string,
	cursor: ExportCursor | null,
	signal?: AbortSignal,
) => Promise<ExportPage>;

/** `null` when the object does not exist; throws on any other failure. */
export type ExportFileDownloader = (
	bucket: string,
	path: string,
	signal?: AbortSignal,
) => Promise<Blob | null>;

export interface BuildUserDataExportOptions {
	requestPage: ExportPageRequester;
	downloadFile?: ExportFileDownloader;
	onProgress?: ProgressCallback;
	/** Injected for tests; defaults to a real, abortable timer. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	signal?: AbortSignal;
	/** Defaults to the manifest order (non-table sources first). */
	tables?: readonly string[];
	now?: () => Date;
}

export interface ExportTableSummary {
	table: string;
	rows: number;
	files: string[];
}

export interface ExportedFile {
	bucket: string;
	path: string;
	file: string | null;
}

export interface UserDataExportResult {
	zip: JSZip;
	tables: ExportTableSummary[];
	unavailableTables: string[];
	files: ExportedFile[];
	missingFiles: ExportedFile[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampRetryAfter(seconds: number): number {
	return Math.min(Math.max(Math.ceil(seconds), 0), MAX_RETRY_AFTER_SECONDS);
}

/**
 * The wait the server asked for. The JSON body's `retryAfterSeconds` comes
 * first: `Retry-After` is not a CORS-safelisted header, so a browser can only
 * read it when the function exposes it.
 */
export function readRetryAfterSeconds(
	body: unknown,
	header: string | null,
): number | undefined {
	if (
		isPlainObject(body) &&
		typeof body.retryAfterSeconds === "number" &&
		Number.isFinite(body.retryAfterSeconds)
	) {
		return clampRetryAfter(body.retryAfterSeconds);
	}
	if (!header) return undefined;
	const seconds = Number(header);
	if (header.trim() !== "" && Number.isFinite(seconds)) {
		return clampRetryAfter(seconds);
	}
	const date = Date.parse(header);
	if (!Number.isNaN(date)) return clampRetryAfter((date - Date.now()) / 1000);
	return undefined;
}

/** Checks the endpoint's response shape; anything unexpected fails the export. */
export function parseExportPage(table: string, body: unknown): ExportPage {
	if (!isPlainObject(body) || !Array.isArray(body.rows)) {
		throw new Error(`Export failed for ${table}: malformed response`);
	}
	if (body.table !== table) {
		throw new Error(
			`Export failed for ${table}: response was for another table`,
		);
	}
	const { nextCursor } = body;
	if (nextCursor !== null && !isPlainObject(nextCursor)) {
		throw new Error(`Export failed for ${table}: malformed cursor`);
	}
	if (!body.rows.every(isPlainObject)) {
		throw new Error(`Export failed for ${table}: malformed rows`);
	}
	return {
		table,
		rows: body.rows as Row[],
		nextCursor: nextCursor as ExportCursor | null,
		tableMissing: body.tableMissing === true,
	};
}

async function readJsonBody(response: Response): Promise<unknown> {
	try {
		return (await response.clone().json()) as unknown;
	} catch {
		return null;
	}
}

/** Requests one page from the export-user-data Edge Function. */
export const requestExportPage: ExportPageRequester = async (
	table,
	cursor,
	signal,
) => {
	let result: { data: unknown; error: unknown };
	try {
		result = await supabase.functions.invoke(EXPORT_FUNCTION_NAME, {
			body: cursor ? { table, cursor } : { table },
			...(signal ? { signal } : {}),
		});
	} catch (error) {
		if (signal?.aborted) throw new ExportCancelledError();
		throw new ExportTransientError(
			`Export of ${table} could not reach the server (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	const { data, error } = result;
	if (error) {
		if (signal?.aborted) throw new ExportCancelledError();
		if (error instanceof FunctionsHttpError) {
			const response = error.context as Response;
			const body = await readJsonBody(response);
			const message =
				isPlainObject(body) && typeof body.error === "string"
					? body.error
					: `HTTP ${response.status}`;
			const retryAfter = readRetryAfterSeconds(
				body,
				response.headers.get("Retry-After"),
			);
			if (response.status === 429) {
				throw new ExportRateLimitedError(
					`Export of ${table} rate-limited (${message})`,
					retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS,
				);
			}
			if (response.status >= 500) {
				throw new ExportTransientError(
					`Export of ${table} hit a server error (${message})`,
					retryAfter,
				);
			}
			throw new Error(`Export failed for ${table}: ${message}`);
		}
		// FunctionsFetchError / FunctionsRelayError: network or gateway.
		throw new ExportTransientError(
			`Export of ${table} could not reach the server (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	return parseExportPage(table, data);
};

function isMissingObjectError(error: unknown): boolean {
	if (!isPlainObject(error) && !(error instanceof Error)) return false;
	const e = error as {
		status?: unknown;
		statusCode?: unknown;
		message?: unknown;
	};
	return (
		e.status === 404 ||
		e.statusCode === "404" ||
		e.statusCode === 404 ||
		(typeof e.message === "string" && /not[\s_-]?found/i.test(e.message))
	);
}

/** Downloads the user's own Storage object (RLS scopes it to their folder). */
export const downloadStorageObject: ExportFileDownloader = async (
	bucket,
	path,
) => {
	const { data, error } = await supabase.storage.from(bucket).download(path);
	if (error) {
		if (isMissingObjectError(error)) return null;
		throw new Error(
			`Export failed for ${bucket}/${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return data;
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new ExportCancelledError());
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			reject(new ExportCancelledError());
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new ExportCancelledError();
}

function sameCursor(a: ExportCursor | null, b: ExportCursor | null): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function pageFileName(table: string, page: number): string {
	return `data/${table}/part-${String(page).padStart(5, "0")}.ndjson`;
}

function minutes(seconds: number): number {
	return Math.max(1, Math.ceil(seconds / 60));
}

/** Seconds before transient attempt `attempt + 1` (2, 4, 8, ... capped at 300). */
export function transientBackoffSeconds(
	attempt: number,
	serverHint?: number,
): number {
	const backoff = Math.min(
		TRANSIENT_BACKOFF_BASE_SECONDS * 2 ** (attempt - 1),
		TRANSIENT_BACKOFF_MAX_SECONDS,
	);
	return Math.max(backoff, serverHint ?? 0);
}

/**
 * Requests one page, waiting out 429s (the server's Retry-After) and
 * retrying transient failures with exponential backoff. The two budgets are
 * separate and local to this page, so they reset after every good page.
 */
async function requestPageWithRetry(
	table: string,
	cursor: ExportCursor | null,
	options: {
		requestPage: ExportPageRequester;
		sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
		signal?: AbortSignal;
		onWait: (message: string) => void;
	},
): Promise<ExportPage> {
	const { requestPage, sleep, signal, onWait } = options;
	let rateLimitWaits = 0;
	let transientAttempts = 0;
	for (;;) {
		throwIfAborted(signal);
		let waitSeconds: number;
		try {
			return await requestPage(table, cursor, signal);
		} catch (error) {
			if (error instanceof ExportRateLimitedError) {
				rateLimitWaits++;
				if (rateLimitWaits >= MAX_RATE_LIMIT_WAITS) {
					throw new Error(
						`Export failed for ${table}: the server is rate-limiting exports; try again in about ${minutes(error.retryAfterSeconds)} minutes`,
					);
				}
				waitSeconds = error.retryAfterSeconds;
				onWait(
					`Export rate limit reached; resuming ${table} in about ${minutes(waitSeconds)} min...`,
				);
			} else if (error instanceof ExportTransientError) {
				transientAttempts++;
				if (transientAttempts >= MAX_TRANSIENT_ATTEMPTS) {
					throw new Error(
						`Export failed for ${table} after ${transientAttempts} attempts: ${error.message}`,
					);
				}
				waitSeconds = transientBackoffSeconds(
					transientAttempts,
					error.retryAfterSeconds,
				);
				onWait(
					`Connection problem exporting ${table}; retrying in ${waitSeconds}s...`,
				);
			} else {
				throw error;
			}
		}
		await sleep(waitSeconds * 1000, signal);
	}
}

function readmeText(
	result: Omit<UserDataExportResult, "zip">,
	exportedAt: string,
): string {
	const { tables, unavailableTables, files, missingFiles } = result;
	const lines = [
		"Phoenix Portal data export",
		`Exported at: ${exportedAt}`,
		"",
		"Each table is in data/<table>.json (a JSON array of rows).",
		"Rep telemetry is in data/rep_telemetry/part-NNNNN.ndjson (one JSON row per line, one part per 1,000-row page).",
		"Uploaded files (your avatar) are in files/<bucket>/.",
		"export-manifest.json lists every table, its row count and its files.",
		"",
		"personal_records: rows with a non-null deleted_at are records you deleted in the app.",
		"They are still stored (as tombstones, so your other devices learn of the deletion) and",
		"are included here because this export is a copy of all data held about you.",
		"",
		"Billing: provider customer/subscription ids in profiles, subscriptions and",
		"subscription_events are your own billing identifiers, not credentials.",
		"",
		"Size: the export is assembled in your browser's memory. Exports of more than",
		"roughly 1 GB of raw data (several million telemetry rows) may exceed what a",
		"browser tab can hold; contact support if your export does not complete.",
		"",
	];
	if (unavailableTables.length > 0) {
		lines.push(
			`${unavailableTables.length} tables unavailable: ${unavailableTables.join(", ")}`,
			"These tables do not exist in this deployment, so they hold no data for you.",
		);
	} else {
		lines.push("0 tables unavailable.");
	}
	lines.push(`Files exported: ${files.length}`);
	if (missingFiles.length > 0) {
		lines.push(
			`${missingFiles.length} referenced files no longer exist in storage: ${missingFiles.map((f) => `${f.bucket}/${f.path}`).join(", ")}`,
		);
	}
	lines.push("", "Rows per table:");
	for (const summary of tables) {
		lines.push(`  ${summary.table}: ${summary.rows}`);
	}
	return `${lines.join("\n")}\n`;
}

function avatarRef(row: Row): { bucket: string; path: string } {
	const { bucket, path } = row;
	if (
		typeof bucket !== "string" ||
		typeof path !== "string" ||
		bucket === "" ||
		path === "" ||
		path.split("/").some((part) => part === "" || part === "." || part === "..")
	) {
		throw new Error(
			`Export failed for ${AVATAR_SOURCE}: malformed file reference`,
		);
	}
	return { bucket, path };
}

/**
 * Builds the GDPR export zip from the paged export-user-data endpoint.
 *
 * Every manifest table and non-table source is requested page by page until
 * `nextCursor` is null. Each page is serialized on its own and appended to
 * its table's entry as it arrives (rep_telemetry as NDJSON parts, one per
 * page), so the export is never held as one JSON string. The avatar objects
 * listed by storage_avatars are downloaded into files/. 429s and transient
 * failures are retried on the same cursor; anything else aborts the whole
 * export, so a partial zip is never produced.
 */
export async function buildUserDataExport(
	options: BuildUserDataExportOptions,
): Promise<UserDataExportResult> {
	const {
		requestPage,
		downloadFile = downloadStorageObject,
		onProgress,
		sleep = defaultSleep,
		signal,
		tables = USER_DATA_EXPORT_TABLES,
		now = () => new Date(),
	} = options;
	const zip = new JSZip();
	const summaries: ExportTableSummary[] = [];
	const unavailableTables: string[] = [];
	const files: ExportedFile[] = [];
	const missingFiles: ExportedFile[] = [];
	const totalSteps = tables.length + 2;

	for (const [index, table] of tables.entries()) {
		const step = index + 1;
		onProgress?.(`Exporting ${table}...`, step, totalSteps);
		const ndjson = NDJSON_TABLES.has(table);
		const jsonParts: string[] = [];
		const tableFiles: string[] = [];
		const avatarRows: Row[] = [];
		let rowCount = 0;
		let pageNumber = 0;
		let cursor: ExportCursor | null = null;
		let missing = false;

		for (;;) {
			const page = await requestPageWithRetry(table, cursor, {
				requestPage,
				sleep,
				signal,
				onWait: (message) => onProgress?.(message, step, totalSteps),
			});

			pageNumber++;
			if (page.tableMissing) {
				missing = true;
				break;
			}
			if (page.rows.length > 0) {
				if (ndjson) {
					const file = pageFileName(table, pageNumber);
					zip.file(
						file,
						`${page.rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
					);
					tableFiles.push(file);
				} else {
					jsonParts.push(
						page.rows.map((row) => JSON.stringify(row)).join(",\n"),
					);
				}
				if (table === AVATAR_SOURCE) avatarRows.push(...page.rows);
				rowCount += page.rows.length;
			}
			if (page.nextCursor === null) break;
			if (page.rows.length === 0 || sameCursor(page.nextCursor, cursor)) {
				throw new Error(
					`Export failed for ${table}: the server did not advance the page cursor`,
				);
			}
			cursor = page.nextCursor;
			onProgress?.(
				`Exporting ${table} (${rowCount} rows)...`,
				step,
				totalSteps,
			);
		}

		if (missing) {
			unavailableTables.push(table);
			continue;
		}
		if (!ndjson) {
			const file = `data/${table}.json`;
			// A Blob keeps the per-page strings as separate parts instead of
			// concatenating them into one JS string.
			zip.file(
				file,
				new Blob([
					"[\n",
					...jsonParts.flatMap((part, i) => (i === 0 ? [part] : [",\n", part])),
					"\n]\n",
				]),
			);
			tableFiles.push(file);
		}
		summaries.push({ table, rows: rowCount, files: tableFiles });

		for (const row of avatarRows) {
			throwIfAborted(signal);
			const { bucket, path } = avatarRef(row);
			onProgress?.(`Downloading ${bucket}/${path}...`, step, totalSteps);
			const blob = await downloadFile(bucket, path, signal);
			if (blob === null) {
				missingFiles.push({ bucket, path, file: null });
				continue;
			}
			// Paths are `{uid}/{name}`; keep the name under the bucket.
			const file = `files/${bucket}/${path.split("/").slice(1).join("/") || path}`;
			zip.file(file, blob);
			files.push({ bucket, path, file });
		}
	}

	const exportedAt = now().toISOString();
	const result = { tables: summaries, unavailableTables, files, missingFiles };
	zip.file(
		"export-manifest.json",
		JSON.stringify({ exportedAt, ...result }, null, 2),
	);
	zip.file("README.txt", readmeText(result, exportedAt));

	return { zip, ...result };
}

interface RunningExport {
	controller: AbortController;
	promise: Promise<void>;
	listeners: Set<ProgressCallback>;
	last?: [string, number, number];
}

let running: RunningExport | null = null;

export interface RunningUserDataExport {
	promise: Promise<void>;
	cancel(): void;
	/** Receives progress (the latest immediately); returns an unsubscribe. */
	subscribe(listener: ProgressCallback): () => void;
}

/** The export in progress in this tab, if any (survives a remount). */
export function getRunningUserDataExport(): RunningUserDataExport | null {
	const current = running;
	if (!current) return null;
	return {
		promise: current.promise,
		cancel: () => current.controller.abort(),
		subscribe(listener) {
			current.listeners.add(listener);
			if (current.last) listener(...current.last);
			return () => current.listeners.delete(listener);
		},
	};
}

/** Cancels the running export; returns false when none is running. */
export function cancelUserDataExport(): boolean {
	if (!running) return false;
	running.controller.abort();
	return true;
}

/**
 * Export all user-owned data as a downloadable ZIP (GDPR Articles 15/20).
 *
 * The data comes from the export-user-data Edge Function, which scopes every
 * table to the signed-in user and pages it with a keyset cursor, so no table
 * is truncated. Credentials (OAuth tokens, API keys) are never exported.
 * Only one export runs per tab at a time. Any failure or cancellation throws
 * before a file is downloaded.
 */
export function exportAllUserData(
	_userId: string,
	onProgress?: ProgressCallback,
): Promise<void> {
	if (running) return Promise.reject(new ExportAlreadyRunningError());
	const controller = new AbortController();
	const listeners = new Set<ProgressCallback>();
	if (onProgress) listeners.add(onProgress);
	const state: RunningExport = {
		controller,
		listeners,
		promise: Promise.resolve(),
	};
	const report: ProgressCallback = (step, current, total) => {
		state.last = [step, current, total];
		for (const listener of listeners) listener(step, current, total);
	};

	running = state;
	state.promise = (async () => {
		try {
			const { zip } = await buildUserDataExport({
				requestPage: requestExportPage,
				onProgress: report,
				signal: controller.signal,
			});
			const total = USER_DATA_EXPORT_TABLES.length + 2;
			report("Compressing export...", total - 1, total);
			const blob = await zip.generateAsync({
				type: "blob",
				compression: "DEFLATE",
				compressionOptions: { level: 6 },
				streamFiles: true,
			});
			throwIfAborted(controller.signal);
			report("Starting download...", total, total);

			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `phoenix-data-export-${new Date().toISOString().split("T")[0]}.zip`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (error) {
			if (error instanceof ExportCancelledError) throw error;
			console.error("Data export failed:", error);
			throw new Error(
				error instanceof Error
					? `Data export failed: ${error.message}`
					: "Data export failed unexpectedly",
			);
		} finally {
			if (running === state) running = null;
		}
	})();
	return state.promise;
}
