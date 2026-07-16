import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MANAGEMENT_API_BASE = "https://api.supabase.com";
const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const READY_BRANCH_STATUSES = new Set([
	"MIGRATIONS_PASSED",
	"FUNCTIONS_DEPLOYED",
]);
const KNOWN_PRODUCTION_HOSTS = new Set([
	"ilzlswmatadlnsuxatcv.supabase.co",
	"ilzlswmatadlnsuxatcv.supabase.in",
	"api.phoenix-portal.com",
]);

class SafeResolverError extends Error {}

function optionalValue(value) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireSingleLine(value, message) {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.trim() !== value ||
		/[\r\n\0]/.test(value)
	) {
		throw new SafeResolverError(message);
	}
	return value;
}

function expectedPreviewRef(environment) {
	const configuredRef = optionalValue(environment.SYNC_STAGING_PROJECT_REF);
	const dispatchedRef = optionalValue(environment.STAGING_PROJECT_REF_INPUT);

	if (configuredRef && dispatchedRef && configuredRef !== dispatchedRef) {
		throw new SafeResolverError(
			"Configured and dispatched staging project refs differ.",
		);
	}

	const expectedRef = configuredRef ?? dispatchedRef;
	if (!expectedRef) {
		throw new SafeResolverError(
			"Expected staging project ref is required for live mode.",
		);
	}
	if (!PROJECT_REF_PATTERN.test(expectedRef)) {
		throw new SafeResolverError("Expected staging project ref is invalid.");
	}
	return expectedRef;
}

function isUsableKeyValue(value) {
	return (
		typeof value === "string" &&
		value.length >= 16 &&
		value.trim() === value &&
		!/[\s\0]/.test(value) &&
		!value.includes("...") &&
		!value.includes("••") &&
		!value.includes("***") &&
		!/(?:masked|redacted)/i.test(value)
	);
}

function requireUsableDirectKey(value, label) {
	if (!isUsableKeyValue(value)) {
		throw new SafeResolverError(`Direct staging ${label} is unusable.`);
	}
	return value;
}

function validateDirectUrl(rawUrl, expectedRef) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SafeResolverError(
			"Direct staging URL does not exactly match the expected staging project ref.",
		);
	}

	if (KNOWN_PRODUCTION_HOSTS.has(url.hostname)) {
		throw new SafeResolverError(
			"Direct staging URL resolves to a known production host.",
		);
	}

	const allowedHosts = new Set([
		`${expectedRef}.supabase.co`,
		`${expectedRef}.supabase.in`,
	]);
	if (
		url.protocol !== "https:" ||
		!allowedHosts.has(url.hostname) ||
		url.username !== "" ||
		url.password !== "" ||
		url.port !== "" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new SafeResolverError(
			"Direct staging URL does not exactly match the expected staging project ref.",
		);
	}
}

function directCredentials(environment, expectedRef) {
	const url = optionalValue(environment.SYNC_STAGING_SUPABASE_URL);
	const anonKey = optionalValue(environment.SYNC_STAGING_SUPABASE_ANON_KEY);
	const serviceRoleKey = optionalValue(
		environment.SYNC_STAGING_SUPABASE_SERVICE_ROLE_KEY,
	);
	const configuredCount = [url, anonKey, serviceRoleKey].filter(Boolean).length;

	if (configuredCount > 0 && configuredCount < 3) {
		throw new SafeResolverError(
			"Direct staging credentials are partially configured; refusing to mix credential sources.",
		);
	}
	if (configuredCount === 0) {
		return undefined;
	}

	validateDirectUrl(url, expectedRef);
	return {
		url,
		anonKey: requireUsableDirectKey(anonKey, "client key"),
		serviceRoleKey: requireUsableDirectKey(serviceRoleKey, "elevated key"),
		previewRef: expectedRef,
		source: "direct",
	};
}

