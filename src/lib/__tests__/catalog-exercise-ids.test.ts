import { describe, expect, it } from "vitest";
import {
	buildCatalogIndexes,
	normalizeCatalogKey,
	resolveCatalogExerciseId,
	resolveCatalogExerciseIds,
} from "../../../supabase/functions/_shared/catalogExerciseIds.ts";

const library = {
	id: "Barbell_Squat",
	name: "Barbell Squat",
	display_name: "Barbell Squat",
	aliases: ["Squat"],
	user_id: null,
	is_custom: false,
};

const custom = {
	id: "custom_1",
	name: "My Press",
	display_name: "My Press",
	aliases: [],
	user_id: "user-a",
	is_custom: true,
};

describe("normalizeCatalogKey", () => {
	it("strips punctuation, parens, and equipment separators", () => {
		expect(normalizeCatalogKey("Barbell Squat (Machine)")).toBe(
			"barbell squat",
		);
		expect(normalizeCatalogKey("Barbell_Bench_Press_-_Medium_Grip")).toBe(
			"barbell bench press medium grip",
		);
	});
});

describe("resolveCatalogExerciseId", () => {
	const indexes = buildCatalogIndexes([library, custom], "user-a");

	it("keeps a known library id", () => {
		expect(resolveCatalogExerciseId(indexes, "Barbell_Squat")).toBe(
			"Barbell_Squat",
		);
	});

	it("keeps the owner's custom id", () => {
		expect(resolveCatalogExerciseId(indexes, "custom_1")).toBe("custom_1");
	});

	it("rejects another user's custom id", () => {
		const other = buildCatalogIndexes([library, custom], "user-b");
		expect(resolveCatalogExerciseId(other, "custom_1", "My Press")).toBeNull();
	});

	it("remaps an unknown id by normalized name", () => {
		expect(resolveCatalogExerciseId(indexes, "legacy-id", "Squat")).toBe(
			"Barbell_Squat",
		);
	});

	it("returns null when neither id nor name matches", () => {
		expect(
			resolveCatalogExerciseId(indexes, "missing-id", "Totally Unknown Lift"),
		).toBeNull();
	});
});

describe("resolveCatalogExerciseIds", () => {
	it("counts direct, name, and unmatched refs", () => {
		const indexes = buildCatalogIndexes([library], "user-a");
		const result = resolveCatalogExerciseIds(indexes, [
			{ id: "Barbell_Squat", name: "Barbell Squat" },
			{ id: "legacy-1", name: "Squat" },
			{ id: "legacy-2", name: "No Such Thing" },
		]);
		expect(result.matched).toBe(1);
		expect(result.nameMatched).toBe(1);
		expect(result.unmatched).toBe(1);
		expect(result.resolved.get("legacy-1")).toBe("Barbell_Squat");
		expect(result.resolved.get("legacy-2")).toBeNull();
	});
});
