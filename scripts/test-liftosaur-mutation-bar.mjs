/**
 * Mutation bar for the Liftosaur resumable-backfill contract (#204).
 *
 * The resumable backfill is only as good as the assertions that guard it:
 * upstream evidence showed the whole suite staying green with the resume-point
 * write or the ascending resume branch disabled. This script closes that hole
 * by asserting SENSITIVITY, not just a green baseline:
 *
 *   1. Baseline: the designated Edge test files pass under BOTH
 *      `SYNC_LWW_ENABLED` values (the push path has a separate write path per
 *      value and the production value is unknown).
 *   2. Each named mutant is applied to the real source, the same tests run
 *      again under BOTH values, and the mutant counts as KILLED only when its
 *      NAMED behavioral assertions fail (they are listed per mutant).
 *      Historical red counts are deliberately not asserted: the named
 *      assertions are the contract, the number of collateral failures is not.
 *   3. Fail closed on anything else: an unapplied mutation (the anchor text
 *      is not found exactly once), a surviving mutant (a named assertion
 *      stayed green), or a run whose failures are not behavioral — a
 *      type-check, module-load, bootstrap or network error kills nothing and
 *      is reported as a harness failure.
 *
 * Source is restored from an in-memory copy after every mutant (and verified
 * byte-identical at the end), so the checkout is never left dirty. The script
 * mutates only copies of the two source files it names and never touches
 * tests: a mutant must be caught by assertions, not by editing the assertions.
 *
 * Run: npm run test:edge:mutation-bar   (CI: the edge-functions job)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const denoVersion = "2.2.15";
const functionsDir = "supabase/functions";

/** The Edge test files holding the designated behavioral assertions. */
const testFiles = [
	"supabase/functions/_shared/liftosaurSync.test.ts",
	"supabase/functions/liftosaur-sync/index.test.ts",
	"supabase/functions/mobile-integration-sync/index.test.ts",
];

/** Both flag values must pass baseline and detect every mutant (NF-50). */
const flagValues = ["false", "true"];

/**
 * Named mutants. `find` must occur EXACTLY once in `file` (fail closed
 * otherwise): the anchor is part of the contract, so a renamed line cannot
 * silently disable a mutant. `kills` lists the test names that MUST fail —
 * exactly the assertions that encode the behavior the mutation removes.
 */
const MUTANTS = [
	{
		id: "descending-window-write",
		removes: "the descending continue window write (backfill_before)",
		file: "supabase/functions/_shared/liftosaurSync.ts",
		find: "backfill_before: nextBefore,",
		replace: "backfill_before: null,",
		kills: [
			"resolveLiftosaurTruncation: newest-first continues 1s above the oldest record read",
			"liftosaur-sync: a history larger than one run is imported over resumable runs (#204)",
		],
	},
	{
		id: "resume-point-persistence",
		removes: "the ascending resume-point watermark write (last_sync_at)",
		file: "supabase/functions/_shared/liftosaurSync.ts",
		find: "last_sync_at: resumeAt,",
		replace: "// mutation-bar: resume point not persisted,",
		kills: [
			"resolveLiftosaurTruncation: an ascending oldest-first page resumes at the newest record read (#204)",
			"liftosaur-sync: an initial ascending history over one run hands its queue row on to an incremental continuation (#204)",
			"mobile-integration-sync: an ascending Liftosaur connect reports resumeAt and the next sync completes the union (#204)",
		],
	},
	{
		id: "truncation-signal",
		removes: "the truncation signal on a fetch that stopped with history unread",
		file: "supabase/functions/_shared/liftosaurSync.ts",
		find: "truncated: hasMore,",
		replace: "truncated: false,",
		kills: [
			"fetchLiftosaurHistory: reaching the page budget reports page_budget and calls onPage per page",
			"liftosaur-sync: a page that claims more history without a cursor is reported, not mistaken for the end",
		],
	},
	{
		id: "ascending-selection",
		removes: "selection of the ascending oldest-first resume branch",
		file: "supabase/functions/_shared/liftosaurSync.ts",
		find: "!plan.inBackfill && fetched.order === 'ascending' && fetched.newestDatedAt",
		replace: "!plan.inBackfill && fetched.order === 'descending' && fetched.newestDatedAt",
		kills: [
			"resolveLiftosaurTruncation: an ascending oldest-first page resumes at the newest record read (#204)",
			"liftosaur-sync: an initial ascending history over one run hands its queue row on to an incremental continuation (#204)",
			"mobile-integration-sync: an ascending Liftosaur connect reports resumeAt and the next sync completes the union (#204)",
		],
	},
	{
		id: "initial-handoff",
		removes: "the initial-to-incremental queue-row hand-off (the row stays `initial`)",
		file: "supabase/functions/liftosaur-sync/index.ts",
		find: '\t\t\t\tstatus: "pending",\n\t\t\t\tsync_type: "incremental",',
		replace: '\t\t\t\tstatus: "pending",\n\t\t\t\tsync_type: "initial",',
		kills: [
			"liftosaur-sync: an initial ascending history over one run hands its queue row on to an incremental continuation (#204)",
			"liftosaur-sync: an ascending handoff claims no continuation while the conflicting row is processing (#204)",
		],
	},
];

function fail(message) {
	console.error(`mutation-bar: ${message}`);
	process.exit(1);
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
	...testFiles,
];

