import { spawnSync } from "node:child_process";

const denoVersion = "2.2.15";

const denoArgs = [
	"check",
	"--config",
	"supabase/functions/deno.json",
	"supabase/functions/mobile-sync-push/index.ts",
	"supabase/functions/mobile-sync-pull/index.ts",
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
