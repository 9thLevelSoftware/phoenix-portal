/**
 * Seed the exercise_catalog table from exercise_dump.json.
 *
 * Usage:
 *   npx tsx scripts/seed-exercise-catalog.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { equipmentDisplayMap } from "../src/schemas/transforms";
import exerciseDump from "../supabase/seed-data/exercise_dump.json";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface RawExercise {
	id: string;
	name: string;
	description?: string;
	muscleGroups: string[];
	muscles?: string[];
	equipment: string[];
	movement?: string | null;
	sidedness?: string | null;
	grip?: string | null;
	gripWidth?: string | null;
	aliases?: string[];
	archived?: string | null;
	range?: { minimum?: number } | null;
	popularity?: number;
	videos?: Array<{ thumbnail?: string }>;
}

function generateDisplayNames(exercises: RawExercise[]): Map<string, string> {
	const groups = new Map<string, RawExercise[]>();
	for (const ex of exercises) {
		const key = ex.name.trim().toLowerCase();
		const group = groups.get(key) ?? [];
		group.push(ex);
		groups.set(key, group);
	}

	const result = new Map<string, string>();
	for (const ex of exercises) {
		const key = ex.name.trim().toLowerCase();
		const siblings = groups.get(key) ?? [ex];
		if (siblings.length > 1 && ex.equipment.length > 0) {
			const primaryEquip = ex.equipment[0];
			const label =
				equipmentDisplayMap[primaryEquip] ??
				primaryEquip
					.toLowerCase()
					.replace(/_/g, " ")
					.replace(/\b\w/g, (c) => c.toUpperCase());
			result.set(ex.id, `${ex.name.trim()} (${label})`);
		} else {
			result.set(ex.id, ex.name.trim());
		}
	}
	return result;
}

async function main() {
	const exercises = exerciseDump as RawExercise[];
	const displayNames = generateDisplayNames(exercises);

	console.log(`Processing ${exercises.length} exercises...`);

	const active = exercises.filter((e) => !e.archived);
	const archived = exercises.filter((e) => !!e.archived);
	console.log(`Active: ${active.length}, Archived: ${archived.length}`);

	const rows = exercises.map((ex) => ({
		id: ex.id,
		name: ex.name.trim(),
		display_name: displayNames.get(ex.id) ?? ex.name.trim(),
		description: ex.description || null,
		muscle_group: ex.muscleGroups[0] ?? "General",
		muscle_groups: ex.muscleGroups,
		muscles: ex.muscles ?? [],
		equipment: ex.equipment,
		movement: ex.movement ?? null,
		sidedness: ex.sidedness ?? null,
		grip: ex.grip ?? null,
		grip_width: ex.gripWidth ?? null,
		default_cable_config: "DOUBLE",
		min_rep_range: ex.range?.minimum ?? null,
		popularity: ex.popularity ?? 0,
		aliases: ex.aliases ?? [],
		thumbnail_url: ex.videos?.[0]?.thumbnail ?? null,
		archived: !!ex.archived,
		is_custom: false,
		user_id: null,
	}));

	const BATCH_SIZE = 200;
	let inserted = 0;
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		const { error } = await supabase
			.from("exercise_catalog")
			.upsert(batch, { onConflict: "id" });

		if (error) {
			console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error);
			process.exit(1);
		}
		inserted += batch.length;
		console.log(`  Inserted ${inserted}/${rows.length}`);
	}

	const { count, error: countError } = await supabase
		.from("exercise_catalog")
		.select("*", { count: "exact", head: true });

	if (countError) {
		console.error("Verification failed:", countError);
		process.exit(1);
	}

	console.log(`\nDone. exercise_catalog now has ${count} rows.`);

	const disambiguated = [...displayNames.values()].filter((dn) =>
		dn.includes("("),
	);
	console.log(
		`${disambiguated.length} exercises have disambiguated display names.`,
	);
}

main().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
