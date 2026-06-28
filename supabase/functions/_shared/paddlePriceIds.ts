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
function extraIds(env: { get(key: string): string | undefined }, keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const v = env.get(k)?.trim();
    if (v) out.push(v);
  }
  return out;
}

export type PaddlePaidTier = "EMBER" | "FLAME" | "INFERNO";
export type PaddleBillingInterval = "monthly" | "annual";

const PRICE_ID_BY_TIER_INTERVAL: Record<
  PaddlePaidTier,
  Record<PaddleBillingInterval, string>
> = {
  EMBER: {
    monthly: "PADDLE_EMBER_MONTHLY_PRICE_ID",
    annual: "PADDLE_EMBER_ANNUAL_PRICE_ID",
  },
  FLAME: {
    monthly: "PADDLE_FLAME_MONTHLY_PRICE_ID",
    annual: "PADDLE_FLAME_ANNUAL_PRICE_ID",
  },
  INFERNO: {
    monthly: "PADDLE_INFERNO_MONTHLY_PRICE_ID",
    annual: "PADDLE_INFERNO_ANNUAL_PRICE_ID",
  },
};

export function parsePaddlePaidTier(value: unknown): PaddlePaidTier | null {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase();
  return normalized === "EMBER" || normalized === "FLAME" || normalized === "INFERNO"
    ? normalized
    : null;
}

export function parsePaddleBillingInterval(value: unknown): PaddleBillingInterval | null {
  if (value === "monthly" || value === "annual") return value;
  return null;
}

export function getConfiguredPriceIdForTierInterval(
  tier: PaddlePaidTier,
  billingInterval: PaddleBillingInterval,
  env: { get(key: string): string | undefined },
): string | null {
  return env.get(PRICE_ID_BY_TIER_INTERVAL[tier][billingInterval])?.trim() || null;
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

/**
 * Detect price IDs configured under more than one tier. `mapPriceIdToTier`
 * resolves such collisions by fixed precedence (INFERNO > FLAME > EMBER), which
 * can silently map a customer to the wrong paid tier when a price ID is copied
 * into the wrong secret. Returns the list of duplicated price IDs so callers can
 * log a fatal configuration error instead of relying on precedence.
 */
export function findCrossTierDuplicatePriceIds(env: {
  get(key: string): string | undefined;
}): string[] {
  const { ember, flame, inferno } = getPaddlePriceIdSets(env);
  const counts = new Map<string, number>();
  for (const set of [ember, flame, inferno]) {
    for (const id of set) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}
