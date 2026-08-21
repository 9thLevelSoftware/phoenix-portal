import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cacheDir = path.join(root, "supabase", "seed-data", ".cache");
const outputJson = path.join(
	root,
	"supabase",
	"seed-data",
	"exercise_catalog.open.json",
);
const outputMeta = path.join(
	root,
	"supabase",
	"seed-data",
	"exercise_catalog.open.meta.json",
);
const outputLicenses = path.join(root, "supabase", "seed-data", "LICENSES.md");
const defaultMigration = path.join(
	root,
	"supabase",
	"migrations",
	"20260820120100_seed_open_exercise_catalog.sql",
);

const FREE_EXERCISE_URL =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const WGER_URL = "https://wger.de/api/v2/exerciseinfo/?language=2&limit=100";
const WGER_ENGLISH_LANGUAGE = 2;
const EXERCISE_MEDIA_BUCKET = "exercise-media";

const COMMON_ALIASES = {
	Barbell_Squat: ["Squat", "Back Squat"],
	Barbell_Deadlift: ["Deadlift", "Conventional Deadlift"],
	"Barbell_Bench_Press_-_Medium_Grip": ["Bench Press"],
	Barbell_Shoulder_Press: ["Shoulder Press", "Overhead Press"],
	Bent_Over_Barbell_Row: ["Bent Over Row"],
	Barbell_Curl: ["Bicep Curl"],
	Romanian_Deadlift: ["RDL"],
	Crunches: ["Crunch"],
	Plank: [],
};

const COMMON_LIFT_IDS = new Set([
	"Barbell_Squat",
	"Barbell_Bench_Press_-_Medium_Grip",
	"Bent_Over_Barbell_Row",
	"Barbell_Shoulder_Press",
	"Barbell_Curl",
	"Standing_Calf_Raises",
	"Barbell_Deadlift",
	"Barbell_Incline_Bench_Press_-_Medium_Grip",
	"Reverse_Grip_Bent-Over_Rows",
	"Side_Lateral_Raise",
	"Standing_Overhead_Barbell_Triceps_Extension",
	"Plank",
	"Front_Barbell_Squat",
	"Wide-Grip_Barbell_Bench_Press",
	"Upright_Barbell_Row",
	"Arnold_Dumbbell_Press",
	"Hammer_Curls",
	"Barbell_Shrug",
	"Face_Pull",
	"Romanian_Deadlift",
	"Barbell_Lunge",
	"Leg_Extensions",
	"One_Leg_Barbell_Squat",
	"Lying_Leg_Curls",
	"Lying_Triceps_Press",
	"Bent_Over_Two-Dumbbell_Row",
	"Glute_Kickback",
	"Crunches",
	"Good_Morning",
]);

const MUSCLE_TO_REGION = {
	abdominals: "core",
	abs: "core",
	core: "core",
	obliques: "obliques",
	chest: "chest",
	lats: "lats",
	"middle back": "upper_back",
	"upper back": "upper_back",
	"lower back": "lower_back",
	traps: "traps",
	back: "upper_back",
	shoulders: "shoulders",
	neck: "shoulders",
	deltoids: "shoulders",
	biceps: "biceps",
	triceps: "triceps",
	forearms: "forearms",
	arms: "biceps",
	quadriceps: "quads",
	quads: "quads",
	hamstrings: "hamstrings",
	calves: "calves",
	adductors: "adductors",
	abductors: "abductors",
	glutes: "glutes",
	gluteus: "glutes",
};

const REGION_TO_GROUP = {
	chest: "CHEST",
	triceps: "ARMS",
	biceps: "ARMS",
	forearms: "ARMS",
	shoulders: "SHOULDERS",
	lats: "BACK",
	upper_back: "BACK",
	traps: "BACK",
	lower_back: "BACK",
	core: "CORE",
	obliques: "CORE",
	quads: "LEGS",
	hamstrings: "LEGS",
	glutes: "LEGS",
	calves: "LEGS",
	adductors: "LEGS",
	abductors: "LEGS",
};

