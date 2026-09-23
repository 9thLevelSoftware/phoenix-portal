import type { SubscriptionTier } from "@/lib/subscription-entitlement";

type PaidTier = Exclude<SubscriptionTier, "FREE">;

/**
 * Minimum subscription tier per portal feature. `src/app/routes/index.tsx`
 * reads every route gate from this map, the session-replay gate
 * (`session-replay/SessionReplay.tsx`) and the INFERNO biomechanics gates
 * inside Analytics (`analytics/PerformanceTab.tsx`,
 * `analytics/MobilePerformanceTab.tsx`) and the `/biomechanics` page
 * (`Biomechanics.tsx`) read from it, and
 * `src/lib/__tests__/pricing-tier-matrix.test.ts` checks they all agree.
 *
 * Most route gates are UX only. What the server enforces:
 *   - EMBER: cloud sync (mobile-sync-push / mobile-sync-pull) and workout,
 *     record and profile writes (RLS).
 *   - FLAME: writes to community, sharing, challenges, follows, saved items,
 *     integrations, the sync queue and portal routine / cycle authoring (RLS,
 *     20260920000900_flame_write_policies.sql), the import RPCs, OAuth start
 *     (initiate-oauth) and the integration sync / rankings Edge Functions.
 *     Routines and cycles pushed from mobile stay EMBER (service-role push).
 *   - INFERNO: the force-curve and biomechanics DATA — rep_telemetry (and the
 *     telemetry_points view), vbt_assessments, session_phase_statistics and
 *     exercise_signatures — is SELECT-gated in RLS
 *     (20260920003800_inferno_read_policies.sql), so a FLAME user reads zero
 *     rows rather than being stopped at a screen. The GDPR export is
 *     unaffected (export-user-data reads with the service role).
 *   - Analytics, compare and session replay itself stay browser-gated: they
 *     are computed from data the user can already read. Session replay
 *     without force curves is FLAME and degrades to rep-by-rep playback from
 *     rep_summaries, with an explicit "Force curves require Inferno" notice.
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
