import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	isBodyMusclesRuntimeModule,
	stripBodyMusclesSourcemapComments,
	stripBodyMusclesSourcemapsPlugin,
} from "./body-muscles-sourcemaps";

describe("body-muscles sourcemap stripping", () => {
	it("identifies runtime body-muscles JavaScript modules", () => {
		expect(
			isBodyMusclesRuntimeModule(
				"C:/repo/node_modules/body-muscles/dist/esm/index.js",
			),
		).toBe(true);
		expect(
			isBodyMusclesRuntimeModule(
				"C:/repo/node_modules/body-muscles/dist/esm/index.d.ts",
			),
		).toBe(false);
		expect(isBodyMusclesRuntimeModule("C:/repo/src/app.ts")).toBe(false);
	});

	it("removes only the trailing broken body-muscles sourcemap reference", () => {
		const code = [
			"export const value = 1;",
			"//# sourceMappingURL=index.js.map",
			"",
		].join("\n");

		expect(stripBodyMusclesSourcemapComments(code)).toBe(
			"export const value = 1;\n",
		);
	});

	it("loads body-muscles runtime modules without their sourcemap comments", async () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), "phoenix-body-muscles-"));
		try {
			const moduleDir = path.join(
				tempRoot,
				"node_modules",
				"body-muscles",
				"dist",
				"esm",
			);
			const modulePath = path.join(moduleDir, "index.js");
			mkdirSync(moduleDir, { recursive: true });
			writeFileSync(
				modulePath,
				"export const value = 1;\n//# sourceMappingURL=index.js.map\n",
				"utf8",
			);

			const plugin = stripBodyMusclesSourcemapsPlugin();
			const loaded =
				typeof plugin.load === "function"
					? await plugin.load.call({} as never, modulePath)
					: null;

			expect(loaded).toEqual({
				code: "export const value = 1;\n",
				map: null,
			});
		} finally {
			rmSync(tempRoot, { force: true, recursive: true });
		}
	});
});