const CATEGORY_TO_GROUP = {
	abs: "CORE",
	abdominals: "CORE",
	core: "CORE",
	cardio: "CORE",
	stretching: "CORE",
	yoga: "CORE",
	arms: "ARMS",
	biceps: "ARMS",
	triceps: "ARMS",
	back: "BACK",
	lats: "BACK",
	calves: "LEGS",
	legs: "LEGS",
	glutes: "LEGS",
	chest: "CHEST",
	shoulders: "SHOULDERS",
};

const GROUP_TO_DEFAULT_REGION = {
	CHEST: "chest",
	ARMS: "biceps",
	SHOULDERS: "shoulders",
	BACK: "upper_back",
	CORE: "core",
	LEGS: "quads",
};

const EQUIPMENT_MAP = {
	barbell: "BARBELL",
	dumbbell: "DUMBBELL",
	cable: "CABLE",
	machine: "MACHINE",
	"body only": "BODYWEIGHT",
	bodyweight: "BODYWEIGHT",
	kettlebells: "KETTLEBELL",
	kettlebell: "KETTLEBELL",
	bands: "BANDS",
	"e-z curl bar": "EZ_BAR",
	"ez curl bar": "EZ_BAR",
	"medicine ball": "MEDICINE_BALL",
	"exercise ball": "EXERCISE_BALL",
	"foam roll": "FOAM_ROLL",
	bench: "BENCH",
	"pull-up bar": "PULL_UP_BAR",
	none: "BODYWEIGHT",
	other: "OTHER",
};

function parseArgs(argv) {
	const args = { check: false, writeMigration: false, migrationPath: defaultMigration };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--check") args.check = true;
		else if (arg === "--write-migration") args.writeMigration = true;
		else if (arg === "--migration-path") args.migrationPath = argv[++i];
	}
	return args;
}

function imageBase() {
	return EXERCISE_MEDIA_BUCKET;
}