function runTests(flagValue) {
	const result = spawnSync("deno", denoArgs, {
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1", SYNC_LWW_ENABLED: flagValue },
	});
	if (result.error?.code === "ENOENT") {
		const isWindows = process.platform === "win32";
		const npxArgs = ["-y", `deno@${denoVersion}`, ...denoArgs];
		const fallback = spawnSync("npx", isWindows ? npxArgs.map(quoteForCmd) : npxArgs, {
			encoding: "utf8",
			shell: isWindows,
			env: { ...process.env, NO_COLOR: "1", SYNC_LWW_ENABLED: flagValue },
		});
		if (fallback.error) return { status: 1, output: String(fallback.error) };
		return { status: fallback.status ?? 1, output: `${fallback.stdout ?? ""}${fallback.stderr ?? ""}` };
	}
	if (result.error) return { status: 1, output: String(result.error) };
	return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

// cmd.exe (the Windows `shell: true` fallback) joins args unquoted; quote any
// arg with spaces or cmd metacharacters (`^` is literal inside quotes).
function quoteForCmd(arg) {
	return /[\s^&|<>()"]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg;
}

/**
 * Names of tests that actually FAILED, from deno's report blocks. Each failed
 * test is listed as `<name> => ./<file>:<line>:<col>`; passing tests print
 * `... ok` and never match. A run that never produced such a line failed to
 * load or type-check, which is a harness failure — never a kill.
 */
function failedTestNames(output) {
	const names = new Set();
	for (const rawLine of output.split("\n")) {
		// Deno colorizes its report even when output is piped; ANSI sequences
		// would otherwise sit between the name and the ` => ` separator.
		const line = rawLine.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
		const match = line.match(/^(.*?) => \.\/.+:\d+:\d+\s*$/);
		if (match) names.add(match[1].trim());
	}
	return names;
}

// A named assertion that no longer exists (renamed test) must fail the bar,
// not quietly weaken it.
for (const mutant of MUTANTS) {
	for (const name of mutant.kills) {
		const present = testFiles.some((file) => readFileSync(file, "utf8").includes(name));
		if (!present) fail(`mutant "${mutant.id}" names a test that no longer exists: ${name}`);
	}
}

const originals = new Map();
for (const mutant of MUTANTS) {
	if (!originals.has(mutant.file)) {
		originals.set(mutant.file, readFileSync(mutant.file, "utf8"));
	}
}
const restoreAll = () => {
	for (const [file, source] of originals) writeFileSync(file, source);
};

try {
	// ---- Baseline: pristine source must pass under both flag values ----
	for (const flag of flagValues) {
		const run = runTests(flag);
		if (run.status !== 0) {
			fail(
				`baseline is not green under SYNC_LWW_ENABLED=${flag}; fix the suite before measuring sensitivity.\n${run.output.slice(-2000)}`,
			);
		}
	}
	console.log(`mutation-bar: baseline green under SYNC_LWW_ENABLED=${flagValues.join(",")}`);

	// ---- Each mutant must be applied and killed by its named assertions ----
	let failures = 0;
	for (const mutant of MUTANTS) {
		const pristine = originals.get(mutant.file);
		const occurrences = pristine.split(mutant.find).length - 1;
		if (occurrences !== 1) {
			failures++;
			console.error(
				`  ${mutant.id.padEnd(28)} UNAPPLIED — anchor occurs ${occurrences}x (expected exactly 1) in ${mutant.file}`,
			);
			continue;
		}
		const details = [];
		let killed = true;
		for (const flag of flagValues) {
			writeFileSync(mutant.file, pristine.replace(mutant.find, mutant.replace));
			const run = runTests(flag);
			writeFileSync(mutant.file, pristine);
			const failed = failedTestNames(run.output);
			if (run.status !== 0 && failed.size === 0) {
				killed = false;
				details.push(
					`SYNC_LWW_ENABLED=${flag}: run failed without behavioral assertion failures (type-check/bootstrap/network error)`,
				);
				continue;
			}
			const missed = mutant.kills.filter((name) => !failed.has(name));
			if (missed.length > 0) {
				killed = false;
				details.push(`SYNC_LWW_ENABLED=${flag}: survived — ${missed.map((m) => JSON.stringify(m)).join(", ")} stayed green`);
			} else {
				details.push(`SYNC_LWW_ENABLED=${flag}: killed by all ${mutant.kills.length} named assertion(s)`);
			}
		}
		if (killed) {
			console.log(`  ${mutant.id.padEnd(28)} KILLED — ${mutant.removes}`);
		} else {
			failures++;
			console.error(`  ${mutant.id.padEnd(28)} SURVIVED — ${mutant.removes}`);
		}
		for (const detail of details) console.error(`      ${detail}`);
	}

	restoreAll();
	for (const [file, source] of originals) {
		if (readFileSync(file, "utf8") !== source) {
			fail(`${file} was left mutated; restore it from version control`);
		}
	}

	if (failures > 0) {
		fail(`${failures} mutant(s) were not killed by their named assertions under both flag values`);
	}
	console.log(`mutation-bar: ${MUTANTS.length} mutants killed under both SYNC_LWW_ENABLED values; source restored.`);
} catch (error) {
	restoreAll();
	fail(`aborted: ${error instanceof Error ? error.message : String(error)}`);
}
