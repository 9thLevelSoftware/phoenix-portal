import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	coerceDropSetMinWeightKg,
	needsDropSetExistingRow,
	resolveDropSetUpsertFields,
} from "../../../supabase/functions/_shared/dropSetUpsert.ts";

const MOBILE_SYNC_PUSH_SOURCE = "supabase/functions/mobile-sync-push/index.ts";

const existingEnabled = {
	drop_set_enabled: true,
	drop_set_min_weight_kg: 12.5,
};

function readSource(filename: string): string {
	return readFileSync(join(process.cwd(), filename), "utf8");
}

describe("resolveDropSetUpsertFields", () => {
	it("uses incoming values when both fields are explicit", () => {
		expect(
			resolveDropSetUpsertFields(
				{ dropSetEnabled: true, dropSetMinWeightKg: 8 },
				existingEnabled,
			),
		).toEqual({ drop_set_enabled: true, drop_set_min_weight_kg: 8 });
		expect(
			resolveDropSetUpsertFields(
				{ dropSetEnabled: false, dropSetMinWeightKg: null },
				existingEnabled,
			),
		).toEqual({ drop_set_enabled: false, drop_set_min_weight_kg: null });
	});

	it("preserves the existing enabled row when both fields are omitted", () => {
		expect(resolveDropSetUpsertFields({}, existingEnabled)).toEqual(
			existingEnabled,
		);
	});

	it("preserves the existing enabled row when both fields are null", () => {
		expect(
			resolveDropSetUpsertFields(
				{ dropSetEnabled: null, dropSetMinWeightKg: null },
				existingEnabled,
			),
		).toEqual(existingEnabled);
	});

	it("defaults new rows to disabled when the payload omits drop-set fields", () => {
		expect(resolveDropSetUpsertFields({}, null)).toEqual({
			drop_set_enabled: false,
			drop_set_min_weight_kg: null,
		});
		expect(
			resolveDropSetUpsertFields(
				{ dropSetEnabled: null, dropSetMinWeightKg: null },
				null,
			),
		).toEqual({
			drop_set_enabled: false,
			drop_set_min_weight_kg: null,
		});
	});

	it("does not blank the floor while keeping an existing enabled flag", () => {
		expect(
			resolveDropSetUpsertFields({ dropSetMinWeightKg: null }, existingEnabled),
		).toEqual(existingEnabled);
	});

	it("always returns both columns so a mixed batch stays homogeneous", () => {
		const rows = [
			resolveDropSetUpsertFields(
				{ dropSetEnabled: true, dropSetMinWeightKg: 10 },
				null,
			),
			resolveDropSetUpsertFields(
				{ dropSetEnabled: null, dropSetMinWeightKg: null },
				existingEnabled,
			),
			resolveDropSetUpsertFields({}, null),
		];

		expect(rows.every((row) => "drop_set_enabled" in row)).toBe(true);
		expect(rows.every((row) => "drop_set_min_weight_kg" in row)).toBe(true);
		expect(rows).toEqual([
			{ drop_set_enabled: true, drop_set_min_weight_kg: 10 },
			existingEnabled,
			{ drop_set_enabled: false, drop_set_min_weight_kg: null },
		]);
	});
});

describe("coerceDropSetMinWeightKg", () => {
	it("accepts finite numbers and numeric strings from PostgREST", () => {
		expect(coerceDropSetMinWeightKg(12.5)).toBe(12.5);
		expect(coerceDropSetMinWeightKg("12.5")).toBe(12.5);
		expect(coerceDropSetMinWeightKg(null)).toBeNull();
		expect(coerceDropSetMinWeightKg("")).toBeNull();
		expect(coerceDropSetMinWeightKg(Number.NaN)).toBeNull();
	});
});

describe("needsDropSetExistingRow", () => {
	it("skips the probe when the payload is a complete CHECK-safe write", () => {
		expect(
			needsDropSetExistingRow({
				dropSetEnabled: true,
				dropSetMinWeightKg: 12.5,
			}),
		).toBe(false);
		expect(
			needsDropSetExistingRow({
				dropSetEnabled: false,
				dropSetMinWeightKg: null,
			}),
		).toBe(false);
	});

	it("probes when a legacy or partial payload could clobber existing values", () => {
		expect(needsDropSetExistingRow({})).toBe(true);
		expect(
			needsDropSetExistingRow({
				dropSetEnabled: null,
				dropSetMinWeightKg: null,
			}),
		).toBe(true);
		expect(needsDropSetExistingRow({ dropSetEnabled: true })).toBe(true);
		expect(needsDropSetExistingRow({ dropSetMinWeightKg: 8 })).toBe(true);
	});
});

describe("mobile-sync-push drop-set merge", () => {
	it("probes existing rows in chunks and merges both columns onto every upsert row", () => {
		const source = readSource(MOBILE_SYNC_PUSH_SOURCE);
		const lookupBlock = source.slice(
			source.indexOf("const dropSetProbeIds ="),
			source.indexOf("const reRows = reSource.map"),
		);

		expect(source).toContain("needsDropSetExistingRow");
		expect(source).toContain("resolveDropSetUpsertFields");
		expect(lookupBlock).toContain("const chunkSize = 100;");
		expect(lookupBlock).toMatch(
			/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*dropSetProbeIds\.length;\s*i\s*\+=\s*chunkSize\s*\)/,
		);
		expect(lookupBlock).toContain(
			".select('id, drop_set_enabled, drop_set_min_weight_kg')",
		);
		expect(lookupBlock).toContain(".in('id', chunk)");
		expect(source).toContain("...resolveDropSetUpsertFields(");
	});
});
