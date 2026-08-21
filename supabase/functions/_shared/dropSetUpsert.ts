/**
 * Per-row merge for routine_exercises drop-set columns on mobile-sync-push.
 *
 * Older clients omit or null these fields. Spreading them only when present
 * is not enough: a null floor with an omitted flag leaves drop_set_enabled
 * true and fails routine_exercises_drop_set_floor_required, and Supabase
 * upsert defaultToNull unions keys across a heterogeneous batch so an
 * omitted flag on one row becomes NULL when a sibling row supplies it.
 * Always emit both columns, filling gaps from the existing server row.
 */

export interface IncomingDropSetFields {
	dropSetEnabled?: boolean | null;
	dropSetMinWeightKg?: number | null;
}

export interface ExistingDropSetFields {
	drop_set_enabled: boolean;
	drop_set_min_weight_kg: number | null;
}

export interface DropSetUpsertFields {
	drop_set_enabled: boolean;
	drop_set_min_weight_kg: number | null;
}

export function coerceDropSetMinWeightKg(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export function needsDropSetExistingRow(
	incoming: IncomingDropSetFields,
): boolean {
	if (typeof incoming.dropSetEnabled !== "boolean") return true;
	if (incoming.dropSetMinWeightKg === undefined) return true;
	return (
		incoming.dropSetEnabled === true && incoming.dropSetMinWeightKg == null
	);
}

export function resolveDropSetUpsertFields(
	incoming: IncomingDropSetFields,
	existing: ExistingDropSetFields | null,
): DropSetUpsertFields {
	const enabledProvided = typeof incoming.dropSetEnabled === "boolean";
	const minProvided = incoming.dropSetMinWeightKg !== undefined;
	const existingEnabled = existing?.drop_set_enabled ?? false;
	const existingMin = existing?.drop_set_min_weight_kg ?? null;

	const drop_set_enabled = enabledProvided
		? incoming.dropSetEnabled
		: existingEnabled;

	let drop_set_min_weight_kg = minProvided
		? incoming.dropSetMinWeightKg
		: existingMin;

	// Never persist enabled=true with a null floor. Legacy null/omitted
	// payloads would otherwise keep the existing true flag and blank the
	// floor, which the CHECK rejects for the whole upsert.
	if (drop_set_enabled && drop_set_min_weight_kg == null) {
		drop_set_min_weight_kg = existingMin;
	}

	return { drop_set_enabled, drop_set_min_weight_kg };
}
