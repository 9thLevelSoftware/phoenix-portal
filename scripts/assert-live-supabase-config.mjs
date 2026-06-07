#!/usr/bin/env node
/**
 * Build-time guard for Issue #68: refuse to ship known-stale Supabase
 * project refs in the Portal repo.
 *
 * The Portal previously hardcoded the project ref `ilzlswmatadlnsuxatcv`
 * (now deleted) in executable scripts (`package.json`) and in shipped
 * headers (`public/_headers`). That stale ref caused /auth/v1/settings to
 * NXDOMAIN, which in turn hid the Portal's social-auth buttons.
 *
 * This script scans the surface that ships to production -- `package.json`
 * (executable scripts), `public/_headers` (Cloudflare Pages CSP), and the
 * built `dist/` directory if present -- and fails the build if any of those
 * files still reference a stale ref. The denylist can be overridden via
 * the `STALE_SUPABASE_REFS` env var (comma-separated).
 *
 * Scope notes:
 *   - Test fixtures under `src/lib/__tests__/` and `tests/sync/` are
 *     deliberately NOT scanned. They legitimately use arbitrary project
 *     refs as hostname test data and are not shipped artifacts.
 *   - Historical docs (e.g. `docs/plans/*.md`) are out of scope by design:
 *     updating them would rewrite project history without preventing the
 *     bug from recurring.
 *
 * Exit code:
 *   0  no stale refs found (or no scanned files present)
 *   1  stale refs found; actionable error printed to stderr
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** Default denylist of known-dead Supabase project refs. */
const DEFAULT_STALE_REFS = ["ilzlswmatadlnsuxatcv"];

function loadStaleRefs() {
	const fromEnv = process.env.STALE_SUPABASE_REFS?.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	const refs = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STALE_REFS;
	const invalidRefs = refs.filter((ref) => !/^[a-z0-9]{20}$/i.test(ref));
	if (invalidRefs.length > 0) {
		throw new Error(
			`STALE_SUPABASE_REFS entries must be 20-character Supabase project refs; invalid value(s): ${invalidRefs.join(", ")}`,
		);
	}
	return refs;
}

/** Matches a Supabase project ref of the form `<20 alnum chars>.supabase.co`. */
const SUPABASE_HOSTNAME_PATTERN = /[a-z0-9]{20}\.supabase\.co/gi;
const BINARY_EXTENSIONS = new Set([
	".avif",
	".eot",
	".gif",
	".gz",
	".ico",
	".jpeg",
	".jpg",
	".mp3",
	".mp4",
	".otf",
	".pdf",
	".png",
	".ttf",
	".wav",
	".webp",
	".woff",
	".woff2",
	".zip",
]);

/**
 * Extract all Supabase project refs referenced in `content`. Useful for
 * surfacing every env-coupled hostname in one place (e.g. when auditing CSP
 * or an extracted bundle). Returns refs in first-seen order, deduplicated.
 */
export function extractSupabaseRefs(content) {
	const refs = [];
	const seen = new Set();
	for (const match of content.matchAll(SUPABASE_HOSTNAME_PATTERN)) {
		const ref = match[0].split(".")[0].toLowerCase();
		if (seen.has(ref)) continue;
		seen.add(ref);
		refs.push(ref);
	}
	return refs;
}

/**
 * Return any refs in `content` that are known to be dead. Pass an explicit
 * `staleRefs` list to override the default denylist.
 */
export function findDeadSupabaseRefs(content, staleRefs = DEFAULT_STALE_REFS) {
	const present = extractSupabaseRefs(content);
	const dead = new Set(staleRefs.map((ref) => ref.toLowerCase()));
	return present.filter((ref) => dead.has(ref));
}

/**
 * Throw an actionable Error if `content` references any dead Supabase
 * project ref. `fileLabel` is included in the error message so callers
 * (e.g. the dist walker) can point operators at the offending artifact.
 */
export function assertNoDeadSupabaseRefs(content, fileLabel) {
	const dead = findDeadSupabaseRefs(content);
	if (dead.length === 0) return;
	const refsList = dead.map((ref) => `"${ref}"`).join(", ");
	throw new Error(
		`${fileLabel} contains dead Supabase project ref(s) ${refsList}. ` +
			`Replace with a live ref or the env-neutral \`https://*.supabase.co\` pattern. ` +
			`See issue #68 for context.`,
	);
}

/** Files that ship to production and therefore must not contain stale refs. */
const SCAN_TARGETS = [
	{ relativePath: "package.json", description: "executable npm scripts" },
	{ relativePath: "public/_headers", description: "Cloudflare Pages CSP" },
];

