/**
 * Training-insight rules for the browser.
 *
 * There is exactly ONE rule engine (KD-14 / F-059): it lives in
 * `supabase/functions/_shared/insightRules.ts` so the scheduled Edge Function
 * and the browser fallback cannot drift. This module only re-exports it, so
 * the SPA keeps importing `@/lib/insights`. Do not add rules here.
 */
export {
	convertWeight,
	formatPersonalRecordName,
	formatRecordType,
	formatVolume,
	formatWeight,
	formatWorkoutPhase,
	generateInsights,
	type InsightInput,
	KG_TO_LBS,
	normalizeWeightUnit,
	type RecentPersonalRecord,
	roundWeightMetric,
	type TrainingInsight,
	type WeightUnit,
} from "../../supabase/functions/_shared/insightRules.ts";
