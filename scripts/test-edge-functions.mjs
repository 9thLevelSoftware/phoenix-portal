import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const denoVersion = "2.2.15";
const functionsDir = "supabase/functions";
const sharedDir = `${functionsDir}/_shared`;

// Real-SQL integration tests are named "integration: ..." and are `ignore:`d
// unless SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are set.
// The filter has no spaces or shell metacharacters so it survives the
// `shell: true` npx fallback on Windows.
const integrationFilter = "integration:";
const integrationEnvNames = [
	"SUPABASE_URL",
	"SUPABASE_ANON_KEY",
	"SUPABASE_SERVICE_ROLE_KEY",
];
const localHostnames = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const integrationMode = process.argv.includes("--integration");

// Handler tests use in-process doubles (no live secrets). Discover every
// `<function>/index.test.ts` and every `_shared/*.test.ts` so a new test file
// cannot be silently left out of CI.
function discoverTestFiles() {
	const handlerTests = readdirSync(functionsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
		.map((entry) => join(functionsDir, entry.name, "index.test.ts"))
		.filter((path) => existsSync(path));
	const sharedTests = existsSync(sharedDir)
		? readdirSync(sharedDir, { withFileTypes: true })
				.filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
				.map((entry) => join(sharedDir, entry.name))
		: [];
	return [...handlerTests, ...sharedTests]
		.map((path) => path.replaceAll("\\", "/"))
		.sort();
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

const testFiles = discoverTestFiles();
if (testFiles.length === 0) {
	fail(`No Edge Function tests found under ${functionsDir}.`);
}

const childEnv = { ...process.env };

if (integrationMode) {
	const missing = integrationEnvNames.filter((name) => !process.env[name]);
	if (missing.length > 0) {
		fail(
			`test:edge:integration needs a local Supabase stack. Missing: ${missing.join(", ")}.\n` +
				"Run `supabase start`, then export API_URL, ANON_KEY and SERVICE_ROLE_KEY " +
				"from `supabase status -o json` as the variables above.",
		);
	}
	let hostname;
	try {
		hostname = new URL(process.env.SUPABASE_URL).hostname;
	} catch {
		fail("SUPABASE_URL is not a valid URL.");
	}
	// The integration fixtures create and delete auth users with the service
	// role key. Refuse anything but a local stack so they can never hit prod.
	if (!localHostnames.has(hostname)) {
		fail(
			`Refusing to run integration tests against non-local SUPABASE_URL host "${hostname}".`,
		);
	}
	const hasIntegrationTests = testFiles.some((path) =>
		readFileSync(path, "utf8").includes(`"${integrationFilter} `),
	);
	if (!hasIntegrationTests) {
		fail(`No "${integrationFilter} ..." tests found; nothing to run.`);
	}
} else {
	// Keep the default run hermetic: integration tests stay ignored even if a
	// developer shell happens to export Supabase credentials.
	for (const name of integrationEnvNames) delete childEnv[name];
}

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
	...(integrationMode ? ["--filter", integrationFilter] : []),
	...testFiles,
];

function run(command, args, options = {}) {
	return spawnSync(command, args, { stdio: "inherit", env: childEnv, ...options });
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
