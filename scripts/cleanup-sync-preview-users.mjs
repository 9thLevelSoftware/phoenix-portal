import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const DISPOSABLE_EMAIL_PATTERN = /^sync-test-[a-z0-9-]+@test\.local$/;
const USERS_PER_PAGE = 1000;
const KNOWN_PRODUCTION_HOSTS = new Set([
	"ilzlswmatadlnsuxatcv.supabase.co",
	"ilzlswmatadlnsuxatcv.supabase.in",
	"api.phoenix-portal.com",
]);

class SafeCleanupError extends Error {}

function validSecret(value) {
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

function validateCleanupTarget(environment) {
	const previewRef = environment.SYNC_STAGING_PROJECT_REF;
	const productionRef = environment.SUPABASE_PROD_PROJECT_REF;
	const rawUrl = environment.SUPABASE_URL;
	const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY;
	if (
		!PROJECT_REF_PATTERN.test(previewRef ?? "") ||
		!PROJECT_REF_PATTERN.test(productionRef ?? "") ||
		previewRef === productionRef ||
		!validSecret(serviceKey)
	) {
		throw new SafeCleanupError(
			"Sync preview cleanup target configuration is invalid.",
		);
	}

	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new SafeCleanupError(
			"Sync preview cleanup target configuration is invalid.",
		);
	}
	const allowedHosts = new Set([
		`${previewRef}.supabase.co`,
		`${previewRef}.supabase.in`,
	]);
	const productionHosts = new Set([
		`${productionRef}.supabase.co`,
		`${productionRef}.supabase.in`,
	]);
	if (
		url.protocol !== "https:" ||
		!allowedHosts.has(url.hostname) ||
		KNOWN_PRODUCTION_HOSTS.has(url.hostname) ||
		productionHosts.has(url.hostname) ||
		url.username !== "" ||
		url.password !== "" ||
		url.port !== "" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new SafeCleanupError(
			"Sync preview cleanup target configuration is invalid.",
		);
	}

	return { previewRef, serviceKey, url: rawUrl };
}

export async function cleanupSyncPreviewUsers(environment, dependencies = {}) {
	const { previewRef, serviceKey, url } = validateCleanupTarget(environment);
	const create = dependencies.createClient ?? createClient;
	let client;
	try {
		client = create(url, serviceKey, {
			auth: {
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: false,
			},
		});
	} catch {
		throw new SafeCleanupError(
			`Sync preview cleanup could not list disposable users for preview ${previewRef}.`,
		);
	}

	const disposableUserIds = [];
	for (let page = 1; ; page += 1) {
		let result;
		try {
			result = await client.auth.admin.listUsers({
				page,
				perPage: USERS_PER_PAGE,
			});
		} catch {
			throw new SafeCleanupError(
				`Sync preview cleanup could not list disposable users for preview ${previewRef}.`,
			);
		}
		if (result.error || !Array.isArray(result.data?.users)) {
			throw new SafeCleanupError(
				`Sync preview cleanup could not list disposable users for preview ${previewRef}.`,
			);
		}

		for (const user of result.data.users) {
			if (
				typeof user?.id === "string" &&
				typeof user.email === "string" &&
				DISPOSABLE_EMAIL_PATTERN.test(user.email)
			) {
				disposableUserIds.push(user.id);
			}
		}
		if (result.data.users.length < USERS_PER_PAGE) {
			break;
		}
	}

	let deletedCount = 0;
	let failedCount = 0;
	for (const userId of disposableUserIds) {
		try {
			const { error } = await client.auth.admin.deleteUser(userId);
			if (error) {
				failedCount += 1;
			} else {
				deletedCount += 1;
			}
		} catch {
			failedCount += 1;
		}
	}
	if (failedCount > 0) {
		throw new SafeCleanupError(
			`Sync preview cleanup could not delete all disposable users for preview ${previewRef}.`,
		);
	}

	const log = dependencies.log ?? console.log;
	log(
		`Deleted ${deletedCount} disposable sync test users from preview ${previewRef}.`,
	);
	return deletedCount;
}

async function main() {
	try {
		await cleanupSyncPreviewUsers(process.env);
	} catch (error) {
		const message =
			error instanceof SafeCleanupError
				? error.message
				: "Sync preview cleanup failed.";
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
