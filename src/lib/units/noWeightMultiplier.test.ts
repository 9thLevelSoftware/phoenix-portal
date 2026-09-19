import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// KD-8 repo guard: loads are per cable end to end. The portal must never
// double a stored load again. Totals come only from src/lib/units/loadDisplay.ts
// (per cable x a known cable count).

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

// A literal "* 2" (not "** 2", not "* 2.5") applied to something that reads
// like a load: weight, *_kg, volume, 1RM, record value, load.
const DOUBLED_LOAD =
	/(weight|Weight|_kg\b|Kg\b|volume|Volume|1rm|1RM|OneRm|oneRM|\.value\b|load|Load|perCable|PerCable)[\w.)\]]*(?:\s*\?\?\s*[\w.]+)?\)*\s*(?<!\*)\*\s*2(?![\d.])/;

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

	it("never multiplies a load field by a literal 2", () => {
		const hits: string[] = [];
		for (const file of files) {
			const rel = relative(SRC, file).replaceAll("\\", "/");
			readFileSync(file, "utf8")
				.split("\n")
				.forEach((line, index) => {
					if (!DOUBLED_LOAD.test(line)) return;
					const hit = `${rel}:${index + 1}: ${line.trim()}`;
					if (ALLOWLIST.some((entry) => hit.includes(entry))) return;
					hits.push(hit);
				});
		}
		expect(hits).toEqual([]);
	});

	it("the pattern catches the doubling this PR removed", () => {
		for (const line of [
			"weight_kg: set.weight_kg * 2,",
			"(sum, s) => sum + (s.total_volume ?? 0) * 2,",
			"return formatLoad(record.value * 2, null, unit);",
			"perCable == null ? null : perCable * 2",
			"const nextLoad = latest.max_weight_kg * 2;",
		]) {
			expect(DOUBLED_LOAD.test(line), line).toBe(true);
		}
		expect(DOUBLED_LOAD.test("const variance = (value - avg) ** 2;")).toBe(
			false,
		);
		expect(DOUBLED_LOAD.test("ex.sets * 2.5")).toBe(false);
	});
});