/** Dist directory is scanned only if it exists (post-build). */
function maybeScanDist(staleRefs) {
	const distDir = path.join(repoRoot, "dist");
	if (!existsSync(distDir)) {
		return [];
	}
	try {
		if (!statSync(distDir).isDirectory()) {
			return [];
		}
	} catch {
		return [];
	}
	return [
		{
			relativePath: "dist/",
			description: "built artifacts",
			isDirectory: true,
		},
	];
}

/** Find all line numbers in `content` that contain any of the `staleRefs`. */
export function findStaleRefMatches(content, staleRefs) {
	const matches = [];
	const lines = content.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const refsOnLine = findDeadSupabaseRefs(line, staleRefs);
		for (const ref of refsOnLine) {
			matches.push({ lineNumber: index + 1, ref, line });
		}
	}
	return matches;
}

function formatMatch({ file, lineNumber, ref, line }) {
	// Trim the matched line for readability but keep enough context to be
	// actionable (200 chars max).
	const snippet = line.length > 200 ? `${line.slice(0, 197)}...` : line;
	return `  ${file.relativePath}:${lineNumber}: stale ref "${ref}" -- ${snippet}`;
}

function formatDistRelative(relativePath) {
	// Trim the dist/ prefix from the reported path; the caller already
	// labels it as "built artifacts".
	return relativePath.startsWith(`dist${path.sep}`)
		? relativePath.slice(`dist${path.sep}`.length)
		: relativePath;
}

function scanFile(absolutePath, file, staleRefs) {
	let content;
	try {
		content = readFileSync(absolutePath, "utf8");
	} catch (error) {
		console.error(
			`assert-live-supabase-config: failed to read ${file.relativePath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return [];
	}
	const matches = findStaleRefMatches(content, staleRefs);
	return matches.map((match) => ({ file, ...match }));
}

function walkDirectory(absoluteDir, rootRelative, staleRefs, collected) {
	for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
		const fullPath = path.join(absoluteDir, entry.name);
		const relativePath = `${rootRelative}${path.sep}${entry.name}`;
		if (entry.isDirectory()) {
			walkDirectory(fullPath, relativePath, staleRefs, collected);
		} else if (entry.isFile()) {
			// Skip sourcemaps (those are caught by assert:no-sourcemaps) and
			// binary assets copied into dist/; stale Supabase hostnames can only
			// affect shipped text config, HTML, CSS, or JS.
			if (entry.name.endsWith(".map")) continue;
			if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
				continue;
			}
			const matches = scanFile(
				fullPath,
				{ relativePath: formatDistRelative(relativePath), description: "built artifacts" },
				staleRefs,
			);
			collected.push(...matches);
		}
	}
}

function main() {
	let staleRefs;
	try {
		staleRefs = loadStaleRefs();
	} catch (error) {
		console.error(
			`assert-live-supabase-config: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
	const distTargets = maybeScanDist(staleRefs);
	const allTargets = [...SCAN_TARGETS, ...distTargets];

	const allMatches = [];

	for (const target of allTargets) {
		const absolutePath = path.join(repoRoot, target.relativePath);
		if (target.isDirectory) {
			walkDirectory(absolutePath, target.relativePath, staleRefs, allMatches);
		} else {
			if (!existsSync(absolutePath)) {
				// Public/_headers is a non-fatal optional target (some local
				// checkouts may not have it). package.json MUST exist.
				if (target.relativePath === "package.json") {
					console.error(
						`assert-live-supabase-config: required file ${target.relativePath} is missing.`,
					);
					process.exit(1);
				}
				continue;
			}
			allMatches.push(...scanFile(absolutePath, target, staleRefs));
		}
	}

	if (allMatches.length === 0) {
		const scannedCount = allTargets.length;
		console.log(
			`assert-live-supabase-config: no stale Supabase refs (${staleRefs.join(", ")}) found in ${scannedCount} target(s).`,
		);
		return;
	}

	console.error(
		`assert-live-supabase-config: FAILED -- found ${allMatches.length} stale Supabase ref occurrence(s).`,
	);
	console.error(
		"This usually means a deleted Supabase project ref (e.g. ilzlswmatadlnsuxatcv) was reintroduced into",
	);
	console.error(
		"an executable script or shipped header. Re-check the following lines and update or remove them:",
	);
	for (const match of allMatches) {
		console.error(formatMatch(match));
	}
	console.error("");
	console.error("How to fix:");
	console.error("  1. Replace the stale ref with `https://*.supabase.co` (env-neutral) in CSP,");
	console.error("     or use a real ref loaded from VITE_SUPABASE_URL at build time.");
	console.error("  2. Move the literal hostname into a test fixture under src/lib/__tests__/");
	console.error("     or tests/sync/ (those are not scanned by this guard).");
	console.error("  3. If the ref is intentional, override the denylist via STALE_SUPABASE_REFS");
	console.error("     (comma-separated) and re-run.");
	process.exit(1);
}

const isMainModule =
	process.argv[1] != null &&
	pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
	main();
}
