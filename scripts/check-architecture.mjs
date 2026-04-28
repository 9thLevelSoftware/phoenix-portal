import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = "docs/quality/harness-baseline.json";
const maxActiveSourceLines = 1000;

const restrictedLowerLayerPrefixes = [
	"src/app/",
	"src/hooks/",
	"src/providers/",
	"src/stores/",
	"src/queries/",
	"src/mutations/",
];

const appUiPrefix = "src/app/";
const generatedFiles = new Set(["src/lib/database.types.ts"]);

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

function gitFiles(prefixes = []) {
	return runGit(["ls-files", ...prefixes])
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map(toPosix);
}

function absolute(filePath) {
	return path.join(root, filePath);
}

function readJson(filePath) {
	return JSON.parse(readFileSync(absolute(filePath), "utf8"));
}

function lineCount(filePath) {
	const content = readFileSync(absolute(filePath), "utf8")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n$/, "");
	return content ? content.split("\n").length : 0;
}

function isTypeScriptFile(filePath) {
	return (
		/\.(ts|tsx|mts|cts)$/.test(filePath) && !/\.d\.(ts|mts|cts)$/.test(filePath)
	);
}

function isTestFile(filePath) {
	return (
		filePath.includes("/__tests__/") ||
		/\.(test|spec)\.(ts|tsx|mts|cts)$/.test(filePath) ||
		filePath.startsWith("tests/") ||
		filePath.startsWith("e2e/")
	);
}

function lineLimitFor(filePath) {
	if (generatedFiles.has(filePath)) {
		return null;
	}

	if (
		filePath.startsWith("src/") ||
		filePath.startsWith("supabase/functions/") ||
		filePath.startsWith("tests/") ||
		filePath.startsWith("e2e/")
	) {
		return maxActiveSourceLines;
	}

	return null;
}

function layerFor(filePath) {
	if (filePath.startsWith("src/schemas/")) return "schemas";
	if (filePath.startsWith("src/lib/")) return "lib";
	if (filePath.startsWith("src/queries/")) return "queries";
	if (filePath.startsWith("src/mutations/")) return "mutations";
	if (filePath.startsWith("src/hooks/")) return "hooks";
	if (filePath.startsWith("src/providers/")) return "providers";
	if (filePath.startsWith("src/stores/")) return "stores";
	if (filePath.startsWith("src/app/")) return "app";
	if (filePath.startsWith("supabase/functions/")) return "edge-function";
	return "other";
}

function edgeFunctionName(filePath) {
	const parts = filePath.split("/");
	return parts[2] ?? null;
}

function firstExistingCandidate(basePath, trackedFileSet) {
	const candidates = [
		basePath,
		`${basePath}.ts`,
		`${basePath}.tsx`,
		`${basePath}.mts`,
		`${basePath}.cts`,
		`${basePath}/index.ts`,
		`${basePath}/index.tsx`,
		`${basePath}/index.mts`,
		`${basePath}/index.cts`,
	];

	for (const candidate of candidates) {
		if (trackedFileSet.has(candidate)) {
			return candidate;
		}
	}

	return basePath;
}

function resolveImport(sourceFile, specifier, trackedFileSet) {
	if (specifier.startsWith("@/")) {
		return firstExistingCandidate(`src/${specifier.slice(2)}`, trackedFileSet);
	}

	if (specifier.startsWith(".")) {
		const resolved = path.posix.normalize(
			path.posix.join(path.posix.dirname(sourceFile), specifier),
		);
		return firstExistingCandidate(resolved, trackedFileSet);
	}

	return null;
}

function importDeclarations(sourceFile, sourceText) {
	const scriptKind = sourceFile.endsWith(".tsx")
		? ts.ScriptKind.TSX
		: ts.ScriptKind.TS;
	const ast = ts.createSourceFile(
		sourceFile,
		sourceText,
		ts.ScriptTarget.Latest,
		true,
		scriptKind,
	);
	const imports = [];

	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
			imports.push({
				line: position.line + 1,
				specifier: node.moduleSpecifier.text,
			});
		}

		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1 &&
			ts.isStringLiteral(node.arguments[0])
		) {
			const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
			imports.push({
				line: position.line + 1,
				specifier: node.arguments[0].text,
			});
		}

		ts.forEachChild(node, visit);
	}

	visit(ast);
	return imports;
}

function makeViolation(rule, filePath, message, extra = {}) {
	return {
		id: `${rule}:${filePath}${extra.line ? `:${extra.line}` : ""}${
			extra.specifier ? `:${extra.specifier}` : ""
		}`,
		rule,
		filePath,
		message,
		...extra,
	};
}

