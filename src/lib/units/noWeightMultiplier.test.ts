import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// KD-8 repo guard: loads are per cable end to end. The portal must never
// double a stored load again. Totals come only from src/lib/units/loadDisplay.ts
// (per cable x a known cable count).
//
// What this guard catches, per source file:
//   1. the identifier WEIGHT_MULTIPLIER, anywhere;
//   2. a load-looking expression multiplied by a literal 2;
//   3. a load-looking expression multiplied by a local constant whose
//      initialiser is the literal 2 — i.e. WEIGHT_MULTIPLIER under any other
//      name (CABLE_FACTOR, DOUBLE, x2, …).
//
// What it does NOT catch (the unit suites are the real net; this is only
// defence in depth):
//   * a factor of 2 that is computed, imported from another module, read from
//     config or the database, or reached through an object/array
//     (FACTORS.cable, `2 ** 1`, `Number("2")`);
//   * doubling written as addition (`kg + kg`), or as a division by 0.5;
//   * a load whose variable name matches none of the load words below;
//   * anything outside src/ (Edge functions, SQL, the mobile app).
// The one legitimate scaling site is loadDisplay.ts, which multiplies a
// per-cable load by a *runtime* cable count (1 or 2) — never by a constant.

const SRC = resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name === "__tests__" || name === "node_modules") continue;
			out.push(...sourceFiles(path));
		} else if (
			/\.(ts|tsx)$/.test(name) &&
			!/\.(test|spec)\.(ts|tsx)$/.test(name) &&
			!name.endsWith(".d.ts")
		) {
			out.push(path);
		}
	}
	return out;
}

// Something that reads like a load: weight, *_kg, volume, 1RM, record value,
// load — immediately followed by a multiplication ("* ", not "** ").
const LOAD_TIMES = String.raw`(weight|Weight|_kg\b|Kg\b|volume|Volume|1rm|1RM|OneRm|oneRM|\.value\b|load|Load|perCable|PerCable)[\w.)\]]*(?:\s*\?\?\s*[\w.]+)?\)*\s*(?<!\*)\*\s*`;

/** Local constants initialised to the literal 2: a renamed WEIGHT_MULTIPLIER. */
function twoValuedConstants(source: string): string[] {
	const names = new Set<string>();
	const declaration =
		/\b(?:const|let|var|readonly|static)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*2\s*(?:as\s+const\s*)?(?=[;,\s)]|$)/gm;
	for (const match of source.matchAll(declaration)) names.add(match[1]);
	return [...names];
}

/**
 * A load multiplied by a literal 2, or by any of {@link twoValuedConstants}.
 * "* 2.5" and "** 2" are not matches.
 */
function doubledLoadPattern(twoNames: readonly string[] = []): RegExp {
	const factors = [
		String.raw`2(?![\d.])`,
		...twoNames.map((name) => `${name.replace(/[$]/g, "\\$&")}\\b`),
	];
	return new RegExp(`${LOAD_TIMES}(?:${factors.join("|")})`);
}

// Reviewed, not a load: add "relative/path:line-substring" entries here.
const ALLOWLIST: string[] = [];

describe("no ad hoc load doubling in src (KD-8)", () => {
	const files = sourceFiles(SRC);

	it("scans a meaningful number of files", () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it("never declares or uses WEIGHT_MULTIPLIER", () => {
		const hits = files
			.filter((file) =>
				readFileSync(file, "utf8").includes("WEIGHT_MULTIPLIER"),
			)
			.map((file) => relative(SRC, file));
		expect(hits).toEqual([]);
	});

	it("never multiplies a load field by 2, literal or under any constant name", () => {
		const hits: string[] = [];
		for (const file of files) {
			const rel = relative(SRC, file).replaceAll("\\", "/");
			const source = readFileSync(file, "utf8");
			const pattern = doubledLoadPattern(twoValuedConstants(source));
			source.split("\n").forEach((line, index) => {
				if (!pattern.test(line)) return;
				const hit = `${rel}:${index + 1}: ${line.trim()}`;
				if (ALLOWLIST.some((entry) => hit.includes(entry))) return;
				hits.push(hit);
			});
		}
		expect(hits).toEqual([]);
	});

	it("the pattern catches the doubling this PR removed", () => {
		const literal = doubledLoadPattern();
		for (const line of [
			"weight_kg: set.weight_kg * 2,",
			"(sum, s) => sum + (s.total_volume ?? 0) * 2,",
			"return formatLoad(record.value * 2, null, unit);",
			"perCable == null ? null : perCable * 2",
			"const nextLoad = latest.max_weight_kg * 2;",
		]) {
			expect(literal.test(line), line).toBe(true);
		}
		expect(literal.test("const variance = (value - avg) ** 2;")).toBe(false);
		expect(literal.test("ex.sets * 2.5")).toBe(false);
	});

	it("catches a renamed multiplier constant, not just WEIGHT_MULTIPLIER", () => {
		const source = [
			"const CABLE_FACTOR = 2;",
			"export const perCableToTotal = (weight_kg: number) =>",
			"\tweight_kg * CABLE_FACTOR;",
		].join("\n");

		expect(twoValuedConstants(source)).toContain("CABLE_FACTOR");

		const pattern = doubledLoadPattern(twoValuedConstants(source));
		expect(pattern.test("\tweight_kg * CABLE_FACTOR;")).toBe(true);
		// Without the rename pass it would slip through, which is the gap.
		expect(doubledLoadPattern().test("\tweight_kg * CABLE_FACTOR;")).toBe(
			false,
		);
	});

	it("reads two-valued constants in their usual shapes, and only those", () => {
		expect(twoValuedConstants("const DOUBLE = 2;")).toEqual(["DOUBLE"]);
		expect(twoValuedConstants("let cables: number = 2\n")).toEqual(["cables"]);
		expect(twoValuedConstants("const x2 = 2 as const;")).toEqual(["x2"]);
		expect(twoValuedConstants("const SIDES = 2, ARMS = 2;")).toEqual(["SIDES"]);
		expect(twoValuedConstants("const HALF = 2.5;")).toEqual([]);
		expect(twoValuedConstants("const SQUARE = 25;")).toEqual([]);
	});

	it("does not flag a runtime cable count (the legitimate total site)", () => {
		const source = readFileSync(join(SRC, "lib", "units", "loadDisplay.ts"), {
			encoding: "utf8",
		});
		const pattern = doubledLoadPattern(twoValuedConstants(source));
		expect(source).toContain("perCable * count");
		expect(
			pattern.test("		totalKg: count == null ? null : perCable * count,"),
		).toBe(false);
	});
});
