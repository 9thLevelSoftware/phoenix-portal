import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The generated body-muscle map is ~1.7 MB of source. It must only ever be
 * reached through the dynamic import in body-muscle-analytics-loader.ts, so
 * that CSV export, Profile and the rest of Analytics stay small. A value
 * import of body-muscle-analytics (or of the generated map) anywhere else
 * would silently pull it back into a shared chunk.
 */
const SRC = path.resolve(__dirname, "../..");

const ALLOWED_VALUE_IMPORTERS = new Set(
	[
		// The analytics module itself owns the generated map.
		"lib/body-muscle-analytics.ts",
	].map((file) => path.join(SRC, file)),
);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : sourceFiles(full);
		}
		if (!/\.(ts|tsx)$/.test(entry.name)) return [];
		if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
		if (entry.name.endsWith(".generated.ts")) return [];
		return [full];
	});
}

// Static `import ... from "..."` / `export ... from "..."`, excluding type-only.
const STATIC_IMPORT =
	/(?:^|\n)\s*(import|export)\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']/g;

function valueImportsOf(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(STATIC_IMPORT)) {
		specifiers.push(match[3] ?? "");
	}
	// Side-effect imports: import "x";
	for (const match of source.matchAll(
		/(?:^|\n)\s*import\s+["']([^"']+)["']/g,
	)) {
		specifiers.push(match[1] ?? "");
	}
	return specifiers;
}

const BODY_MAP_MODULE = /(^|\/)body-muscle-(analytics|map\.generated)$/;

describe("body-muscle map code split", () => {
	it("is never value-imported statically outside the analytics module", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles(SRC)) {
			if (ALLOWED_VALUE_IMPORTERS.has(file)) continue;
			const imports = valueImportsOf(readFileSync(file, "utf8"));
			for (const specifier of imports) {
				if (BODY_MAP_MODULE.test(specifier)) {
					offenders.push(`${path.relative(SRC, file)} -> ${specifier}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("detects a regression (guard self-test)", () => {
		expect(
			valueImportsOf(
				'import { buildBodyMuscleFocusModel } from "@/lib/body-muscle-analytics";',
			).some((specifier) => BODY_MAP_MODULE.test(specifier)),
		).toBe(true);
		expect(
			valueImportsOf(
				'import type { BodyMuscleFocusModel } from "@/lib/body-muscle-analytics";',
			),
		).toEqual([]);
		expect(
			valueImportsOf(
				'import {\n\ttype A,\n\tbuild,\n} from "@/lib/body-muscle-analytics";',
			).some((specifier) => BODY_MAP_MODULE.test(specifier)),
		).toBe(true);
	});

	it("is loaded lazily by the loader", () => {
		const loader = readFileSync(
			path.join(SRC, "lib/body-muscle-analytics-loader.ts"),
			"utf8",
		);
		expect(loader).toMatch(
			/import\(\s*["']@\/lib\/body-muscle-analytics["']\s*\)/,
		);
	});
});
