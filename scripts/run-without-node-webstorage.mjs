#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNodeOptionsWithoutNodeWebStorage } from "./node-localstorage-options.mjs";

const [command, ...args] = process.argv.slice(2);
const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

if (!command) {
	console.error("Usage: run-without-node-webstorage.mjs <command> [...args]");
	process.exit(1);
}

const executable = command === "vitest" ? process.execPath : command;
const commandArgs =
	command === "vitest"
		? [path.join(repoRoot, "node_modules", "vitest", "vitest.mjs"), ...args]
		: args;

const child = spawn(executable, commandArgs, {
	env: {
		...process.env,
		NODE_OPTIONS: buildNodeOptionsWithoutNodeWebStorage(
			process.env.NODE_OPTIONS,
		),
	},
	stdio: "inherit",
});

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
