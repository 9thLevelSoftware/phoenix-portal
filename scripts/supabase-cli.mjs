#!/usr/bin/env node
/**
 * Run the pinned Supabase CLI: `node scripts/supabase-cli.mjs <args...>`
 * (`npm run supabase -- <args>`, and `npm run test:db` -> `supabase test db`).
 *
 * The pin lives in `.supabase-cli-version` at the repo root. It is the single
 * source for this runner, scripts/gen-types.mjs and the setup-cli step of
 * .github/workflows/migrations.yml. Different CLI versions emit different
 * generated types, so local runs and CI must use the same version.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export function readSupabaseCliPin() {
	const pin = readFileSync(
		path.join(repoRoot, ".supabase-cli-version"),
		"utf8",
	).trim();
	if (!/^\d+\.\d+\.\d+$/.test(pin)) {
		throw new Error(
			`.supabase-cli-version must hold a plain x.y.z version (got "${pin}").`,
		);
	}
	return pin;
}

const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
	const pin = readSupabaseCliPin();
	const child = spawn(
		"npx",
		["--yes", `supabase@${pin}`, ...process.argv.slice(2)],
		{
			cwd: repoRoot,
			stdio: "inherit",
			// Windows requires shell: true to resolve the npx .cmd shim.
			shell: process.platform === "win32",
		},
	);
	child.on("error", (error) => {
		console.error(`supabase-cli: failed to spawn npx: ${error.message}`);
		process.exit(1);
	});
	child.on("close", (code) => process.exit(code ?? 1));
}
