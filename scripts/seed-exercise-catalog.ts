/**
 * Upsert exercise_catalog from the generated open-source JSON.
 *
 * Usage:
 *   npx tsx scripts/seed-exercise-catalog.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import catalog from "../supabase/seed-data/exercise_catalog.open.json";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
	const rows = (catalog as Array<Record<string, unknown>>).map((row) => ({
		id: row.id,
		name: row.name,
		display_name: row.display_name,
		description: row.description ?? null,
		muscle_group: row.muscle_group,
		muscle_groups: row.muscle_groups,
		muscles: row.muscles ?? [],
		equipment: row.equipment,
		movement: row.movement ?? null,
		sidedness: row.sidedness ?? null,
		grip: row.grip ?? null,
		grip_width: row.grip_width ?? null,
		default_cable_config: row.default_cable_config ?? "EITHER",
		min_rep_range: row.min_rep_range ?? null,
		popularity: row.popularity ?? 0,
		aliases: row.aliases ?? [],
		thumbnail_url: row.thumbnail_url ?? null,
		archived: false,
		is_custom: false,
		user_id: null,
		source: row.source,
		source_id: row.source_id,
		license: row.license,
		license_author: row.license_author,
		license_url: row.license_url,
	}));

	console.log(`Upserting ${rows.length} open-catalog exercises...`);
	const BATCH_SIZE = 200;
	let upserted = 0;
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		const { error } = await supabase
			.from("exercise_catalog")
			.upsert(batch, { onConflict: "id" });
		if (error) {
			console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error);
			process.exit(1);
		}
		upserted += batch.length;
		console.log(`  Upserted ${upserted}/${rows.length}`);
	}

	const { error: archiveError } = await supabase
		.from("exercise_catalog")
		.update({ archived: true })
		.eq("is_custom", false)
		.is("source", null);
	if (archiveError) {
		console.error("Failed to archive legacy library rows:", archiveError);
		process.exit(1);
	}

	console.log("Done.");
}

main().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
