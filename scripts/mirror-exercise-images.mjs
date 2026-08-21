import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(
	root,
	"supabase",
	"seed-data",
	"exercise_catalog.open.json",
);
const cacheDir = path.join(root, "supabase", "seed-data", ".cache", "images");

const FREE_EXERCISE_IMAGE_BASE =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";
const BUCKET = "exercise-media";

function contentTypeFor(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".png") return "image/png";
	if (ext === ".webp") return "image/webp";
	if (ext === ".gif") return "image/gif";
	if (ext === ".avif") return "image/avif";
	return "image/jpeg";
}

function objectKey(id, sourceUrl) {
	const ext = path.posix.extname(new URL(sourceUrl, "https://example.invalid").pathname) || ".jpg";
	return `${id}/0${ext}`;
}

function sourceUrl(row) {
	if (!row.thumbnail_url) return null;
	if (row.source === "free-exercise-db" && row.source_id) {
		return `${FREE_EXERCISE_IMAGE_BASE}${row.source_id}/0.jpg`;
	}
	if (row.source === "wger" && row.thumbnail_url) {
		// Wger originals are not stored in the catalog JSON; operators should
		// re-run the builder (which caches wger JSON) or pass --from-cache-index.
		return null;
	}
	return null;
}

async function loadWgerImageIndex() {
	const { fetchWger } = await import("./build-open-exercise-catalog.mjs");
	const results = await fetchWger();
	const index = new Map();
	for (const info of results) {
		const images = [...(info.images ?? [])].sort(
			(a, b) => Number(b.is_main) - Number(a.is_main),
		);
		const url = images[0]?.image;
		if (url) index.set(`wger_${info.id}`, url);
	}
	if (index.size === 0) {
		throw new Error(
			"Wger image index is empty. catalog:mirror needs network access to https://wger.de/api/v2/exerciseinfo/ (or a populated supabase/seed-data/.cache/wger-exerciseinfo.json).",
		);
	}
	return index;
}

async function download(url, dest) {
	const response = await fetch(url, {
		headers: { "User-Agent": "phoenix-portal-image-mirror" },
	});
	if (!response.ok) {
		throw new Error(`GET ${url} failed: ${response.status}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.writeFileSync(dest, buffer);
	return buffer;
}

async function main() {
	const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
	const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl || !serviceKey) {
		throw new Error(
			"Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in the environment. Do not read .env files from this script.",
		);
	}
	if (!fs.existsSync(catalogPath)) {
		throw new Error("Run scripts/build-open-exercise-catalog.mjs first");
	}

	const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
	const wgerImages = await loadWgerImageIndex();
	const supabase = createClient(supabaseUrl, serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	let uploaded = 0;
	let skipped = 0;
	let failed = 0;

	for (const row of catalog) {
		const remote =
			row.source === "wger" ? wgerImages.get(row.id) : sourceUrl(row);
		if (!remote) {
			skipped += 1;
			continue;
		}
		const key = objectKey(row.id, remote);
		const dest = path.join(cacheDir, key);
		try {
			const bytes = fs.existsSync(dest)
				? fs.readFileSync(dest)
				: await download(remote, dest);
			const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
				contentType: contentTypeFor(key),
				upsert: true,
			});
			if (error) throw error;
			uploaded += 1;
			if (uploaded % 50 === 0) {
				console.log(`uploaded ${uploaded}`);
			}
		} catch (error) {
			failed += 1;
			console.warn(`failed ${row.id}: ${error.message ?? error}`);
		}
	}

	console.log(`done. uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
	if (failed > 0) process.exit(1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
