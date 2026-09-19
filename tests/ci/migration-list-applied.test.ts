/**
 * Parser parity for the prod migration gates (NF-11).
 *
 * The fixtures are real captures from a throwaway local Postgres with a
 * `supabase_migrations.schema_migrations` table: `<scenario>.json` from
 * `supabase migration list --db-url … --output-format json` on the pinned CLI
 * (2.117.0), and `<scenario>.table` from the same scenario on CLI 2.76.9, whose
 * text table the workflows used to parse. The new JSON parser must yield the
 * same applied set, and so the same pass/fail decision, as the old parser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs script without type declarations
import * as parser from "../../scripts/migration-list-applied.mjs";

const { MigrationListParseError, parseAppliedVersions, unappliedVersions } =
	parser as {
		MigrationListParseError: new (...args: unknown[]) => Error;
		parseAppliedVersions: (jsonText: string) => string[];
		unappliedVersions: (local: string[], applied: string[]) => string[];
	};

const fixtures = path.resolve(__dirname, "fixtures/migration-list");
const read = (name: string) => readFileSync(path.join(fixtures, name), "utf8");

/**
 * Faithful port of the python parser the workflows ran on the 2.76.9 table:
 * strip ANSI, split on `|`/`│`, drop the empty edge cells, take the first
 * number in column 1 (Remote).
 */
function oldTextParser(table: string): string[] {
	const ansi = new RegExp(
		`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`,
		"g",
	);
	const versions = new Set<string>();
	for (const rawLine of table.split(/\r?\n/)) {
		const line = rawLine.replace(ansi, "");
		let columns = line
			.split(/[|│]/)
			.map((c) => c.trim().replace(/^`+|`+$/g, ""));
		if (
			columns.length >= 4 &&
			columns[0] === "" &&
			columns[columns.length - 1] === ""
		) {
			columns = columns.slice(1);
		}
		if (columns.length < 3) continue;
		const match = /\b(\d+)\b/.exec(columns[1]);
		if (match) versions.add(match[1]);
	}
	return [...versions].sort();
}

const A = "20260101000000";
const B = "20260102000000";
const C = "20260103000000"; // local file, not applied
const D = "20260104000000"; // applied, no local file

const scenarios = [
	{ name: "all-applied", local: [A, B], applied: [A, B], drift: [] },
	{ name: "local-only", local: [A, B, C], applied: [A, B], drift: [C] },
	{ name: "remote-only", local: [A, B], applied: [A, B, D], drift: [] },
	{ name: "both", local: [A, B, C], applied: [A, B, D], drift: [C] },
	{ name: "none-applied", local: [A, B, C], applied: [], drift: [A, B, C] },
];

describe("migration-list-applied parser", () => {
	for (const s of scenarios) {
		it(`${s.name}: same applied set and decision as the old text parser`, () => {
			const applied = parseAppliedVersions(read(`${s.name}.json`));
			const oldApplied = oldTextParser(read(`${s.name}.table`));

			expect(applied).toEqual(s.applied);
			expect(applied).toEqual(oldApplied);

			const drift = unappliedVersions(s.local, applied);
			expect(drift).toEqual(s.drift);
			expect(drift.length === 0).toBe(
				unappliedVersions(s.local, oldApplied).length === 0,
			);
		});
	}

	it("rejects output that is not the expected JSON shape", () => {
		const table = read("all-applied.table");
		expect(() => parseAppliedVersions(table)).toThrow(MigrationListParseError);
		expect(() => parseAppliedVersions("{}")).toThrow(MigrationListParseError);
		expect(() => parseAppliedVersions('{"migrations":{}}')).toThrow(
			MigrationListParseError,
		);
		expect(() =>
			parseAppliedVersions('{"migrations":[{"remote":"abc"}]}'),
		).toThrow(MigrationListParseError);
		expect(() =>
			parseAppliedVersions('{"migrations":[{"remote":20260101000000}]}'),
		).toThrow(MigrationListParseError);
	});

	it("treats a missing or null remote as not applied", () => {
		expect(
			parseAppliedVersions(
				`{"migrations":[{"local":"${A}"},{"local":"${B}","remote":null}]}`,
			),
		).toEqual([]);
	});
});
