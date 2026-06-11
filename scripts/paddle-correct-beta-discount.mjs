#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PADDLE_ID_PATTERNS = {
	discount: /^dsc_[a-z0-9]{26}$/i,
	price: /^pri_[a-z0-9]{26}$/i,
	subscription: /^sub_[a-z0-9]{26}$/i,
};

const USAGE = `
Usage:
  PADDLE_API_KEY=... node scripts/paddle-correct-beta-discount.mjs \\
    --discount-id dsc_... \\
    --annual-price-id pri_... \\
    --subscription-id sub_... \\
    --next-billed-at 2026-08-09T00:00:00Z

Dry-run is the default. Add --apply to update Paddle.

Options:
  --discount-id <dsc_...>          Bad recurring discount ID.
  --annual-price-id <pri_...>      Annual price ID to allow. Repeatable or comma-separated.
  --subscription-id <sub_...>      Subscription ID to inspect. Repeatable or comma-separated.
  --subscriptions-file <path>      File containing subscription IDs, commas/newlines allowed.
  --next-billed-at <ISO datetime>  Correct next billing date.
  --environment <sandbox|production>
                                  Defaults to PADDLE_ENVIRONMENT, VITE_PADDLE_ENVIRONMENT, or sandbox.
  --disable-checkout               Also disable checkout redemption for the discount.
  --apply                          Apply mutations. Without this, previews only.
`;

