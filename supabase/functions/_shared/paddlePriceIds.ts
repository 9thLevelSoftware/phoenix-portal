/**
 * Canonical Paddle price ID → tier mapping for Edge Functions.
 * Uses PADDLE_EMBER_PRICE_IDS, PADDLE_FLAME_PRICE_IDS, PADDLE_INFERNO_PRICE_IDS
 * (comma-separated monthly + annual price IDs). Do not use VITE_* vars server-side.
 */

function splitIds(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Single price ID env (set to the same value as VITE_PADDLE_*_PRICE_ID in the portal bundle). */
function extraIds(
	env: { get(key: string): string | undefined },
	keys: string[],
): string[] {
	const out: string[] = [];
	for (const k of keys) {
		const v = env.get(k)?.trim();
		if (v) out.push(v);
	}
	return out;
}

export function getPaddlePriceIdSets(env: {
	get(key: string): string | undefined;
}): {
	ember: Set<string>;
	flame: Set<string>;
	inferno: Set<string>;
} {
	return {
		ember: new Set([
			...splitIds(env.get("PADDLE_EMBER_PRICE_IDS")),
			...extraIds(env, [
				"PADDLE_EMBER_MONTHLY_PRICE_ID",
				"PADDLE_EMBER_ANNUAL_PRICE_ID",
			]),
		]),
		flame: new Set([
			...splitIds(env.get("PADDLE_FLAME_PRICE_IDS")),
			...extraIds(env, [
				"PADDLE_FLAME_MONTHLY_PRICE_ID",
				"PADDLE_FLAME_ANNUAL_PRICE_ID",
			]),
		]),
		inferno: new Set([
			...splitIds(env.get("PADDLE_INFERNO_PRICE_IDS")),
			...extraIds(env, [
				"PADDLE_INFERNO_MONTHLY_PRICE_ID",
				"PADDLE_INFERNO_ANNUAL_PRICE_ID",
			]),
		]),
	};
}

/** All known paid price IDs across tiers (for allowlists). */
export function getAllAllowedPriceIds(env: {
	get(key: string): string | undefined;
}): Set<string> {
	const { ember, flame, inferno } = getPaddlePriceIdSets(env);
	return new Set([...ember, ...flame, ...inferno]);
}

export function mapPriceIdToTier(
	priceId: string,
	env: { get(key: string): string | undefined },
): "INFERNO" | "FLAME" | "EMBER" | "FREE" {
	const { ember, flame, inferno } = getPaddlePriceIdSets(env);
	if (inferno.has(priceId)) return "INFERNO";
	if (flame.has(priceId)) return "FLAME";
	if (ember.has(priceId)) return "EMBER";
	return "FREE";
}

/**
 * True when at least one purchasable paid tier is configured.
 * Inferno is optional in some environments, so billing should not hard-fail
 * when only Ember/Flame IDs are present.
 */
export function paddlePriceIdsConfigured(env: {
	get(key: string): string | undefined;
}): boolean {
	const { ember, flame, inferno } = getPaddlePriceIdSets(env);
	return ember.size + flame.size + inferno.size > 0;
}
