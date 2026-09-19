#!/usr/bin/env node
/**
 * Regenerate (or check) src/lib/database.types.ts.
 *
 * Two sources:
 *
 * 1. `--local` (the source of truth CI enforces): the local Supabase stack
 *    after `supabase db reset --no-seed`, i.e. the schema the migrations in
 *    supabase/migrations/ produce. Usage:
 *      npx supabase@2.76.9 start && npx supabase@2.76.9 db reset --no-seed
 *      npm run gen:types:local      # rewrite database.types.ts
 *      npm run gen:types:check      # exit 1 if database.types.ts is stale
 *    The migrations workflow (.github/workflows/migrations.yml) runs the
 *    check, so a migration that changes the schema must commit regenerated
 *    types in the same PR.
 *
 * 2. Project ref (legacy, reads a hosted project, NOT what CI checks):
 *      SUPABASE_PROJECT_REF=abcdefghijklmnopqrst npm run gen:types
 *    Issue #68: the previous `gen:types` script hardcoded a stale Supabase
 *    project ref (`ilzlswmatadlnsuxatcv`) that has since been deleted. To
 *    prevent recurrence the ref must come from `SUPABASE_PROJECT_REF`
 *    (loaded from `.env` / `.env.local`, or exported by the operator).
 *
 * Normalization (both sources): the CLI output is piped through
 * `biome format --stdin-file-path=src/lib/database.types.ts` so it matches
 * the repo's Biome style (and `npm run lint`), and line endings are LF.
 *
 * Environment for `--local`:
 *   SUPABASE_BIN      CLI command to run instead of `npx --yes supabase@<pin>`
 *                     (CI sets `supabase`, installed by supabase/setup-cli).
 *   SUPABASE_WORKDIR  optional `--workdir` passed to the CLI.
 * The pin below MUST equal `version:` of supabase/setup-cli in
 * .github/workflows/migrations.yml: different CLI versions emit different
 * type shapes, which would make the check fail spuriously.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const SUPABASE_CLI_PIN = "2.76.9";
const REGENERATE_HINT =
	"Regenerate with: npx supabase@2.76.9 start && npx supabase@2.76.9 db reset --no-seed && npm run gen:types:local, then commit src/lib/database.types.ts.";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "src", "lib", "database.types.ts");
const outputRelative = "src/lib/database.types.ts";
const isWindows = process.platform === "win32";

const argv = new Set(process.argv.slice(2));
const localMode = argv.has("--local");
const checkMode = argv.has("--check");

function fail(message, code = 1) {
	console.error(message);
	process.exit(code);
}

/** Runs a command and resolves with stdout; rejects with stderr on failure. */
function run(command, args, input) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: repoRoot,
			stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
			env: process.env,
			// Windows requires shell: true to resolve .cmd shims (npx, biome).
			shell: isWindows,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) =>
			reject(new Error(`failed to spawn ${command}: ${error.message}`)),
		);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(
					new Error(
						`\`${command} ${args.join(" ")}\` exited with code ${code}.\n${stderr}`,
					),
				);
				return;
			}
			resolve(stdout);
		});
		if (input !== undefined) {
			child.stdin.end(input);
		}
	});
}

function cliInvocation() {
	if (localMode) {
		const bin = process.env.SUPABASE_BIN?.trim();
		const genArgs = ["gen", "types", "typescript", "--local"];
		const workdir = process.env.SUPABASE_WORKDIR?.trim();
		if (workdir) genArgs.push("--workdir", workdir);
		genArgs.push("--schema", "public");
		return bin
			? { command: bin, args: genArgs }
			: {
					command: "npx",
					args: ["--yes", `supabase@${SUPABASE_CLI_PIN}`, ...genArgs],
				};
	}

	// Best-effort .env loading so local developers don't need to export the
	// variable manually. We deliberately do NOT add a default here: the only
	// safe behavior when SUPABASE_PROJECT_REF is missing is to refuse to run.
	for (const { relativePath, override } of [
		{ relativePath: ".env", override: false },
		{ relativePath: ".env.local", override: true },
	]) {
		const dotenvPath = path.join(repoRoot, relativePath);
		if (existsSync(dotenvPath)) {
			loadDotenv({ path: dotenvPath, override });
		}
	}

	const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
	if (!projectRef) {
		fail(
			"gen:types: SUPABASE_PROJECT_REF is not set.\n" +
				"  Set it in your shell or .env (e.g. SUPABASE_PROJECT_REF=abcdefghijklmnopqrst).\n" +
				"  No default is provided to avoid shipping a stale Supabase project ref (issue #68).\n" +
				"  To generate from the local migrated schema instead, use `npm run gen:types:local`.",
		);
	}
	if (!/^[a-z0-9]{20}$/i.test(projectRef)) {
		fail(
			`gen:types: SUPABASE_PROJECT_REF "${projectRef}" does not look like a valid Supabase project ref (expected 20 alphanumeric characters).`,
		);
	}
	return {
		command: "npx",
		args: [
			"supabase",
			"gen",
			"types",
			"typescript",
			"--project-id",
			projectRef,
			"--schema",
			"public",
		],
	};
}

const toLf = (text) => text.replace(/\r\n/g, "\n");


const { command, args } = cliInvocation();
console.log(`gen:types: invoking \`${command} ${args.join(" ")}\``);

let generated;
try {
	generated = await run(command, args);
} catch (error) {
	fail(`gen:types: ${error instanceof Error ? error.message : String(error)}`);
}
if (!generated.trim()) {
	fail(
		"gen:types: supabase CLI produced no output. Aborting so we do not overwrite database.types.ts with an empty file.",
	);
}

let formatted;
try {
	formatted = toLf(
		await run(
			"npx",
			["biome", "format", `--stdin-file-path=${outputRelative}`],
			generated,
		),
	);
} catch (error) {
	fail(
		`gen:types: biome format failed: ${error instanceof Error ? error.message : String(error)}`,
	);
}

if (checkMode) {
	const committed = toLf(await readFile(outputPath, "utf8"));
	if (committed === formatted) {
		console.log(
			`gen:types: ${outputRelative} matches the migrated local schema.`,
		);
		process.exit(0);
	}
	console.error(
		`gen:types: ${outputRelative} is stale: it does not match the types generated from the migrated local schema (Supabase CLI ${SUPABASE_CLI_PIN}).`,
	);
	// Show what changed (generated = what the migrations produce).
	const scratchDir = await mkdtemp(path.join(tmpdir(), "gen-types-"));
	const generatedPath = path.join(scratchDir, "database.types.generated.ts");
	await writeFile(generatedPath, formatted, "utf8");
	const diff = spawnSync(
		"git",
		[
			"diff",
			"--no-index",
			"--no-color",
			"--",
			outputRelative,
			generatedPath,
		],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	console.error(diff.stdout || diff.stderr || "(git diff unavailable)");
	await rm(scratchDir, { recursive: true, force: true });
	console.error(`\n${REGENERATE_HINT}`);
	if (process.env.GITHUB_ACTIONS === "true") {
		console.error(
			`::error file=${outputRelative}::database.types.ts is stale vs the migrations. ${REGENERATE_HINT}`,
		);
	}
	process.exit(1);
}

try {
	await writeFile(outputPath, formatted, "utf8");
	console.log(
		`gen:types: wrote ${formatted.length} bytes to ${outputRelative}`,
	);
} catch (error) {
	fail(
		`gen:types: failed to write ${outputPath}: ${
			error instanceof Error ? error.message : String(error)
		}`,
	);
}
