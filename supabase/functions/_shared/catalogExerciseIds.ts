/**
 * Resolve incoming mobile exercise IDs against exercise_catalog.
 *
 * Library rows (is_custom = false) are visible to every user. Custom rows are
 * visible only to their owner. Unknown IDs are remapped by normalized name
 * when possible, otherwise null — callers must drop NOT NULL dependents.
 */

export interface CatalogLookupRow {
	id: string;
	name?: string | null;
	display_name?: string | null;
	aliases?: string[] | null;
	user_id?: string | null;
	is_custom?: boolean | null;
	archived?: boolean | null;
}

export interface CatalogIdRef {
	id?: string | null;
	name?: string | null;
}

export interface CatalogIdIndexes {
	byId: Map<string, string>;
	byName: Map<string, string>;
}

export function normalizeCatalogKey(name: string | null | undefined): string {
	return String(name ?? "")
		.toLowerCase()
		.replace(/[-_/()]+/g, " ")
		.replace(/[^a-z0-9\s]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function isAccessibleCatalogRow(
	row: CatalogLookupRow,
	userId: string,
): boolean {
	if (row.is_custom === true) {
		return row.user_id === userId;
	}
	return true;
}

export function buildCatalogIndexes(
	rows: CatalogLookupRow[],
	userId: string,
): CatalogIdIndexes {
	const byId = new Map<string, string>();
	const byName = new Map<string, string>();

	for (const row of rows) {
		if (!row.id || !isAccessibleCatalogRow(row, userId)) continue;
		byId.set(row.id, row.id);
		// Archived rows stay valid FK targets but must never win a name match
		// against an active open-source row with the same normalized name.
		if (row.archived === true) continue;
		const labels = [row.name, row.display_name, ...(row.aliases ?? [])];
		for (const label of labels) {
			const key = normalizeCatalogKey(label);
			if (key && !byName.has(key)) {
				byName.set(key, row.id);
			}
		}
	}

	return { byId, byName };
}

export function resolveCatalogExerciseId(
	indexes: CatalogIdIndexes,
	id?: string | null,
	name?: string | null,
): string | null {
	if (typeof id === "string" && id.length > 0) {
		const direct = indexes.byId.get(id);
		if (direct) return direct;
		const fromIdName = indexes.byName.get(normalizeCatalogKey(name));
		if (fromIdName) return fromIdName;
		return null;
	}

	const fromName = indexes.byName.get(normalizeCatalogKey(name));
	return fromName ?? null;
}

export function resolveCatalogExerciseIds(
	indexes: CatalogIdIndexes,
	refs: CatalogIdRef[],
): {
	resolved: Map<string, string | null>;
	matched: number;
	nameMatched: number;
	unmatched: number;
} {
	const resolved = new Map<string, string | null>();
	let matched = 0;
	let nameMatched = 0;
	let unmatched = 0;

	for (const ref of refs) {
		const original = typeof ref.id === "string" && ref.id.length > 0 ? ref.id : "";
		if (!original && !ref.name) continue;
		if (original && resolved.has(original)) continue;

		const value = resolveCatalogExerciseId(indexes, ref.id, ref.name);
		if (original) {
			resolved.set(original, value);
		}
		if (value && original && indexes.byId.has(original)) {
			matched += 1;
		} else if (value) {
			nameMatched += 1;
		} else {
			unmatched += 1;
		}
	}

	return { resolved, matched, nameMatched, unmatched };
}

export function catalogLookupFromUnknown(data: unknown): CatalogLookupRow[] {
	if (!Array.isArray(data)) return [];
	const rows: CatalogLookupRow[] = [];
	for (const item of data) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		if (typeof row.id !== "string") continue;
		rows.push({
			id: row.id,
			name: typeof row.name === "string" ? row.name : null,
			display_name:
				typeof row.display_name === "string" ? row.display_name : null,
			aliases: Array.isArray(row.aliases)
				? row.aliases.filter((value): value is string => typeof value === "string")
				: null,
			user_id: typeof row.user_id === "string" ? row.user_id : null,
			is_custom: typeof row.is_custom === "boolean" ? row.is_custom : null,
			archived: typeof row.archived === "boolean" ? row.archived : null,
		});
	}
	return rows;
}
