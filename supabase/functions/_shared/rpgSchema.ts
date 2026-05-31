/**
 * Shared RPG attribute wire schema + defensive rounding.
 *
 * The mobile Kotlin side decodes RPG attributes as kotlinx.serialization `Int`.
 * If any portal aggregation path emits a non-integer number (e.g. from an
 * average or ratio), kotlinx.serialization throws on the mobile client.
 *
 * Guard at both boundaries (push write and pull projection) with
 * `roundRpgFloats()`. Cheaper and more localized than a DB CHECK constraint,
 * and defends against misbehaving producers without requiring a migration.
 *
 * Resolves audit item #8 (2026-04-19).
 */

const INT_FIELDS = [
	"strength",
	"power",
	"stamina",
	"consistency",
	"mastery",
	"level",
	"experiencePoints",
	"experience_points",
] as const;

/**
 * Round any numeric RPG integer fields on the supplied record. Returns a new
 * object; does not mutate the input. Non-numeric and unknown fields are left
 * untouched. Use on both the mobile-sync-push inbound write path and the
 * mobile-sync-pull projection output.
 */
export function roundRpgFloats<T extends Record<string, unknown>>(input: T): T {
	const out: Record<string, unknown> = { ...input };
	for (const field of INT_FIELDS) {
		const value = out[field];
		if (typeof value === "number" && Number.isFinite(value)) {
			out[field] = Math.round(value);
		}
	}
	return out as T;
}
