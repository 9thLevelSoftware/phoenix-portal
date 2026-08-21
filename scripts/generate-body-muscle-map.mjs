import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourcePath = path.join(
	root,
	"supabase",
	"seed-data",
	"exercise_catalog.open.json",
);
const outputPath = path.join(root, "src", "lib", "body-muscle-map.generated.ts");

const STRIP_EQUIPMENT = /^(db|bb|cable|machine)\s+/i;
const STRIP_POSITIONAL = /^(seated|standing|incline|decline)\s+/i;
const STRIP_PARENS = /\s*\(.*\)\s*$/;

function normalizeExerciseName(name) {
	let result = String(name ?? "").trim().toLowerCase().replace(STRIP_PARENS, "").trim();
	let prev = "";
	while (prev !== result) {
		prev = result;
		const afterEquipment = result.replace(STRIP_EQUIPMENT, "").trim();
		if (afterEquipment !== result) {
			result = afterEquipment;
			continue;
		}
		const afterPositional = result.replace(STRIP_POSITIONAL, "").trim();
		if (afterPositional !== result && afterPositional.includes(" ")) {
			result = afterPositional;
		}
	}
	return result;
}

const REGION_ALIASES = {
	chest: [
		"chest-upper-left",
		"chest-upper-right",
		"chest-lower-left",
		"chest-lower-right",
	],
	triceps: [
		"triceps-long-left",
		"triceps-lateral-left",
		"triceps-long-right",
		"triceps-lateral-right",
	],
	biceps: ["biceps-left", "biceps-right"],
	forearms: [
		"forearm-left",
		"forearm-right",
		"forearm-flexors-left",
		"forearm-extensors-left",
		"forearm-flexors-right",
		"forearm-extensors-right",
	],
	shoulders: [
		"shoulder-front-left",
		"shoulder-front-right",
		"shoulder-side-left",
		"shoulder-side-right",
		"deltoid-rear-left",
		"deltoid-rear-right",
	],
	lats: [
		"lats-upper-left",
		"lats-mid-left",
		"lats-lower-left",
		"lats-upper-right",
		"lats-mid-right",
		"lats-lower-right",
	],
	upper_back: [
		"traps-upper-left",
		"traps-mid-left",
		"traps-lower-left",
		"traps-upper-right",
		"traps-mid-right",
		"traps-lower-right",
		"deltoid-rear-left",
		"deltoid-rear-right",
	],
	traps: [
		"traps-upper-left",
		"traps-mid-left",
		"traps-lower-left",
		"traps-upper-right",
		"traps-mid-right",
		"traps-lower-right",
	],
	lower_back: [
		"spine",
		"lower-back-erectors-left",
		"lower-back-ql-left",
		"lower-back-erectors-right",
		"lower-back-ql-right",
	],
	core: [
		"abs-upper-left",
		"abs-upper-right",
		"abs-lower-left",
		"abs-lower-right",
	],
	obliques: [
		"obliques-left",
		"obliques-right",
		"serratus-anterior-left",
		"serratus-anterior-right",
	],
	quads: ["quads-left", "quads-right"],
	hamstrings: [
		"hamstrings-medial-left",
		"hamstrings-lateral-left",
		"hamstrings-medial-right",
		"hamstrings-lateral-right",
	],
	glutes: [
		"gluteus-maximus-left",
		"gluteus-medius-left",
		"gluteus-maximus-right",
		"gluteus-medius-right",
	],
	calves: [
		"calves-gastroc-medial-left",
		"calves-gastroc-lateral-left",
		"calves-soleus-left",
		"calves-gastroc-medial-right",
		"calves-gastroc-lateral-right",
		"calves-soleus-right",
	],
	adductors: ["adductors-left", "adductors-right"],
	abductors: ["gluteus-medius-left", "gluteus-medius-right"],
};

