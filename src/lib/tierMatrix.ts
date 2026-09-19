import type { SubscriptionTier } from "@/lib/subscription-entitlement";

type PaidTier = Exclude<SubscriptionTier, "FREE">;

/**
 * Minimum subscription tier per portal feature. `src/app/routes/index.tsx`
 * reads every route gate from this map, and
 * `src/lib/__tests__/pricing-tier-matrix.test.ts` checks the two agree.
 *
 * The route gates are UX only. What the server enforces:
 *   - EMBER: cloud sync (mobile-sync-push / mobile-sync-pull) and workout,
 *     record and profile writes (RLS).
 *   - FLAME: writes to community, sharing, challenges, follows, saved items,
 *     integrations, the sync queue and portal routine / cycle authoring (RLS,
 *     20260920000900_flame_write_policies.sql), the import RPCs, OAuth start
 *     (initiate-oauth) and the integration sync / rankings Edge Functions.
 *     Routines and cycles pushed from mobile stay EMBER (service-role push).
 *   - Analytics, compare, session replay and biomechanics (INFERNO) are gated
 *     in the browser only; they are computed from data the user can already
 *     read.
 */
export const FEATURE_MIN_TIER = {
	dashboard: "EMBER",
	history: "EMBER",
	goals: "EMBER",
	recovery: "EMBER",
	analytics: "FLAME",
	challenges: "FLAME",
	community: "FLAME",
	leaderboard: "FLAME",
	routines: "FLAME",
	cycles: "FLAME",
	compare: "FLAME",
	integrations: "FLAME",
	sessionReplay: "FLAME",
	biomechanics: "INFERNO",
} as const satisfies Record<string, PaidTier>;

export type GatedFeature = keyof typeof FEATURE_MIN_TIER;
