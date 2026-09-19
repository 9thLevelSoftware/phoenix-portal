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
 * Exit codes: 0 = parsed (the list may be empty: nothing applied), 2 = the
 * input is not the expected shape. Callers must treat 2 as a parser failure,
 * not a drift result.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class MigrationListParseError extends Error {}

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
	if (!data || typeof data !== "object" || !Array.isArray(data.migrations)) {
		throw new MigrationListParseError(
			"migration list JSON has no `migrations` array",
		);
	}
	const versions = new Set();
	for (const row of data.migrations) {
		if (!row || typeof row !== "object") {
			throw new MigrationListParseError("migration list row is not an object");
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
			throw new MigrationListParseError(
				"migration list row has a non-numeric `remote` version",
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
		process.exit(2);
	}
}