function stripLineComment(line) {
	return line.replace(/#.*$/, "").trim();
}

function parseIdList(value, kind, label) {
	const pattern = PADDLE_ID_PATTERNS[kind];
	const ids = [];
	const seen = new Set();

	for (const rawLine of String(value ?? "").split(/\r?\n/)) {
		const line = stripLineComment(rawLine);
		if (!line) continue;

		for (const token of line.split(/[\s,]+/)) {
			const id = token.trim();
			if (!id) continue;
			if (!pattern.test(id)) {
				throw new Error(`Invalid Paddle ${label} ID: ${id}`);
			}
			if (!seen.has(id)) {
				seen.add(id);
				ids.push(id);
			}
		}
	}

	return ids;
}

export function parseSubscriptionIds(value) {
	return parseIdList(value, "subscription", "subscription");
}

export function parsePriceIds(value) {
	return parseIdList(value, "price", "price");
}

function parseDiscountId(value) {
	const discountId = String(value ?? "").trim();
	if (!PADDLE_ID_PATTERNS.discount.test(discountId)) {
		throw new Error(`Invalid Paddle discount ID: ${discountId || "<missing>"}`);
	}
	return discountId;
}

export function resolvePaddleBaseUrl(environment) {
	const normalized = String(environment ?? "").trim().toLowerCase();
	if (normalized === "sandbox") return "https://sandbox-api.paddle.com";
	if (normalized === "production") return "https://api.paddle.com";
	throw new Error(
		`Invalid Paddle environment: ${environment}. Expected sandbox or production.`,
	);
}

export function buildDiscountCorrectionPatch(nextBilledAt) {
	const parsed = new Date(nextBilledAt);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid next_billed_at datetime: ${nextBilledAt}`);
	}

	return {
		next_billed_at: parsed.toISOString(),
		discount: null,
		proration_billing_mode: "do_not_bill",
	};
}

export function validateCorrectionInputs({
	discountId,
	annualPriceIds,
	subscriptionIds,
	nextBilledAt,
	environment,
	now = new Date(),
}) {
	parseDiscountId(discountId);
	resolvePaddleBaseUrl(environment);

	if (!Array.isArray(subscriptionIds) || subscriptionIds.length === 0) {
		throw new Error("At least one subscription ID is required.");
	}
	for (const subscriptionId of subscriptionIds) {
		parseSubscriptionIds(subscriptionId);
	}

	if (!Array.isArray(annualPriceIds) || annualPriceIds.length === 0) {
		throw new Error("At least one annual price ID is required.");
	}
	for (const priceId of annualPriceIds) {
		parsePriceIds(priceId);
	}

	const patch = buildDiscountCorrectionPatch(nextBilledAt);
	if (new Date(patch.next_billed_at).getTime() <= now.getTime()) {
		throw new Error("next_billed_at must be in the future.");
	}

	return {
		discountId,
		annualPriceIds,
		subscriptionIds,
		nextBilledAt: patch.next_billed_at,
		environment,
	};
}

function getSubscriptionPriceIds(subscription) {
	return (subscription?.items ?? [])
		.map((item) => item?.price?.id)
		.filter((id) => typeof id === "string" && id.length > 0);
}

export function shouldCorrectSubscription(
	subscription,
	{ discountId, annualPriceIds },
) {
	const priceIds = getSubscriptionPriceIds(subscription);
	const priceId = priceIds[0] ?? null;

	if (subscription?.status === "past_due") {
		return { correct: false, reason: "past_due", priceId };
	}

	if (subscription?.discount?.id !== discountId) {
		return { correct: false, reason: "discount_mismatch", priceId };
	}

	const annualPriceIdSet = annualPriceIds instanceof Set
		? annualPriceIds
		: new Set(annualPriceIds);
	const matchingAnnualPriceId = priceIds.find((id) => annualPriceIdSet.has(id));
	if (!matchingAnnualPriceId) {
		return { correct: false, reason: "price_not_annual", priceId };
	}

	return { correct: true, priceId: matchingAnnualPriceId };
}

export function parseArgs(argv, env = process.env) {
	const options = {
		apply: false,
		disableCheckout: false,
		discountId: "",
		environment: env.PADDLE_ENVIRONMENT || env.VITE_PADDLE_ENVIRONMENT || "sandbox",
		nextBilledAt: "",
		subscriptionIds: [],
		annualPriceIds: [],
		subscriptionsFile: "",
	};

	for (let i = 2; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--help" || token === "-h") {
			options.help = true;
			continue;
		}
		if (token === "--apply") {
			options.apply = true;
			continue;
		}
		if (token === "--disable-checkout") {
			options.disableCheckout = true;
			continue;
		}

		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			throw new Error(`Missing value for ${token}`);
		}

		switch (token) {
			case "--discount-id":
				options.discountId = parseDiscountId(next);
				break;
			case "--environment":
				options.environment = next;
				break;
			case "--next-billed-at":
				options.nextBilledAt = next;
				break;
			case "--subscription-id":
				options.subscriptionIds.push(...parseSubscriptionIds(next));
				break;
			case "--subscriptions-file":
				options.subscriptionsFile = next;
				break;
			case "--annual-price-id":
				options.annualPriceIds.push(...parsePriceIds(next));
				break;
			default:
				throw new Error(`Unknown option: ${token}`);
		}
		i += 1;
	}

	return options;
}

async function loadSubscriptionIdsFromFile(filePath) {
	if (!filePath) return [];
	const body = await readFile(path.resolve(filePath), "utf8");
	return parseSubscriptionIds(body);
}

async function paddleRequest({ apiKey, baseUrl, method = "GET", pathname, body }) {
	const response = await fetch(`${baseUrl}${pathname}`, {
		method,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	const text = await response.text();
	let parsed = null;
	if (text.trim()) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = null;
		}
	}

	if (!response.ok) {
		const detail = text.length > 500 ? `${text.slice(0, 500)}...` : text;
		throw new Error(
			`Paddle ${method} ${pathname} failed with ${response.status}: ${detail}`,
		);
	}

	return parsed;
}

function previewSummary(previewBody) {
	const data = previewBody?.data;
	const nextTotal = data?.next_transaction?.details?.totals?.total;
	const recurringTotal = data?.recurring_transaction_details?.totals?.total;
	const currency =
		data?.next_transaction?.currency_code ??
		data?.recurring_transaction_details?.currency_code ??
		"";

	const parts = [];
	if (nextTotal !== undefined) parts.push(`next total=${nextTotal}${currency}`);
	if (recurringTotal !== undefined) {
		parts.push(`recurring total=${recurringTotal}${currency}`);
	}
	return parts.length > 0 ? parts.join(", ") : "preview returned";
}

async function main() {
	const options = parseArgs(process.argv);
	if (options.help) {
		process.stdout.write(USAGE);
		return;
	}

	const fileSubscriptionIds = await loadSubscriptionIdsFromFile(
		options.subscriptionsFile,
	);
	const subscriptionIds = [
		...new Set([...options.subscriptionIds, ...fileSubscriptionIds]),
	];

	const validated = validateCorrectionInputs({
		...options,
		subscriptionIds,
		now: new Date(),
	});
	const patch = buildDiscountCorrectionPatch(validated.nextBilledAt);
	const baseUrl = resolvePaddleBaseUrl(validated.environment);
	const apiKey = process.env.PADDLE_API_KEY?.trim();

	if (!apiKey) {
		throw new Error("PADDLE_API_KEY must be set in the environment.");
	}

	process.stdout.write(
		[
			`Paddle environment: ${validated.environment}`,
			`Mode: ${options.apply ? "apply" : "dry-run"}`,
			`Target discount: ${validated.discountId}`,
			`Correct next_billed_at: ${patch.next_billed_at}`,
			`Subscription count: ${subscriptionIds.length}`,
			"",
		].join("\n"),
	);

	if (options.disableCheckout) {
		if (options.apply) {
			await paddleRequest({
				apiKey,
				baseUrl,
				method: "PATCH",
				pathname: `/discounts/${validated.discountId}`,
				body: { enabled_for_checkout: false },
			});
			process.stdout.write("Disabled checkout redemption for the discount.\n");
		} else {
			process.stdout.write(
				`[dry-run] Would disable checkout redemption for ${validated.discountId}.\n`,
			);
		}
	}

	const annualPriceIds = new Set(validated.annualPriceIds);
	let corrected = 0;
	let previewed = 0;
	let skipped = 0;

	for (const subscriptionId of subscriptionIds) {
		const subscriptionBody = await paddleRequest({
			apiKey,
			baseUrl,
			pathname: `/subscriptions/${subscriptionId}`,
		});
		const subscription = subscriptionBody?.data;
		if (!subscription?.id || subscription.id !== subscriptionId) {
			throw new Error(`Paddle returned a mismatched subscription for ${subscriptionId}.`);
		}

		const decision = shouldCorrectSubscription(subscription, {
			discountId: validated.discountId,
			annualPriceIds,
		});

		if (!decision.correct) {
			skipped += 1;
			process.stdout.write(
				`[skip] ${subscriptionId}: ${decision.reason} (price=${decision.priceId ?? "none"})\n`,
			);
			continue;
		}

		const preview = await paddleRequest({
			apiKey,
			baseUrl,
			method: "PATCH",
			pathname: `/subscriptions/${subscriptionId}/preview`,
			body: patch,
		});
		previewed += 1;
		process.stdout.write(
			`[preview] ${subscriptionId}: ${previewSummary(preview)}\n`,
		);

		if (options.apply) {
			await paddleRequest({
				apiKey,
				baseUrl,
				method: "PATCH",
				pathname: `/subscriptions/${subscriptionId}`,
				body: patch,
			});
			corrected += 1;
			process.stdout.write(`[applied] ${subscriptionId}\n`);
		} else {
			process.stdout.write(
				`[dry-run] Would remove discount and set next_billed_at for ${subscriptionId}.\n`,
			);
		}
	}

	process.stdout.write(
		`\nDone. Previewed ${previewed} subscription(s); corrected ${corrected}; skipped ${skipped}.\n`,
	);
}

const isMain =
	process.argv[1] != null &&
	pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
	main().catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.stderr.write(USAGE);
		process.exitCode = 1;
	});
}
