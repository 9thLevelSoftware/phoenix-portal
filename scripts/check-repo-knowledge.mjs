import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredDocs = [
	"docs/index.md",
	"docs/ARCHITECTURE.md",
	"docs/ENGINEERING_STANDARDS.md",
	"docs/FRONTEND.md",
	"docs/TESTING.md",
	"docs/QUALITY.md",
	"docs/RELIABILITY.md",
	"docs/SECURITY.md",
	"docs/archive/README.md",
	"docs/archive/planning/README.md",
	"docs/archive/superpowers/README.md",
];

const markdownFilesToCheck = [
	"AGENTS.md",
	"CLAUDE.md",
	"guidelines/Guidelines.md",
	...requiredDocs,
];

const entrypointLineLimits = new Map([
	["AGENTS.md", 110],
	["CLAUDE.md", 40],
	["guidelines/Guidelines.md", 40],
]);

const failures = [];

function fail(message) {
	failures.push(message);
}

function toPosix(filePath) {
	return filePath.replace(/\\/g, "/");
}

function runGit(args) {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function absolute(filePath) {
	return path.join(root, filePath);
}

function lineCount(filePath) {
	const content = readFileSync(absolute(filePath), "utf8")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n$/, "");
	return content ? content.split("\n").length : 0;
}

function fileExists(filePath) {
	return existsSync(absolute(filePath));
}

function assertTrackedAgentEntryPoint() {
	try {
		runGit(["ls-files", "--error-unmatch", "AGENTS.md"]);
	} catch {
		fail("AGENTS.md must be tracked. Remove ignore rules and commit it.");
	}

	let ignored = "";
	try {
		ignored = runGit([
			"check-ignore",
			"--no-index",
			"-v",
			"--",
			"AGENTS.md",
		]).trim();
	} catch {
		ignored = "";
	}
	if (ignored) {
		fail(`AGENTS.md is still ignored: ${ignored}`);
	}
}

function assertRequiredDocsExist() {
	for (const doc of requiredDocs) {
		if (!fileExists(doc)) {
			fail(`Missing required repository knowledge doc: ${doc}`);
		}
	}
}

function assertNoTrackedLegacyPlanningFiles() {
	const trackedLegacy = runGit(["ls-files", ".planning", ".superpowers"])
		.trim()
		.split(/\r?\n/)
		.filter(Boolean);

	if (trackedLegacy.length > 0) {
		fail(
			[
				"Tracked legacy planning files must live under docs/archive/:",
				...trackedLegacy.map((file) => `  - ${file}`),
			].join("\n"),
		);
	}
}

function assertArchiveMarkers() {
	for (const readme of [
		"docs/archive/README.md",
		"docs/archive/planning/README.md",
		"docs/archive/superpowers/README.md",
	]) {
		if (!fileExists(readme)) {
			continue;
		}

		const content = readFileSync(absolute(readme), "utf8").toLowerCase();
		if (!content.includes("historical")) {
			fail(`${readme} must clearly mark archived content as historical.`);
		}
	}
}

function assertEntrypointLengths() {
	for (const [file, limit] of entrypointLineLimits) {
		if (!fileExists(file)) {
			fail(`Missing agent entrypoint: ${file}`);
			continue;
		}

		const lines = lineCount(file);
		if (lines > limit) {
			fail(`${file} has ${lines} lines; limit is ${limit}.`);
		}
	}
}

function assertMarkdownLinksResolve() {
	const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

	for (const file of markdownFilesToCheck) {
		if (!fileExists(file)) {
			continue;
		}

		const content = readFileSync(absolute(file), "utf8");
		for (const match of content.matchAll(markdownLinkPattern)) {
			const rawTarget = match[1].trim();
			if (
				!rawTarget ||
				rawTarget.startsWith("#") ||
				/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
			) {
				continue;
			}

			const withoutAnchor = rawTarget.split(/[?#]/)[0];
			if (!withoutAnchor) {
				continue;
			}

			let decodedTarget;
			try {
				decodedTarget = decodeURI(withoutAnchor);
			} catch {
				fail(`${file} has an invalid internal link target: ${rawTarget}`);
				continue;
			}
			const resolved = decodedTarget.startsWith("/")
				? path.resolve(root, decodedTarget.slice(1))
				: path.resolve(path.dirname(absolute(file)), decodedTarget);

			const relativeToRoot = path.relative(root, resolved);
			if (
				relativeToRoot === ".." ||
				relativeToRoot.startsWith(`..${path.sep}`) ||
				path.isAbsolute(relativeToRoot)
			) {
				fail(`${file} links outside the repository: ${rawTarget}`);
				continue;
			}

			if (!existsSync(resolved)) {
				fail(
					`${file} has a broken internal link: ${rawTarget} -> ${toPosix(
						path.relative(root, resolved),
					)}`,
				);
			}
		}
	}
}

assertTrackedAgentEntryPoint();
assertRequiredDocsExist();
assertNoTrackedLegacyPlanningFiles();
assertArchiveMarkers();
assertEntrypointLengths();
assertMarkdownLinksResolve();

if (failures.length > 0) {
	console.error("Repository knowledge check failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log("Repository knowledge check passed.");