export function normalizeCatalogKey(name) {
	return String(name ?? "")
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.replace(/[-_/]+/g, " ")
		.replace(/[^a-z0-9\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function htmlToText(html) {
	return String(html ?? "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function mapMuscle(raw) {
	const key = String(raw ?? "")
		.trim()
		.toLowerCase();
	return MUSCLE_TO_REGION[key] ?? null;
}

function muscleGroupsFromRegions(regions) {
	return [
		...new Set(regions.map((region) => REGION_TO_GROUP[region]).filter(Boolean)),
	];
}

function groupFromCategory(movement) {
	const key = String(movement ?? "")
		.trim()
		.toLowerCase();
	if (!key) return null;
	const fromMuscle = mapMuscle(key);
	if (fromMuscle && REGION_TO_GROUP[fromMuscle]) {
		return REGION_TO_GROUP[fromMuscle];
	}
	return CATEGORY_TO_GROUP[key] ?? null;
}

function mapEquipment(raw) {
	if (!raw) return [];
	const parts = String(raw)
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
	const mapped = parts.map((part) => EQUIPMENT_MAP[part] ?? "OTHER");
	return [...new Set(mapped)];
}

function sidednessFromName(name) {
	const n = String(name ?? "").toLowerCase();
	if (/\balternating\b/.test(n)) return "alternating";
	if (/\b(single|unilateral|one[- ]arm|one[- ]leg)\b/.test(n)) return "unilateral";
	if (/\b(double|bilateral|two[- ]arm)\b/.test(n)) return "bilateral";
	return null;
}

function titleCase(value) {
	return String(value ?? "")
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function readCacheOrFetch(cacheName, url, fetcher) {
	fs.mkdirSync(cacheDir, { recursive: true });
	const cachePath = path.join(cacheDir, cacheName);
	if (fs.existsSync(cachePath)) {
		return JSON.parse(fs.readFileSync(cachePath, "utf8"));
	}
	const data = await fetcher(url);
	fs.writeFileSync(cachePath, JSON.stringify(data));
	return data;
}

async function fetchJson(url) {
	const response = await fetch(url, {
		headers: { Accept: "application/json", "User-Agent": "phoenix-portal-catalog-builder" },
	});
	if (!response.ok) {
		throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
	}
	return response.json();
}

async function fetchFreeExerciseDb() {
	return readCacheOrFetch("free-exercise-db.json", FREE_EXERCISE_URL, fetchJson);
}

export async function fetchWger() {
	const cachePath = path.join(cacheDir, "wger-exerciseinfo.json");
	if (fs.existsSync(cachePath)) {
		return JSON.parse(fs.readFileSync(cachePath, "utf8"));
	}
	const results = [];
	let next = WGER_URL;
	while (next) {
		const page = await fetchJson(next);
		results.push(...(page.results ?? []));
		next = page.next ?? null;
	}
	fs.mkdirSync(cacheDir, { recursive: true });
	fs.writeFileSync(cachePath, JSON.stringify(results));
	return results;
}

function displayNamesForFreeExercises(exercises) {
	const grouped = new Map();
	for (const exercise of exercises) {
		const key = String(exercise.name ?? "")
			.trim()
			.toLowerCase();
		const group = grouped.get(key) ?? [];
		group.push(exercise);
		grouped.set(key, group);
	}
	const names = new Map();
	for (const exercise of exercises) {
		const key = String(exercise.name ?? "")
			.trim()
			.toLowerCase();
		const siblings = grouped.get(key) ?? [exercise];
		const equipment = titleCase(exercise.equipment ?? "");
		if (siblings.length > 1 && equipment) {
			names.set(exercise.id, `${exercise.name.trim()} (${equipment})`);
		} else {
			names.set(exercise.id, String(exercise.name ?? "").trim());
		}
	}
	return names;
}

function thumbnailUrl(id, imagePath) {
	if (!imagePath) return null;
	return `${id}/0${path.posix.extname(String(imagePath).split("?")[0]) || ".jpg"}`;
}

function toCatalogRow({
	id,
	name,
	displayName,
	description,
	instructions,
	primaryMuscles,
	secondaryMuscles,
	equipmentRaw,
	movement,
	source,
	sourceId,
	license,
	licenseAuthor,
	licenseUrl,
	imagePath,
}) {
	const regions = [...primaryMuscles, ...secondaryMuscles]
		.map(mapMuscle)
		.filter(Boolean);
	const uniqueRegions = [...new Set(regions)];
	let groups = muscleGroupsFromRegions(uniqueRegions);
	if (groups.length === 0) {
		const fromCategory = groupFromCategory(movement);
		if (fromCategory) groups = [fromCategory];
	}
	if (groups.length === 0) groups = ["CORE"];
	const muscles =
		uniqueRegions.length > 0
			? uniqueRegions
			: [GROUP_TO_DEFAULT_REGION[groups[0]]].filter(Boolean);
	const equipment = mapEquipment(equipmentRaw);
	return {
		id,
		name,
		display_name: displayName,
		description: description || null,
		muscle_group: groups[0],
		muscle_groups: groups,
		muscles,
		equipment,
		movement: movement ?? null,
		sidedness: sidednessFromName(name),
		grip: null,
		grip_width: null,
		default_cable_config: "EITHER",
		min_rep_range: null,
		popularity: COMMON_LIFT_IDS.has(id) ? 1 : 0,
		aliases: COMMON_ALIASES[id] ?? [],
		thumbnail_url: thumbnailUrl(id, imagePath),
		archived: false,
		is_custom: false,
		user_id: null,
		source,
		source_id: sourceId,
		license,
		license_author: licenseAuthor,
		license_url: licenseUrl,
		instructions: instructions ?? [],
		image_path: imagePath ?? null,
	};
}

function buildFromFreeExercise(exercises) {
	const displayNames = displayNamesForFreeExercises(exercises);
	return exercises
		.filter((exercise) => exercise?.id && exercise?.name)
		.map((exercise) =>
			toCatalogRow({
				id: exercise.id,
				name: String(exercise.name).trim(),
				displayName: displayNames.get(exercise.id) ?? String(exercise.name).trim(),
				description: (exercise.instructions ?? []).join("\n") || null,
				instructions: exercise.instructions ?? [],
				primaryMuscles: exercise.primaryMuscles ?? [],
				secondaryMuscles: exercise.secondaryMuscles ?? [],
				equipmentRaw: exercise.equipment,
				movement: exercise.category ?? null,
				source: "free-exercise-db",
				sourceId: exercise.id,
				license: "Unlicense",
				licenseAuthor: null,
				licenseUrl: "https://github.com/yuhonas/free-exercise-db",
				imagePath: exercise.images?.[0] ?? null,
			}),
		);
}

function buildFromWger(results, existingIds, existingNames) {
	const rows = [];
	const authors = new Set();
	for (const info of results) {
		const translation =
			(info.translations ?? []).find((item) => item.language === WGER_ENGLISH_LANGUAGE) ??
			info.translations?.[0];
		const name = translation?.name?.trim();
		if (!name) continue;
		const id = `wger_${info.id}`;
		const nameKey = normalizeCatalogKey(name);
		if (existingIds.has(id) || existingNames.has(nameKey)) continue;
		const licenseName =
			info.license?.short_name || info.license?.full_name || "CC-BY-SA 4.0";
		const author = info.license_author?.trim() || null;
		if (author) authors.add(author);
		const images = [...(info.images ?? [])].sort(
			(a, b) => Number(b.is_main) - Number(a.is_main),
		);
		rows.push(
			toCatalogRow({
				id,
				name,
				displayName: name,
				description: htmlToText(translation?.description),
				instructions: [],
				primaryMuscles: (info.muscles ?? []).map((m) => m.name_en || m.name),
				secondaryMuscles: (info.muscles_secondary ?? []).map(
					(m) => m.name_en || m.name,
				),
				equipmentRaw: (info.equipment ?? []).map((item) => item.name).join(","),
				movement: info.category?.name ?? null,
				source: "wger",
				sourceId: String(info.id),
				license: licenseName,
				licenseAuthor: author,
				licenseUrl: "https://wger.de/en/software/api",
				imagePath: images[0]?.image ?? null,
			}),
		);
		existingIds.add(id);
		existingNames.add(normalizeCatalogKey(name));
	}
	return { rows, authors: [...authors].sort() };
}

function sqlLiteral(value) {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (typeof value === "number") {
		return Number.isFinite(value) ? String(value) : "NULL";
	}
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(values) {
	if (!values || values.length === 0) return `'{}'::text[]`;
	return `ARRAY[${values.map(sqlLiteral).join(",")}]::text[]`;
}

function toInsertTuple(row) {
	return `(${[
		sqlLiteral(row.id),
		sqlLiteral(row.name),
		sqlLiteral(row.display_name),
		sqlLiteral(row.description),
		sqlLiteral(row.muscle_group),
		sqlTextArray(row.muscle_groups),
		sqlTextArray(row.muscles),
		sqlTextArray(row.equipment),
		sqlLiteral(row.movement),
		sqlLiteral(row.sidedness),
		sqlLiteral(row.grip),
		sqlLiteral(row.grip_width),
		sqlLiteral(row.default_cable_config),
		sqlLiteral(row.min_rep_range),
		sqlLiteral(row.popularity),
		sqlTextArray(row.aliases),
		sqlLiteral(row.thumbnail_url),
		sqlLiteral(row.archived),
		sqlLiteral(row.is_custom),
		"NULL",
		sqlLiteral(row.source),
		sqlLiteral(row.source_id),
		sqlLiteral(row.license),
		sqlLiteral(row.license_author),
		sqlLiteral(row.license_url),
	].join(",")})`;
}

function writeMigration(rows, filePath) {
	const header = `-- Additive open-source exercise_catalog seed.
-- Generated by scripts/build-open-exercise-catalog.mjs.
-- Idempotent: ON CONFLICT (id) DO UPDATE. Does not delete legacy rows.
-- Archives leftover library rows (source IS NULL, not custom) so the picker
-- hides them while old mobile IDs remain valid FK targets.

INSERT INTO exercise_catalog (
  id, name, display_name, description, muscle_group, muscle_groups, muscles,
  equipment, movement, sidedness, grip, grip_width, default_cable_config,
  min_rep_range, popularity, aliases, thumbnail_url, archived, is_custom,
  user_id, source, source_id, license, license_author, license_url
) VALUES
`;
	const values = rows.map((row) => toInsertTuple(row)).join(",\n");
	const footer = `
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  muscle_group = EXCLUDED.muscle_group,
  muscle_groups = EXCLUDED.muscle_groups,
  muscles = EXCLUDED.muscles,
  equipment = EXCLUDED.equipment,
  movement = EXCLUDED.movement,
  sidedness = EXCLUDED.sidedness,
  default_cable_config = EXCLUDED.default_cable_config,
  popularity = EXCLUDED.popularity,
  aliases = EXCLUDED.aliases,
  thumbnail_url = EXCLUDED.thumbnail_url,
  archived = EXCLUDED.archived,
  source = EXCLUDED.source,
  source_id = EXCLUDED.source_id,
  license = EXCLUDED.license,
  license_author = EXCLUDED.license_author,
  license_url = EXCLUDED.license_url,
  updated_at = NOW();

UPDATE exercise_catalog
SET archived = TRUE
WHERE is_custom = FALSE
  AND source IS NULL;
`;
	fs.writeFileSync(filePath, `${header}${values}${footer}`);
}

function writeLicenses(authors) {
	const authorList =
		authors.length > 0
			? authors.map((author) => `- ${author}`).join("\n")
			: "- (see wger exerciseinfo license_author per row)";
	const content = `# Exercise catalogue licenses

## free-exercise-db

Source: https://github.com/yuhonas/free-exercise-db

This is free and unencumbered software released into the public domain (Unlicense).
See http://unlicense.org/

## wger

Source: https://wger.de/api/v2/exerciseinfo/

Exercise entries from wger are licensed under Creative Commons Attribution-ShareAlike 4.0
International (CC-BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/

Authors recorded at generation time:

${authorList}

The merged catalog JSON in this directory is therefore shared under CC-BY-SA 4.0
where it includes wger rows. Application source code is not.
`;
	fs.writeFileSync(outputLicenses, content);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const freeExercises = await fetchFreeExerciseDb();
	if (!Array.isArray(freeExercises)) {
		throw new Error("free-exercise-db payload was not an array");
	}
	const freeRows = buildFromFreeExercise(freeExercises);
	const existingIds = new Set(freeRows.map((row) => row.id));
	const existingNames = new Set(freeRows.map((row) => normalizeCatalogKey(row.name)));
	const wgerResults = await fetchWger();
	const wger = buildFromWger(wgerResults, existingIds, existingNames);
	const rows = [...freeRows, ...wger.rows].sort((a, b) =>
		a.id.localeCompare(b.id),
	);

	const serializable = rows.map(({ image_path: _imagePath, ...row }) => row);
	const json = `${JSON.stringify(serializable, null, 2)}\n`;
	if (args.check) {
		if (!fs.existsSync(outputJson)) {
			throw new Error("exercise_catalog.open.json is missing");
		}
		const existing = fs.readFileSync(outputJson, "utf8");
		if (existing !== json) {
			throw new Error("exercise_catalog.open.json is stale; re-run without --check");
		}
		console.log(`check ok: ${rows.length} catalog rows`);
		return;
	}

	fs.mkdirSync(path.dirname(outputJson), { recursive: true });
	fs.writeFileSync(outputJson, json);
	fs.writeFileSync(
		outputMeta,
		`${JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				imageBase: imageBase(),
				counts: {
					total: rows.length,
					freeExerciseDb: freeRows.length,
					wger: wger.rows.length,
				},
			},
			null,
			2,
		)}\n`,
	);
	writeLicenses(wger.authors);
	if (args.writeMigration) {
		writeMigration(rows, args.migrationPath);
		console.log(`Wrote migration ${path.relative(root, args.migrationPath)}`);
	}
	console.log(
		`Wrote ${rows.length} exercises (${freeRows.length} free-exercise-db, ${wger.rows.length} wger)`,
	);
}

const isDirect =
	process.argv[1] &&
	path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url));
if (isDirect) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
