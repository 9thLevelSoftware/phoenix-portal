import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const denoVersion = "2.2.15";
const functionsDir = "supabase/functions";

// Type-check every edge function entrypoint, not just a hand-picked subset, so
// type regressions (e.g. `never` payload collapse, unsafe casts) are caught in
// CI before deployment. Entrypoints are `supabase/functions/<name>/index.ts`.
function discoverEntrypoints() {
	const entries = readdirSync(functionsDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
		.map((entry) => join(functionsDir, entry.name, "index.ts"))
		.filter((path) => existsSync(path))
		.sort();
}

const denoArgs = [
	"check",
	"--node-modules-dir=auto",
	"--config",
	`${functionsDir}/deno.json`,
	...discoverEntrypoints(),
];

function run(command, args, options = {}) {
	return spawnSync(command, args, { stdio: "inherit", ...options });
}

let result = run("deno", denoArgs);

if (result.error?.code === "ENOENT") {
	console.warn(
		`Deno is not available on PATH; falling back to \`npx -y deno@${denoVersion}\`.`,
	);
	result = run("npx", ["-y", `deno@${denoVersion}`, ...denoArgs], {
		shell: process.platform === "win32",
	});
}

if (result.error) {
	console.error(`Edge Function check failed to start: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
