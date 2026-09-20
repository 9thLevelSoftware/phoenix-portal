import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const denoVersion = "2.2.15";
const functionsDir = "supabase/functions";

// Handler tests use in-process doubles (no live secrets). Push/PR CI must run
// these so a green job means the axiom ran, not only `deno check`.
const testFiles = [
	`${functionsDir}/compute-rankings/index.test.ts`,
	`${functionsDir}/mobile-sync-push/index.test.ts`,
	`${functionsDir}/mobile-sync-pull/index.test.ts`,
// Real-SQL integration test contract (see
// supabase/functions/_shared/localIntegrationEnvironment.ts):
//   - named "integration: ..." and
//   - gated with `ignore: localIntegrationEnvironment === null`.
// `npm run test:edge` keeps them ignored; `npm run test:edge:integration`
// runs only them, against a local stack, and fails unless they all executed.
const integrationFilter = "/^integration: /";
const integrationNamePattern = /["'`]integration: /g;
const integrationGatePattern =
	/ignore:\s*localIntegrationEnvironment\s*===\s*null/g;
const integrationEnvNames = [
	"SUPABASE_URL",
	"SUPABASE_ANON_KEY",
	"SUPABASE_SERVICE_ROLE_KEY",
];
const requiredMarker = "EDGE_INTEGRATION_REQUIRED";
const localHostnames = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const integrationMode = process.argv.includes("--integration");

// Every `*.test.ts` anywhere under supabase/functions (handler dirs and
// `_shared`, at any depth) is run, so a new test file cannot be silently left
// out of CI. Handler tests use in-process doubles (no live secrets).
function discoverTestFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) found.push(...discoverTestFiles(path));
		else if (entry.isFile() && entry.name.endsWith(".test.ts"))
			found.push(path);
	}
	return found.sort();
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

const testFiles = discoverTestFiles(functionsDir);
if (testFiles.length === 0) {
	fail(`No Edge Function tests found under ${functionsDir}.`);
}

// A test gated on the local stack but not named "integration: ..." would be
// ignored by test:edge and filtered out of test:edge:integration, i.e. never
// run. Fail in both modes so the regular CI job catches it.
let integrationNameCount = 0;
for (const path of testFiles) {
	const source = readFileSync(path, "utf8");
	const names = source.match(integrationNamePattern)?.length ?? 0;
	const gates = source.match(integrationGatePattern)?.length ?? 0;
	integrationNameCount += names;
	if (gates > names) {
		fail(
			`${path}: ${gates} test(s) gated on localIntegrationEnvironment but only ${names} named "integration: ...". ` +
				"Name every real-SQL test with the \"integration: \" prefix so test:edge:integration runs it.",
		);
	}
}

const childEnv = { ...process.env };
let junitDir;
let junitPath;

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
	// (The shared test gate enforces the same rule for direct `deno test`.)
	if (!localHostnames.has(hostname)) {
		fail(
			`Refusing to run integration tests against non-local SUPABASE_URL host "${hostname}".`,
		);
	}
	if (integrationNameCount === 0) {
		fail('No "integration: ..." tests found; nothing to run.');
	}
	// Makes the shared gate throw instead of silently ignoring tests.
	childEnv[requiredMarker] = "1";
	junitDir = mkdtempSync(join(tmpdir(), "edge-integration-"));
	junitPath = join(junitDir, "junit.xml");
} else {
	// Keep the default run hermetic: integration tests stay ignored even if a
	// developer shell happens to export Supabase credentials.
	for (const name of [...integrationEnvNames, requiredMarker])
		delete childEnv[name];
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
	...(integrationMode
		? ["--filter", integrationFilter, `--junit-path=${junitPath}`]
		: []),
	...testFiles,
];

function run(command, args, options = {}) {
	return spawnSync(command, args, {
		stdio: "inherit",
		env: childEnv,
		...options,
	});
}

// cmd.exe (the Windows `shell: true` fallback) joins args unquoted; quote any
// arg with spaces or cmd metacharacters (`^` is literal inside quotes).
function quoteForCmd(arg) {
	return /[\s^&|<>()"]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg;
}

let result = run("deno", denoArgs);

if (result.error?.code === "ENOENT") {
	console.warn(
		`Deno is not available on PATH; falling back to \`npx -y deno@${denoVersion}\`.`,
	);
	const isWindows = process.platform === "win32";
	const npxArgs = ["-y", `deno@${denoVersion}`, ...denoArgs];
	result = run("npx", isWindows ? npxArgs.map(quoteForCmd) : npxArgs, {
		shell: isWindows,
	});
}

if (result.error) {
	console.error(`Edge Function tests failed to start: ${result.error.message}`);
	process.exit(1);
}

let status = result.status ?? 1;

// `deno test` exits 0 when every selected test is ignored. In integration mode
// that would be a green job that ran no SQL, so require >=1 executed test and
// zero ignored ones.
if (integrationMode) {
	let junit = "";
	try {
		junit = readFileSync(junitPath, "utf8");
	} catch {
		console.error("Integration run produced no JUnit report.");
		status = status || 1;
	}
	rmSync(junitDir, { recursive: true, force: true });
	if (junit) {
		// Deno's JUnit report lists filtered-out tests as <skipped/> too, so
		// only look at the "integration: " test cases.
		let executed = 0;
		let skipped = 0;
		const testcasePattern =
			/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
		for (const [, attrs, body = ""] of junit.matchAll(testcasePattern)) {
			if (!/\bname="integration: /.test(attrs)) continue;
			if (/<skipped\b/.test(body)) skipped += 1;
			else executed += 1;
		}
		console.log(
			`Integration summary: ${executed} executed, ${skipped} ignored.`,
		);
		if (executed === 0 || skipped > 0) {
			console.error(
				"Integration run must execute at least one test and ignore none.",
			);
			status = status || 1;
		}
	}
}

process.exit(status);
