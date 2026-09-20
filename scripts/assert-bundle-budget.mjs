// Post-build budget check for the PWA precache and the CSV/body-map split
// (brownfield F-087). Run after `vite build`:
//   node scripts/assert-bundle-budget.mjs [dist]
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.argv[2] ?? "dist");
const PRECACHE_BUDGET_BYTES = 2 * 1024 * 1024;
const CSV_CHUNK_BUDGET_BYTES = 100 * 1000;
const NEVER_PRECACHE = [
	/(^|\/)vendor-echarts-/,
	/(^|\/)vendor-recharts-/,
	/(^|\/)vendor-visx-/,
	/(^|\/)csv-/,
	/(^|\/)body-muscle-analytics-/,
	/(^|\/)phoenix-hero\./,
];

const failures = [];
const kib = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;

let sw;
try {
	sw = readFileSync(path.join(distDir, "sw.js"), "utf8");
} catch {
	console.error(`Bundle budget failed: cannot read ${distDir}/sw.js`);
	process.exit(1);
}

const precached = [...new Set([...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]))];
if (precached.length === 0) {
	failures.push("no precache entries found in sw.js");
}
let precacheBytes = 0;
for (const url of precached) {
	try {
		precacheBytes += statSync(path.join(distDir, url)).size;
	} catch {
		failures.push(`precached file missing from dist: ${url}`);
	}
	if (NEVER_PRECACHE.some((pattern) => pattern.test(url))) {
		failures.push(`heavy/lazy file is precached: ${url}`);
	}
}
if (precacheBytes >= PRECACHE_BUDGET_BYTES) {
	failures.push(
		`precache ${kib(precacheBytes)} exceeds budget ${kib(PRECACHE_BUDGET_BYTES)}`,
	);
}

const assetsDir = path.join(distDir, "assets");
const jsFiles = readdirSync(assetsDir).filter((file) => file.endsWith(".js"));
const csvChunks = jsFiles.filter((file) => /^csv-.*\.js$/.test(file));
for (const file of csvChunks) {
	const size = statSync(path.join(assetsDir, file)).size;
	if (size >= CSV_CHUNK_BUDGET_BYTES) {
		failures.push(`${file} is ${size} bytes (budget < ${CSV_CHUNK_BUDGET_BYTES})`);
	}
}

// The body-muscle map chunk may only be reached through a dynamic import().
const bodyChunks = jsFiles.filter((file) => file.startsWith("body-muscle-analytics-"));
if (bodyChunks.length !== 1) {
	failures.push(
		`expected exactly one body-muscle-analytics chunk, found ${bodyChunks.length}`,
	);
}
for (const bodyChunk of bodyChunks) {
	const escaped = bodyChunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const staticImport = new RegExp(
		`(?:import|from)\\s*["']\\./${escaped}["']`,
	);
	for (const file of jsFiles) {
		if (file === bodyChunk) continue;
		const code = readFileSync(path.join(assetsDir, file), "utf8");
		if (staticImport.test(code)) {
			failures.push(`${file} statically imports ${bodyChunk}`);
		}
	}
}

if (failures.length > 0) {
	console.error("Bundle budget failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log(
	`Bundle budget OK: precache ${precached.length} entries, ${kib(precacheBytes)}; ` +
		`csv ${csvChunks.map((f) => `${f} ${statSync(path.join(assetsDir, f)).size} B`).join(", ") || "(none)"}; ` +
		`body map ${bodyChunks.join(", ")} (dynamic only)`,
);