const GROUP_ALIASES = {
	CHEST: REGION_ALIASES.chest,
	ARMS: [
		...REGION_ALIASES.biceps,
		...REGION_ALIASES.triceps,
		...REGION_ALIASES.forearms,
	],
	SHOULDERS: REGION_ALIASES.shoulders,
	BACK: [
		...REGION_ALIASES.lats,
		...REGION_ALIASES.upper_back,
		...REGION_ALIASES.lower_back,
	],
	CORE: [...REGION_ALIASES.core, ...REGION_ALIASES.obliques, "spine"],
	LEGS: [
		...REGION_ALIASES.quads,
		...REGION_ALIASES.hamstrings,
		...REGION_ALIASES.glutes,
		...REGION_ALIASES.calves,
		...REGION_ALIASES.adductors,
	],
};

function normalizeToken(token) {
	return String(token ?? "").trim().replace(/[\s-]+/g, "_").toLowerCase();
}

function distributeRegions(regions) {
	if (regions.length === 0) return [];
	return regions.map((id) => ({ id, weight: 1 / regions.length }));
}

function addWeightedRegions(target, regions, sourceWeight) {
	if (regions.length === 0) return;
	const perRegion = sourceWeight / regions.length;
	for (const id of regions) {
		target.set(id, (target.get(id) ?? 0) + perRegion);
	}
}

function buildBodyMuscles(exercise) {
	const explicitMuscles = (exercise.muscles ?? []).map(normalizeToken).filter(Boolean);
	const sourceMuscles =
		explicitMuscles.length > 0
			? explicitMuscles
			: (exercise.muscleGroups ?? []).map((value) => String(value).trim()).filter(Boolean);
	const weights = new Map();

	if (explicitMuscles.length > 0) {
		const sourceWeight = 1 / explicitMuscles.length;
		for (const muscle of explicitMuscles) {
			addWeightedRegions(weights, REGION_ALIASES[muscle] ?? [], sourceWeight);
		}
	}

	if (weights.size === 0) {
		const groups = (exercise.muscleGroups ?? []).map((group) =>
			String(group).trim().toUpperCase(),
		);
		const sourceWeight = groups.length > 0 ? 1 / groups.length : 0;
		for (const group of groups) {
			addWeightedRegions(weights, GROUP_ALIASES[group] ?? [], sourceWeight);
		}
	}

	const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
	if (total <= 0) return [];

	return [...weights.entries()]
		.map(([id, weight]) => ({
			id,
			weight: Number((weight / total).toFixed(6)),
		}))
		.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

const entries = source
	.map((exercise) => {
		const aliases = [
			exercise.name,
			exercise.display_name,
			...(exercise.aliases ?? []),
		]
			.filter((value) => typeof value === "string" && value.trim().length > 0)
			.map((value) => value.trim());
		const normalizedAliases = [...new Set(aliases.map(normalizeExerciseName).filter(Boolean))];
		const muscleGroups = exercise.muscle_groups ?? [];
		return {
			exerciseId: exercise.id,
			name: String(exercise.name ?? "").trim(),
			normalizedName: normalizeExerciseName(exercise.name),
			aliases: [...new Set(aliases.filter((alias) => alias !== exercise.name))],
			normalizedAliases,
			sourceMuscles: [
				...new Set([
					...(exercise.muscles ?? []).map(normalizeToken),
					...muscleGroups.map((value) => String(value).trim().toUpperCase()),
				].filter(Boolean)),
			],
			bodyMuscles: buildBodyMuscles({
				muscles: exercise.muscles,
				muscleGroups: exercise.muscle_groups,
			}),
		};
	})
	.filter((entry) => entry.name && entry.bodyMuscles.length > 0)
	.sort((a, b) => a.normalizedName.localeCompare(b.normalizedName) || a.exerciseId.localeCompare(b.exerciseId));

const content = `// This file is generated by scripts/generate-body-muscle-map.mjs.
// Source: supabase/seed-data/exercise_catalog.open.json.
// Do not edit by hand.

import type { BodyMuscleMapEntry } from "./body-muscle-analytics";

export const BODY_MUSCLE_MAP_GENERATED_AT = "${new Date().toISOString().slice(0, 10)}";

export const BODY_MUSCLE_MAP: BodyMuscleMapEntry[] = ${JSON.stringify(entries, null, "\t")};
`;

fs.writeFileSync(outputPath, content);
console.log(`Generated ${entries.length} body muscle mappings at ${path.relative(root, outputPath)}`);
