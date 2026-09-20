#!/usr/bin/env node
/**
 * Real type checking for the whole repo.
 *
 * `tsc --noEmit` over the root tsconfig checks NOTHING: the root config is a
 * solution file with `"files": []` and only project references, so tsc compiles
 * an empty program and exits 0. This script runs every referenced project
 * explicitly (`tsc -p <project> --noEmit`) and compares the result against a
 * checked-in baseline of pre-existing errors, so the gate fails on NEW errors
 * while the known debt is paid down separately.
 *
 * Usage:
 *   node scripts/typecheck.mjs            # check; exit 1 on any new error
 *   node scripts/typecheck.mjs --update   # rewrite the baseline from current state
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'typecheck-baseline.json');
const tscPath = path.join(repoRoot, 'node_modules', 'typescript', 'lib', 'tsc.js');

/** Project id -> tsconfig file. Every referenced project must appear here. */
const PROJECTS = {
  app: 'tsconfig.app.json',
  node: 'tsconfig.node.json',
  test: 'tsconfig.test.json',
};

const BASELINE_README = [
  'Pre-existing TypeScript errors, recorded so `npm run typecheck` can fail on NEW errors',
  'without requiring the whole backlog to be fixed at once.',
  'Shape: projects[projectId][filePath][errorCode] = count.',
  'Line and column numbers and message text are deliberately NOT recorded: they churn on every',
  'unrelated edit. The trade-off is that swapping one TS2322 in a file for a different TS2322 in',
  'the same file is not detected. Reduce the counts by fixing errors; regenerate with',
  '`npm run typecheck:baseline` and review the diff.',
  'Note: tsconfig.test.json includes both `src` and `tests`, so the `test` project re-reports the',
  '`app` project errors as well as test-only ones.',
];

function fail(message) {
  console.error(`typecheck: ${message}`);
  process.exit(1);
}

function runProject(projectFile) {
  const result = spawnSync(
    process.execPath,
    [tscPath, '-p', projectFile, '--noEmit', '--pretty', 'false'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      // tsc prints multi-KB inferred-type dumps; the 1MB default truncates the
      // stream and would make a broken project look clean.
      maxBuffer: 256 * 1024 * 1024,
    },
  );

  if (result.error) {
    fail(`failed to run tsc for ${projectFile}: ${result.error.message}`);
  }
  if (result.status === null) {
    fail(`tsc for ${projectFile} was terminated by signal ${result.signal}`);
  }

  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;

function parseErrors(projectFile, { status, output }) {
  const byFile = {};
  const globalErrors = [];
  let total = 0;

  for (const rawLine of output.split(/\r?\n/)) {
    // Continuation lines of a multi-line diagnostic are indented; only the first
    // line of a diagnostic starts at column 0.
    if (!/error TS\d+/.test(rawLine) || /^\s/.test(rawLine)) continue;
    total += 1;

    const match = ERROR_LINE.exec(rawLine);
    if (!match) {
      // Project-level errors (bad tsconfig, TS18003 "No inputs were found", ...)
      // have no file prefix. They must never be baselined away.
      globalErrors.push(rawLine.trim());
      continue;
    }

    const file = match[1].replaceAll('\\', '/');
    const code = match[4];
    byFile[file] ??= {};
    byFile[file][code] = (byFile[file][code] ?? 0) + 1;
  }

  if (status !== 0 && total === 0) {
    fail(
      `tsc exited ${status} for ${projectFile} but printed no parsable diagnostics. Raw output:\n${output.slice(0, 4000)}`,
    );
  }

  return { byFile, globalErrors, total };
}

function sortedRecord(record) {
  const out = {};
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    out[key] = value && typeof value === 'object' ? sortedRecord(value) : value;
  }
  return out;
}

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    fail(`baseline file missing at ${path.relative(repoRoot, baselinePath)}. Run: npm run typecheck:baseline`);
  }
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (!parsed.projects || typeof parsed.projects !== 'object') {
    fail('baseline file has no "projects" object');
  }
  return parsed;
}

function writeBaseline(results) {
  const projects = {};
  for (const [id, { byFile }] of Object.entries(results)) {
    projects[id] = sortedRecord(byFile);
  }
  const contents = {
    _readme: BASELINE_README,
    projects: sortedRecord(projects),
  };
  writeFileSync(baselinePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
}

function main() {
  const update = process.argv.includes('--update');

  if (!existsSync(tscPath)) {
    fail(`typescript not found at ${path.relative(repoRoot, tscPath)}; run npm install`);
  }

  const results = {};
  for (const [id, projectFile] of Object.entries(PROJECTS)) {
    if (!existsSync(path.join(repoRoot, projectFile))) {
      fail(`project ${projectFile} listed in scripts/typecheck.mjs does not exist`);
    }
    console.log(`typecheck: checking ${projectFile} ...`);
    results[id] = parseErrors(projectFile, runProject(projectFile));
  }

  if (update) {
    const globals = Object.entries(results).flatMap(([id, r]) =>
      r.globalErrors.map((line) => `${id}: ${line}`),
    );
    if (globals.length > 0) {
      fail(`refusing to baseline project-level errors:\n  ${globals.join('\n  ')}`);
    }
    writeBaseline(results);
    for (const [id, { total }] of Object.entries(results)) {
      console.log(`typecheck: baselined ${total} error(s) for ${id} (${PROJECTS[id]})`);
    }
    console.log(`typecheck: wrote ${path.relative(repoRoot, baselinePath)}`);
    return;
  }

  const baseline = loadBaseline();
  const newErrors = [];
  const staleEntries = [];

  for (const [id, { byFile, globalErrors, total }] of Object.entries(results)) {
    const baseProject = baseline.projects[id] ?? {};
    let known = 0;
    let fresh = 0;

    for (const line of globalErrors) {
      newErrors.push(`[${id}] ${line}`);
      fresh += 1;
    }

    for (const [file, codes] of Object.entries(byFile)) {
      for (const [code, count] of Object.entries(codes)) {
        const allowed = baseProject[file]?.[code] ?? 0;
        known += Math.min(count, allowed);
        if (count > allowed) {
          fresh += count - allowed;
          newErrors.push(
            `[${id}] ${file}: ${count - allowed} new ${code} error(s) (baseline allows ${allowed}, found ${count})`,
          );
        }
      }
    }

    for (const [file, codes] of Object.entries(baseProject)) {
      for (const [code, count] of Object.entries(codes)) {
        const found = byFile[file]?.[code] ?? 0;
        if (found < count) {
          staleEntries.push(`[${id}] ${file}: ${code} baselined ${count}, now ${found}`);
        }
      }
    }

    console.log(
      `typecheck: ${id} (${PROJECTS[id]}): ${total} error(s) — ${known} known, ${fresh} new`,
    );
  }

  if (staleEntries.length > 0) {
    console.log(
      `\ntypecheck: ${staleEntries.length} baseline entr(ies) no longer reproduce — run \`npm run typecheck:baseline\` to shrink the baseline:`,
    );
    for (const entry of staleEntries) console.log(`  ${entry}`);
  }

  if (newErrors.length > 0) {
    console.error(`\ntypecheck: FAILED — ${newErrors.length} new type error group(s):`);
    for (const entry of newErrors) console.error(`  ${entry}`);
    console.error(
      '\nFix them, or if they are intentional and pre-existing, justify a baseline update in review.',
    );
    process.exit(1);
  }

  console.log('\ntypecheck: OK — no new type errors.');
}

main();
