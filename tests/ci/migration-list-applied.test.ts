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
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs script without type declarations
import * as parser from "../../scripts/migration-list-applied.mjs";

const {
	MigrationListParseError,
	MigrationListValueError,
	parseAppliedVersions,
	unappliedVersions,
} = parser as {
	MigrationListParseError: new (...args: unknown[]) => Error;
	MigrationListValueError: new (...args: unknown[]) => Error;
	parseAppliedVersions: (jsonText: string) => string[];
	unappliedVersions: (local: string[], applied: string[]) => string[];
};

const fixtures = path.resolve(__dirname, "fixtures/migration-list");
const read = (name: string) => readFileSync(path.join(fixtures, name), "utf8");
const script = path.resolve(
	__dirname,
	"../../scripts/migration-list-applied.mjs",
);
/** Run the script the way both workflows run it: as a process. */
const run = (fixture: string) =>
	spawnSync(process.execPath, [script, path.join(fixtures, fixture)], {
		encoding: "utf8",
	});

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
	// The parser reports this honestly as "nothing applied"; both workflows
	// then refuse to call it drift (R-5) — prod demonstrably has migrations, so
	// an empty applied set means the wrong project or a bad read, and a
	// "push everything" recipe there would replay the whole history.
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
		expect(() => parseAppliedVersions("[]")).toThrow(MigrationListParseError);
		expect(() => parseAppliedVersions('{"migrations":{}}')).toThrow(
			MigrationListParseError,
		);
		expect(() =>
			parseAppliedVersions('{"migrations":[{"remote":20260101000000}]}'),
		).toThrow(MigrationListParseError);
	});

	// R-14: the `!row || typeof row !== "object"` guard was unverified; without
	// it a null row throws a raw TypeError (exit 1, no diagnostic) and a scalar
	// row is silently read as "not applied".
	it("rejects a null or scalar migrations row", () => {
		expect(() => parseAppliedVersions('{"migrations":[null]}')).toThrow(
			MigrationListParseError,
		);
		expect(() => parseAppliedVersions(`{"migrations":["${A}"]}`)).toThrow(
			MigrationListParseError,
		);
		expect(() => parseAppliedVersions('{"migrations":[[]]}')).toThrow(
			MigrationListParseError,
		);
	});

	// R-6: "the field is present and empty" (genuinely unapplied) must stay
	// distinguishable from "the field is gone" (the CLI changed shape). The
	// latter used to degrade to exit 0 + an empty applied set, which the drift
	// detector would have reported as every migration being unapplied.
	it("treats an empty or null remote as not applied", () => {
		expect(
			parseAppliedVersions(
				`{"migrations":[{"local":"${A}","remote":""},{"local":"${B}","remote":null}]}`,
			),
		).toEqual([]);
	});

	it("rejects a row whose `remote` field has been renamed away", () => {
		expect(() => parseAppliedVersions(read("renamed-remote.json"))).toThrow(
			MigrationListParseError,
		);
		expect(() =>
			parseAppliedVersions(`{"migrations":[{"local":"${A}"}]}`),
		).toThrow(MigrationListParseError);
	});

	// R-19: pinned decision — `migrations: null` (Go's nil slice) is "nothing
	// applied", not a parser failure. Every other non-array stays rejected.
	it("reads `migrations: null` as nothing applied", () => {
		expect(parseAppliedVersions('{"migrations":null}')).toEqual([]);
		expect(parseAppliedVersions('{"migrations":[]}')).toEqual([]);
	});

	// R-8: shape-is-fine-but-the-value-is-odd is its own condition, so the
	// operator is pointed at the prod row rather than at this parser.
	it("reports a non-numeric remote version as a value error naming the value", () => {
		expect(() =>
			parseAppliedVersions('{"migrations":[{"remote":"abc"}]}'),
		).toThrow(MigrationListValueError);
		expect(() => parseAppliedVersions(read("non-numeric-remote.json"))).toThrow(
			/repair-20260102/,
		);
	});

	// R-12: deploy-edge-functions.yml pipes this straight into `comm -23`
	// without sorting it first, so sorted + unique is a load-bearing contract
	// that every fixture happens to satisfy by accident.
	it("sorts and de-duplicates the applied versions", () => {
		expect(
			parseAppliedVersions(
				`{"migrations":[{"remote":"${B}"},{"remote":"${D}"},{"remote":"${A}"},{"remote":"${B}"}]}`,
			),
		).toEqual([A, B, D]);
	});
});

// R-13: both workflows branch on the *process* (exit status, stdout content),
// not on the exported functions. A refactor that printed the diagnostic to
// stdout or exited 0 on a parse failure would keep every test above green
// while turning a parser failure into "prod has nothing applied".
describe("migration-list-applied entrypoint", () => {
	it("exits 0 and prints one version per line for a parsed list", () => {
		const result = run("all-applied.json");
		expect(result.status).toBe(0);
		expect(result.stdout).toBe(`${A}\n${B}\n`);
		expect(result.stderr).toBe("");
	});

	it("exits 0 with empty stdout when nothing is applied", () => {
		const result = run("none-applied.json");
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("exits 2 with an empty stdout when the shape changed", () => {
		for (const fixture of ["all-applied.table", "renamed-remote.json"]) {
			const result = run(fixture);
			expect(result.status).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toMatch(/^migration-list-applied: /);
		}
	});

	it("exits 3 when the shape is fine but a version value is unrecognized", () => {
		const result = run("non-numeric-remote.json");
		expect(result.status).toBe(3);
		expect(result.stdout).toBe("");
		expect(result.stderr).toMatch(/non-numeric `remote` version/);
	});

	it("exits 2 when the input file is missing", () => {
		const result = run("does-not-exist.json");
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
	});
});