function checkImportBoundary(filePath, importInfo, targetPath) {
	const sourceLayer = layerFor(filePath);

	if (!targetPath) {
		return null;
	}

	if (
		sourceLayer !== "edge-function" &&
		targetPath.startsWith("supabase/functions/")
	) {
		return makeViolation(
			"import-boundary",
			filePath,
			`Portal source cannot import Edge Function code; imported ${targetPath}.`,
			importInfo,
		);
	}

	if (sourceLayer === "schemas") {
		const schemaAllowed =
			targetPath.startsWith("src/schemas/") ||
			targetPath === "src/lib/database.types.ts";
		if (targetPath.startsWith("src/") && !schemaAllowed) {
			return makeViolation(
				"import-boundary",
				filePath,
				`Schemas must stay dependency-light; imported ${targetPath}.`,
				importInfo,
			);
		}
	}

	if (sourceLayer === "lib") {
		if (
			restrictedLowerLayerPrefixes.some((prefix) =>
				targetPath.startsWith(prefix),
			)
		) {
			return makeViolation(
				"import-boundary",
				filePath,
				`Lib code cannot import React app/runtime layers; imported ${targetPath}.`,
				importInfo,
			);
		}
	}

	if (
		["queries", "mutations", "hooks", "providers", "stores"].includes(
			sourceLayer,
		) &&
		targetPath.startsWith(appUiPrefix)
	) {
		return makeViolation(
			"import-boundary",
			filePath,
			`${sourceLayer} code cannot import app/UI code; imported ${targetPath}.`,
			importInfo,
		);
	}

	if (sourceLayer === "edge-function") {
		if (targetPath.startsWith("src/")) {
			return makeViolation(
				"import-boundary",
				filePath,
				`Edge Functions cannot import portal source code; imported ${targetPath}.`,
				importInfo,
			);
		}

		if (targetPath.startsWith("supabase/functions/")) {
			const sourceFunction = edgeFunctionName(filePath);
			const targetFunction = edgeFunctionName(targetPath);
			const sameFunction = sourceFunction === targetFunction;
			const sharedTarget = targetFunction === "_shared";

			if (!sameFunction && !sharedTarget) {
				return makeViolation(
					"import-boundary",
					filePath,
					`Edge Functions cannot import sibling functions; imported ${targetPath}.`,
					importInfo,
				);
			}
		}
	}

	return null;
}

function loadBaseline() {
	if (!existsSync(absolute(baselinePath))) {
		return { maxFileLines: [], importBoundaries: [] };
	}

	const parsed = readJson(baselinePath);
	return {
		maxFileLines: parsed.maxFileLines ?? [],
		importBoundaries: parsed.importBoundaries ?? [],
	};
}

const baseline = loadBaseline();
const baselineLineEntries = new Map(
	baseline.maxFileLines.map((entry) => [entry.path, entry]),
);
const baselineImportEntries = new Set(
	baseline.importBoundaries.map((entry) => entry.id),
);
const usedLineBaseline = new Set();
const usedImportBaseline = new Set();
const failures = [];

const trackedFiles = gitFiles([
	"src",
	"tests",
	"e2e",
	"supabase/functions",
]).filter(isTypeScriptFile);
const trackedFileSet = new Set(trackedFiles);

for (const filePath of trackedFiles) {
	const limit = lineLimitFor(filePath);
	if (limit !== null) {
		const lines = lineCount(filePath);
		if (lines > limit) {
			const baselineEntry = baselineLineEntries.get(filePath);
			if (!baselineEntry) {
				failures.push(
					makeViolation(
						"max-file-lines",
						filePath,
						`${filePath} has ${lines} lines; limit is ${limit}. Add a focused refactor or baseline with a reason.`,
						{ lines, limit },
					),
				);
			} else {
				usedLineBaseline.add(filePath);
				if (lines > baselineEntry.lines) {
					failures.push(
						makeViolation(
							"max-file-lines",
							filePath,
							`${filePath} grew from baselined ${baselineEntry.lines} lines to ${lines}; split related code before merging.`,
							{ lines, limit },
						),
					);
				}
			}
		}
	}

	if (isTestFile(filePath)) {
		continue;
	}

	const sourceText = readFileSync(absolute(filePath), "utf8");
	for (const importInfo of importDeclarations(filePath, sourceText)) {
		const targetPath = resolveImport(
			filePath,
			importInfo.specifier,
			trackedFileSet,
		);
		const violation = checkImportBoundary(filePath, importInfo, targetPath);
		if (!violation) {
			continue;
		}

		if (baselineImportEntries.has(violation.id)) {
			usedImportBaseline.add(violation.id);
			continue;
		}

		failures.push(violation);
	}
}

for (const entry of baseline.maxFileLines) {
	const limit = lineLimitFor(entry.path);
	if (!trackedFileSet.has(entry.path)) {
		failures.push(
			makeViolation(
				"stale-baseline",
				entry.path,
				`${baselinePath} contains ${entry.path}, but the file no longer exists or is no longer checked.`,
			),
		);
		continue;
	}

	const lines = lineCount(entry.path);
	if (limit !== null && lines <= limit) {
		failures.push(
			makeViolation(
				"stale-baseline",
				entry.path,
				`${entry.path} is now ${lines} lines, below limit ${limit}; remove its baseline entry.`,
			),
		);
		continue;
	}

	if (!usedLineBaseline.has(entry.path)) {
		failures.push(
			makeViolation(
				"stale-baseline",
				entry.path,
				`${baselinePath} contains an unused max-file-lines baseline for ${entry.path}.`,
			),
		);
	}
}

for (const entry of baseline.importBoundaries) {
	if (!usedImportBaseline.has(entry.id)) {
		failures.push(
			makeViolation(
				"stale-baseline",
				entry.path ?? entry.id,
				`${baselinePath} contains an unused import-boundary baseline: ${entry.id}.`,
			),
		);
	}
}

if (failures.length > 0) {
	console.error("Architecture check failed:");
	for (const failure of failures) {
		console.error(`- [${failure.rule}] ${failure.message}`);
	}
	process.exit(1);
}

console.log(
	`Architecture check passed for ${trackedFiles.length} TypeScript files.`,
);