async function managementGetJson(fetcher, path, accessToken, operation) {
	let response;
	try {
		response = await fetcher(`${MANAGEMENT_API_BASE}${path}`, {
			method: "GET",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
		});
	} catch {
		throw new SafeResolverError(`Management API ${operation} request failed.`);
	}

	if (!response.ok) {
		throw new SafeResolverError(
			`Management API ${operation} request failed with HTTP ${response.status}.`,
		);
	}

	try {
		return await response.json();
	} catch {
		throw new SafeResolverError(
			`Management API ${operation} returned invalid JSON.`,
		);
	}
}

function branchList(response) {
	if (Array.isArray(response)) {
		return response;
	}
	if (
		response &&
		typeof response === "object" &&
		Array.isArray(response.branches)
	) {
		return response.branches;
	}
	throw new SafeResolverError(
		"Management API branch-list returned an unexpected response shape.",
	);
}

function validatePreviewBranch(branch, expectedRef, productionRef, gitBranch) {
	if (branch.is_default !== false) {
		throw new SafeResolverError(
			`Preview ${expectedRef} must not be the default branch.`,
		);
	}
	if (branch.parent_project_ref !== productionRef) {
		throw new SafeResolverError(
			`Preview ${expectedRef} does not belong to the configured production project.`,
		);
	}
	if (branch.git_branch !== gitBranch) {
		throw new SafeResolverError(
			`Preview ${expectedRef} does not match GITHUB_REF_NAME.`,
		);
	}
	if (!READY_BRANCH_STATUSES.has(branch.status)) {
		const status = safeStatus(branch.status);
		throw new SafeResolverError(
			`Preview ${expectedRef} is not ready (status: ${status}).`,
		);
	}
	if (
		Object.hasOwn(branch, "preview_project_status") &&
		branch.preview_project_status !== "ACTIVE_HEALTHY"
	) {
		const status = safeStatus(branch.preview_project_status);
		throw new SafeResolverError(
			`Preview ${expectedRef} is not healthy (preview status: ${status}).`,
		);
	}
}

function safeStatus(value) {
	if (value === undefined || value === null) {
		return "MISSING";
	}
	return typeof value === "string" && /^[A-Z_]{1,40}$/.test(value)
		? value
		: "INVALID";
}

function isEnabledKey(key) {
	return !(
		key.disabled === true ||
		key.disabled === "true" ||
		key.is_disabled === true ||
		key.is_disabled === "true" ||
		(typeof key.status === "string" && key.status.toLowerCase() === "disabled")
	);
}

function usableApiKey(key, expectedType) {
	if (!key || typeof key !== "object" || !isEnabledKey(key)) {
		return undefined;
	}
	if (!isUsableKeyValue(key.api_key)) {
		return undefined;
	}
	if (
		expectedType === "publishable" &&
		!key.api_key.startsWith("sb_publishable_")
	) {
		return undefined;
	}
	if (expectedType === "secret" && !key.api_key.startsWith("sb_secret_")) {
		return undefined;
	}
	return key.api_key;
}

function selectApiKeys(response) {
	if (!Array.isArray(response)) {
		throw new SafeResolverError(
			"Management API api-key request returned an unexpected response shape.",
		);
	}

	const anonKey =
		response
			.map((key) =>
				key?.type === "publishable"
					? usableApiKey(key, "publishable")
					: undefined,
			)
			.find(Boolean) ??
		response
			.map((key) =>
				key?.name === "anon" || key?.type === "anon"
					? usableApiKey(key)
					: undefined,
			)
			.find(Boolean);
	const serviceRoleKey =
		response
			.map((key) =>
				key?.type === "secret" ? usableApiKey(key, "secret") : undefined,
			)
			.find(Boolean) ??
		response
			.map((key) =>
				key?.name === "service_role" || key?.type === "service_role"
					? usableApiKey(key)
					: undefined,
			)
			.find(Boolean);

	if (!anonKey) {
		throw new SafeResolverError(
			"No usable publishable or anon key was returned for the preview.",
		);
	}
	if (!serviceRoleKey) {
		throw new SafeResolverError(
			"No usable secret or service_role key was returned for the preview.",
		);
	}
	return { anonKey, serviceRoleKey };
}

