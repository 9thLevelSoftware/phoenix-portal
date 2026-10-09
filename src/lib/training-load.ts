/**
 * Resistance Training Load for the browser.
 *
 * There is exactly ONE calculator: `supabase/functions/_shared/trainingLoad.ts`,
 * shared with `generate-insights` so the scheduled insights and the Analytics
 * RTL cannot drift. This module re-exports it and adds only the portal zone
 * classifier. Do not reimplement `calculateRTL` here.
 */
export {
	calculateRTL,
	type WorkoutLoadInput,
} from "../../supabase/functions/_shared/trainingLoad.ts";

export type TrainingLoadZone = "low" | "optimal" | "high";

export function classifyTrainingLoad(rtl: number): TrainingLoadZone {
	if (rtl < 35) return "low";
	if (rtl < 75) return "optimal";
	return "high";
}
