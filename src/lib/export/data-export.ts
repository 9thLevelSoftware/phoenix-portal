import { FunctionsHttpError } from "@supabase/supabase-js";
import JSZip from "jszip";
import { supabase } from "@/lib/supabase";
import { USER_DATA_EXPORT_TABLES } from "../../../supabase/functions/_shared/userDataManifest.ts";

type ProgressCallback = (step: string, current: number, total: number) => void;

export { exportAnalyticsTablesZip } from "./analytics-tables";

export const EXPORT_FUNCTION_NAME = "export-user-data";

/** Tables written as NDJSON, one zip entry per endpoint page. */
const NDJSON_TABLES: ReadonlySet<string> = new Set(["rep_telemetry"]);

/** Attempts per page when the endpoint answers 429 or 503. */
const MAX_ATTEMPTS_PER_PAGE = 6;
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_RETRY_AFTER_SECONDS = 3600;

export type ExportCursor = Record<string, string | number>;
type Row = Record<string, unknown>;

export interface ExportPage {
	table: string;
	rows: Row[];
	nextCursor: ExportCursor | null;
	tableMissing?: boolean;
}

/**
 * The endpoint asked the client to wait (HTTP 429 or 503). The same page is
 * requested again after `retryAfterSeconds`.
 */
export class ExportRetryableError extends Error {
	constructor(
		message: string,
		readonly retryAfterSeconds: number,
	) {
		super(message);
		this.name = "ExportRetryableError";
	}
}

export type ExportPageRequester = (
	table: string,
	cursor: ExportCursor | null,
) => Promise<ExportPage>;

export interface BuildUserDataExportOptions {
	requestPage: ExportPageRequester;
	onProgress?: ProgressCallback;
	/** Injected for tests; defaults to a real timer. */
	sleep?: (ms: number) => Promise<void>;
	/** Defaults to the manifest order (non-table sources first). */
	tables?: readonly string[];
	now?: () => Date;
}

export interface ExportTableSummary {
	table: string;
	rows: number;
	files: string[];
}

export interface UserDataExportResult {
	zip: JSZip;
	tables: ExportTableSummary[];
	unavailableTables: string[];
}

function parseRetryAfter(value: string | null): number {
	if (!value) return DEFAULT_RETRY_AFTER_SECONDS;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
	}
	const date = Date.parse(value);
	if (!Number.isNaN(date)) {
		const delta = Math.ceil((date - Date.now()) / 1000);
		return Math.min(Math.max(delta, 0), MAX_RETRY_AFTER_SECONDS);
	}
	return DEFAULT_RETRY_AFTER_SECONDS;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function readErrorMessage(response: Response): Promise<string> {
	try {
		const body = (await response.clone().json()) as unknown;
		if (isPlainObject(body) && typeof body.error === "string")
			return body.error;
	} catch {
		// Non-JSON error body.
	}
	return `HTTP ${response.status}`;
}

