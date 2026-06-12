#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNodeOptionsWithoutNodeWebStorage } from "./node-localstorage-options.mjs";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const playwrightCli = path.join(repoRoot, "node_modules", "playwright", "cli.js");

const child = spawn(
	process.execPath,
	[playwrightCli, "test", ...process.argv.slice(2)],
	{
		cwd: repoRoot,
		env: {
			...process.env,
			NODE_OPTIONS: buildNodeOptionsWithoutNodeWebStorage(
				process.env.NODE_OPTIONS,
			),
		},
		stdio: "inherit",
	},
);

child.on("error", (error) => {
	console.error(error);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}

	process.exit(code ?? 1);
});
