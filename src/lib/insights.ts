/**
 * Training-insight rules for the browser.
 *
 * There is exactly ONE rule engine (KD-14 / F-059): it lives in
 * `supabase/functions/_shared/insightRules.ts` so the scheduled Edge Function
 * and the browser fallback cannot drift. This module re-exports the insight
 * API the SPA imports from `@/lib/insights`. Do not add rules here.
 */
export {
	generateInsights,
	type InsightInput,
	type TrainingInsight,
} from "../../supabase/functions/_shared/insightRules.ts";