/** Requests one page from the export-user-data Edge Function. */
export const requestExportPage: ExportPageRequester = async (table, cursor) => {
	const { data, error } = await supabase.functions.invoke(
		EXPORT_FUNCTION_NAME,
		{ body: cursor ? { table, cursor } : { table } },
	);
	if (error) {
		if (error instanceof FunctionsHttpError) {
			const response = error.context as Response;
			const message = await readErrorMessage(response);
			if (response.status === 429 || response.status === 503) {
				throw new ExportRetryableError(
					`Export of ${table} paused (${message})`,
					parseRetryAfter(response.headers.get("Retry-After")),
				);
			}
			throw new Error(`Export failed for ${table}: ${message}`);
		}
		throw new Error(
			`Export failed for ${table}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return parseExportPage(table, data);
};

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameCursor(a: ExportCursor | null, b: ExportCursor | null): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function pageFileName(table: string, page: number): string {
	return `data/${table}/part-${String(page).padStart(5, "0")}.ndjson`;
}

function readmeText(
	exportedAt: string,
	tables: ExportTableSummary[],
	unavailableTables: string[],
): string {
	const lines = [
		"Phoenix Portal data export",
		`Exported at: ${exportedAt}`,
		"",
		"Each table is in data/<table>.json (a JSON array of rows).",
		"Rep telemetry is in data/rep_telemetry/part-NNNNN.ndjson (one JSON row per line).",
		"export-manifest.json lists every table, its row count and its files.",
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
	lines.push("", "Rows per table:");
	for (const summary of tables) {
		lines.push(`  ${summary.table}: ${summary.rows}`);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Builds the GDPR export zip from the paged export-user-data endpoint.
 *
 * Every manifest table and non-table source is requested page by page until
 * `nextCursor` is null. Each page is serialized on its own and appended to
 * its table's entry as it arrives (rep_telemetry as NDJSON parts, one per
 * page), so the export is never held as one JSON string. Any failed page
 * aborts the whole export: a partial zip is never produced.
 */
export async function buildUserDataExport(
	options: BuildUserDataExportOptions,
): Promise<UserDataExportResult> {
	const {
		requestPage,
		onProgress,
		sleep = defaultSleep,
		tables = USER_DATA_EXPORT_TABLES,
		now = () => new Date(),
	} = options;
	const zip = new JSZip();
	const summaries: ExportTableSummary[] = [];
	const unavailableTables: string[] = [];
	const totalSteps = tables.length + 2;

	for (const [index, table] of tables.entries()) {
		const step = index + 1;
		onProgress?.(`Exporting ${table}...`, step, totalSteps);
		const ndjson = NDJSON_TABLES.has(table);
		const jsonParts: string[] = [];
		const files: string[] = [];
		let rowCount = 0;
		let pageNumber = 0;
		let cursor: ExportCursor | null = null;
		let missing = false;

		for (;;) {
			let page: ExportPage | undefined;
			for (let attempt = 1; !page; attempt++) {
				try {
					page = await requestPage(table, cursor);
				} catch (error) {
					if (
						!(error instanceof ExportRetryableError) ||
						attempt >= MAX_ATTEMPTS_PER_PAGE
					) {
						throw error;
					}
					onProgress?.(
						`Export paused by the server; resuming ${table} in ${error.retryAfterSeconds}s...`,
						step,
						totalSteps,
					);
					await sleep(error.retryAfterSeconds * 1000);
				}
			}

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
					files.push(file);
				} else {
					jsonParts.push(
						page.rows.map((row) => JSON.stringify(row)).join(",\n"),
					);
				}
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
			files.push(file);
		}
		summaries.push({ table, rows: rowCount, files });
	}

	const exportedAt = now().toISOString();
	zip.file(
		"export-manifest.json",
		JSON.stringify(
			{
				exportedAt,
				tables: summaries,
				unavailableTables,
			},
			null,
			2,
		),
	);
	zip.file("README.txt", readmeText(exportedAt, summaries, unavailableTables));

	return { zip, tables: summaries, unavailableTables };
}

/**
 * Export all user-owned data as a downloadable ZIP (GDPR Articles 15/20).
 *
 * The data comes from the export-user-data Edge Function, which scopes every
 * table to the signed-in user and pages it with a keyset cursor, so no table
 * is truncated. Credentials (OAuth tokens, API keys) are never exported.
 * Any failure throws before a file is downloaded.
 */
export async function exportAllUserData(
	_userId: string,
	onProgress?: ProgressCallback,
): Promise<void> {
	try {
		const { zip } = await buildUserDataExport({
			requestPage: requestExportPage,
			onProgress,
		});
		const total = USER_DATA_EXPORT_TABLES.length + 2;
		onProgress?.("Compressing export...", total - 1, total);
		const blob = await zip.generateAsync({ type: "blob" });
		onProgress?.("Starting download...", total, total);

		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `phoenix-data-export-${new Date().toISOString().split("T")[0]}.zip`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	} catch (error) {
		console.error("Data export failed:", error);
		throw new Error(
			error instanceof Error
				? `Data export failed: ${error.message}`
				: "Data export failed unexpectedly",
		);
	}
}
