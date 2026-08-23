import { spawnSync } from "node:child_process";

const denoVersion = "2.2.15";
const functionsDir = "supabase/functions";

// Handler tests use in-process doubles (no live secrets). Push/PR CI must run
// these so a green job means the axiom ran, not only `deno check`.
const testFiles = [
	`${functionsDir}/mobile-sync-push/index.test.ts`,
	`${functionsDir}/mobile-sync-pull/index.test.ts`,
];

const denoArgs = [
	"test",
	"--no-prompt",
	"--node-modules-dir=auto",
	"--config",
	`${functionsDir}/deno.json`,
	"--lock",
	`${functionsDir}/deno.lock`,
	"--allow-read",
	"--allow-env",
	"--allow-net",
	"--allow-import",
	...testFiles,
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
	console.error(`Edge Function tests failed to start: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 1);
