#!/usr/bin/env node
/**
 * Regenerate src/lib/database.types.ts from the configured Supabase project.
 *
 * Issue #68: the previous `gen:types` script hardcoded a stale Supabase
 * project ref (`ilzlswmatadlnsuxatcv`) that has since been deleted. To prevent
 * recurrence we require the project ref to be supplied via the
 * `SUPABASE_PROJECT_REF` environment variable (loaded from `.env` /
 * `.env.local`, or exported by the operator). This shim performs the
 * env-var check and then shells out to the official Supabase CLI.
 *
 * Usage:
 *   SUPABASE_PROJECT_REF=abcdefghijklmnopqrst npm run gen:types
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Best-effort .env loading so local developers don't need to export the
// variable manually. We deliberately do NOT add a default here: the only
// safe behavior when SUPABASE_PROJECT_REF is missing is to refuse to run.
for (const relativePath of [".env", ".env.local"]) {
	const dotenvPath = path.join(repoRoot, relativePath);
	if (existsSync(dotenvPath)) {
		loadDotenv({ path: dotenvPath, override: false });
	}
}

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();

if (!projectRef) {
	console.error(
		"gen:types: SUPABASE_PROJECT_REF is not set.\n" +
			"  Set it in your shell or .env (e.g. SUPABASE_PROJECT_REF=abcdefghijklmnopqrst).\n" +
			"  No default is provided to avoid shipping a stale Supabase project ref (issue #68).",
	);
	process.exit(1);
}

if (!/^[a-z0-9]{20}$/i.test(projectRef)) {
	console.error(
		`gen:types: SUPABASE_PROJECT_REF "${projectRef}" does not look like a valid Supabase project ref (expected 20 alphanumeric characters).`,
	);
	process.exit(1);
}

const outputPath = path.join(repoRoot, "src", "lib", "database.types.ts");
const args = [
	"supabase",
	"gen",
	"types",
	"typescript",
	"--project-id",
	projectRef,
	"--schema",
	"public",
];

console.log(
	`gen:types: invoking \`npx ${args.join(" ")}\` > ${path.relative(repoRoot, outputPath)}`,
);

const child = spawn("npx", args, {
	stdio: ["ignore", "pipe", "inherit"],
	env: process.env,
	// Windows requires shell: true to resolve .cmd shims for the npx stub
	// (Node 20+ security default). macOS/Linux resolve via PATH normally.
	shell: process.platform === "win32",
});

let stdout = "";
child.stdout.on("data", (chunk) => {
	stdout += chunk.toString();
});

let stderr = "";
child.stderr.on("data", (chunk) => {
	stderr += chunk.toString();
});

child.on("error", (error) => {
	console.error(`gen:types: failed to spawn npx: ${error.message}`);
	process.exit(1);
});

child.on("close", async (code) => {
	if (code !== 0) {
		process.stderr.write(stderr);
		console.error(`gen:types: \`npx supabase gen types\` exited with code ${code}.`);
		process.exit(code ?? 1);
	}
	if (!stdout.trim()) {
		process.stderr.write(stderr);
		console.error(
			"gen:types: supabase CLI produced no output. Aborting so we do not overwrite database.types.ts with an empty file.",
		);
		process.exit(1);
	}
	try {
		const { writeFile } = await import("node:fs/promises");
		await writeFile(outputPath, stdout, "utf8");
		console.log(
			`gen:types: wrote ${stdout.length} bytes to ${path.relative(repoRoot, outputPath)}`,
		);
	} catch (error) {
		console.error(
			`gen:types: failed to write ${outputPath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
});
