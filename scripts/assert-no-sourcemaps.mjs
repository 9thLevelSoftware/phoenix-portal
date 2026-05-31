import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const publishDir = path.resolve(process.argv[2] ?? "dist");

function collectSourcemaps(directory) {
	const sourcemaps = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			sourcemaps.push(...collectSourcemaps(fullPath));
		} else if (entry.isFile() && entry.name.endsWith(".map")) {
			sourcemaps.push(fullPath);
		}
	}

	return sourcemaps;
}

try {
	const stats = statSync(publishDir);
	if (!stats.isDirectory()) {
		throw new Error(`${publishDir} is not a directory`);
	}
} catch (error) {
	console.error(`Sourcemap assertion failed: cannot read ${publishDir}`);
	if (error instanceof Error) {
		console.error(error.message);
	}
	process.exit(1);
}

const sourcemaps = collectSourcemaps(publishDir);

if (sourcemaps.length > 0) {
	console.error(
		`Sourcemap assertion failed: ${sourcemaps.length} .map file(s) found in ${publishDir}`,
	);
	for (const file of sourcemaps.slice(0, 20)) {
		console.error(` - ${path.relative(publishDir, file)}`);
	}
	if (sourcemaps.length > 20) {
		console.error(` - ...and ${sourcemaps.length - 20} more`);
	}
	process.exit(1);
}

console.log(`No sourcemaps found in ${publishDir}`);