export async function resolveSyncPreviewCredentials(
	environment,
	dependencies = {},
) {
	const expectedRef = expectedPreviewRef(environment);
	const configuredProductionRef = optionalValue(
		environment.SUPABASE_PROD_PROJECT_REF,
	);
	if (
		configuredProductionRef &&
		!PROJECT_REF_PATTERN.test(configuredProductionRef)
	) {
		throw new SafeResolverError("Production project ref is invalid.");
	}
	if (configuredProductionRef === expectedRef) {
		throw new SafeResolverError(
			"Expected staging project ref must differ from the production project ref.",
		);
	}
	const direct = directCredentials(environment, expectedRef);
	if (direct) {
		return direct;
	}

	const productionRef =
		configuredProductionRef ??
		requireSingleLine(
			environment.SUPABASE_PROD_PROJECT_REF,
			"Production project ref is required for Management API resolution.",
		);

	const accessToken = requireSingleLine(
		environment.SUPABASE_ACCESS_TOKEN,
		"Supabase access token is required for Management API resolution.",
	);
	const gitBranch = requireSingleLine(
		environment.GITHUB_REF_NAME,
		"GITHUB_REF_NAME is required for preview verification.",
	);
	const fetcher = dependencies.fetch ?? globalThis.fetch;
	if (typeof fetcher !== "function") {
		throw new SafeResolverError("Management API fetch is unavailable.");
	}

	const branchesResponse = await managementGetJson(
		fetcher,
		`/v1/projects/${productionRef}/branches`,
		accessToken,
		"branch-list",
	);
	const previewBranch = branchList(branchesResponse).find(
		(branch) => branch?.project_ref === expectedRef,
	);
	if (!previewBranch) {
		throw new SafeResolverError(
			`Expected preview ${expectedRef} was not found in production branch metadata.`,
		);
	}
	validatePreviewBranch(previewBranch, expectedRef, productionRef, gitBranch);

	const keysResponse = await managementGetJson(
		fetcher,
		`/v1/projects/${expectedRef}/api-keys?reveal=true`,
		accessToken,
		"api-key",
	);
	const { anonKey, serviceRoleKey } = selectApiKeys(keysResponse);
	return {
		url: `https://${expectedRef}.supabase.co`,
		anonKey,
		serviceRoleKey,
		previewRef: expectedRef,
		source: "management-api",
	};
}

export async function runSyncPreviewResolver(environment, dependencies = {}) {
	const credentials = await resolveSyncPreviewCredentials(
		environment,
		dependencies,
	);
	const githubEnv = requireSingleLine(
		environment.GITHUB_ENV,
		"GITHUB_ENV is required for live credential handoff.",
	);
	const log = dependencies.log ?? console.log;
	const append = dependencies.appendFile ?? appendFile;

	log(`::add-mask::${credentials.anonKey}`);
	log(`::add-mask::${credentials.serviceRoleKey}`);
	await append(
		githubEnv,
		`SUPABASE_URL=${credentials.url}\n` +
			`SUPABASE_ANON_KEY=${credentials.anonKey}\n` +
			`SUPABASE_SERVICE_ROLE_KEY=${credentials.serviceRoleKey}\n` +
			`SYNC_STAGING_PROJECT_REF=${credentials.previewRef}\n`,
	);
	log(
		`Resolved live sync preview ${credentials.previewRef} using ${credentials.source} credentials.`,
	);
}

async function main() {
	try {
		await runSyncPreviewResolver(process.env);
	} catch (error) {
		const message =
			error instanceof SafeResolverError
				? error.message
				: "Sync preview credential resolution failed.";
		console.error(`::error::${message}`);
		process.exitCode = 1;
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await main();
}
