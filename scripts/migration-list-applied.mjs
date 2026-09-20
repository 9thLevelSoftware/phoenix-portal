#!/usr/bin/env node
/**
 * Print the migration versions a Supabase project has applied, one per line,
 * sorted and unique, from `supabase migration list --output-format json`.
 *
 *   supabase migration list --linked --output-format json > migration_list.json
 *   node scripts/migration-list-applied.mjs migration_list.json > remote_migrations.txt
 *
 * Used by .github/workflows/prod-migration-drift.yml and
 * .github/workflows/deploy-edge-functions.yml (both on the CLI pinned in
 * .supabase-cli-version). Shape emitted by that CLI:
 *
 *   {"migrations":[{"local":"2026…","remote":"2026…","time":"…"}, …],
 *    "message":"Migrations listed"}
 *
 * A version is applied when its `remote` is non-empty. A local-only row has
 * `remote: ""`; a remote-only row has `local: ""` and still counts as applied.
 * This is the same set the old text-table parser read from the Remote column.
 *
 * Contract (pinned by tests/ci/migration-list-applied.test.ts — callers depend
 * on every line of it):
 *   - stdout is the applied versions, sorted ascending, de-duplicated, one per
 *     line with a trailing newline. `deploy-edge-functions.yml` feeds this
 *     straight into `comm -23`, which is wrong on unsorted input.
 *   - `migrations: null` is accepted as "no rows": Go marshals a nil slice
 *     that way. Any other non-array `migrations` is a shape change.
 *   - every row MUST carry a `remote` key. A row without one means the CLI
 *     renamed the field; that is a shape change, NOT "this row is unapplied".
 *   - `remote: ""` and `remote: null` are rows that are not applied remotely.
 *
 * Exit codes — neither non-zero code is a drift result:
 *   0  parsed. The applied list may legitimately be empty (nothing applied).
 *   2  the input is not the expected shape: the CLI output changed, fix this
 *      script.
 *   3  the shape is fine but a `remote` version value is unrecognized (not all
 *      digits). The parser and the CLI are both fine; the offending row in the
 *      project's `supabase_migrations.schema_migrations` is what to look at.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The CLI output is not the shape this script knows how to read (exit 2). */
export class MigrationListParseError extends Error {}

/** The shape is fine; one `remote` value is not a version (exit 3). */
export class MigrationListValueError extends Error {}

/** @param {string} jsonText @returns {string[]} */
export function parseAppliedVersions(jsonText) {
	let data;
	try {
		data = JSON.parse(jsonText);
	} catch (error) {
		throw new MigrationListParseError(
			`migration list output is not valid JSON (${error.message})`,
		);
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new MigrationListParseError("migration list JSON is not an object");
	}
	if (!("migrations" in data)) {
		throw new MigrationListParseError(
			"migration list JSON has no `migrations` field",
		);
	}
	// `null` is how Go marshals a nil slice, i.e. a project with no rows at
	// all. Treat it as an empty list; the callers handle an empty applied set
	// explicitly (and refuse to call it drift).
	const rows = data.migrations === null ? [] : data.migrations;
	if (!Array.isArray(rows)) {
		throw new MigrationListParseError(
			"migration list JSON `migrations` is not an array",
		);
	}
	const versions = new Set();
	for (const row of rows) {
		if (!row || typeof row !== "object" || Array.isArray(row)) {
			throw new MigrationListParseError("migration list row is not an object");
		}
		if (!("remote" in row)) {
			throw new MigrationListParseError(
				"migration list row has no `remote` field (the CLI may have renamed it); refusing to read the row as unapplied",
			);
		}
		const remote = row.remote ?? "";
		if (typeof remote !== "string") {
			throw new MigrationListParseError(
				"migration list row has a non-string `remote`",
			);
		}
		const version = remote.trim();
		if (version === "") continue;
		if (!/^\d+$/.test(version)) {
			throw new MigrationListValueError(
				`migration list row has a non-numeric \`remote\` version: ${JSON.stringify(
					version.slice(0, 80),
				)}`,
			);
		}
		versions.add(version);
	}
	return [...versions].sort();
}

/** Local versions that are not applied remotely (the drift set). */
export function unappliedVersions(localVersions, appliedVersions) {
	const applied = new Set(appliedVersions);
	return [...new Set(localVersions)].filter((v) => !applied.has(v)).sort();
}

const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	const file = process.argv[2];
	if (!file) {
		console.error("usage: node scripts/migration-list-applied.mjs <file>");
		process.exit(2);
	}
	try {
		const versions = parseAppliedVersions(readFileSync(file, "utf8"));
		if (versions.length > 0) process.stdout.write(`${versions.join("\n")}\n`);
	} catch (error) {
		console.error(`migration-list-applied: ${error.message}`);
		process.exit(error instanceof MigrationListValueError ? 3 : 2);
	}
}
