import { supabase } from "@/lib/supabase";
import { fetchAllSupabasePagesForChunks } from "@/lib/supabasePaging";

export const PERSONAL_RECORD_WITH_CATALOG_SELECT =
	"*, catalog:exercise_catalog(id, name, display_name)";

export const STRENGTH_PROGRESS_WITH_CATALOG_SELECT =
	"exercise_name, exercise_id, session_id, record_type, workout_phase, value, achieved_at, catalog:exercise_catalog(id, name, display_name)";

interface CatalogJoinRow {
	id?: string | null;
	name?: string | null;
	display_name?: string | null;
}

export interface PersonalRecordCatalogJoinRow {
	exercise_name?: string | null;
	exercise_id?: string | null;
	session_id?: string | null;
	catalog?: CatalogJoinRow | CatalogJoinRow[] | null;
}

export interface SessionExerciseCatalogJoinRow {
	id?: string | null;
	session_id?: string | null;
	name?: string | null;
	exercise_id?: string | null;
	catalog?: CatalogJoinRow | CatalogJoinRow[] | null;
}

function firstCatalog(catalog: PersonalRecordCatalogJoinRow["catalog"]) {
	return Array.isArray(catalog) ? catalog[0] : catalog;
}

function catalogLabel(
	catalog: CatalogJoinRow | null | undefined,
): string | null {
	const displayName = catalog?.display_name?.trim();
	if (displayName) return displayName;
	const name = catalog?.name?.trim();
	return name || null;
}

function isIdentifierShaped(value: string): boolean {
	return (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			value,
		) ||
		(/^[A-Za-z0-9_-]{12,}$/.test(value) && /\d/.test(value))
	);
}

export function normalizePersonalRecordCatalogDisplayNames<
	T extends PersonalRecordCatalogJoinRow,
>(rows: readonly T[] | null | undefined): T[] {
	return (rows ?? []).map((row) => {
		const catalog = firstCatalog(row.catalog);
		const label = catalogLabel(catalog);
		if (!catalog?.id || !label) return row;

		const rawName = row.exercise_name?.trim() ?? "";
		const rawExerciseId = row.exercise_id?.trim() ?? "";
		const nameIsCatalogId =
			rawName.length === 0 ||
			rawName === catalog.id ||
			(rawExerciseId.length > 0 && rawName === rawExerciseId);

		if (!nameIsCatalogId) return row;

		return {
			...row,
			exercise_name: label,
		};
	});
}

export function sessionIdsNeedingExerciseNameLookup(
	rows: readonly PersonalRecordCatalogJoinRow[] | null | undefined,
): string[] {
	const sessionIds = new Set<string>();
	for (const row of rows ?? []) {
		const rawName = row.exercise_name?.trim() ?? "";
		const sessionId = row.session_id?.trim() ?? "";
		if (sessionId && isIdentifierShaped(rawName)) {
			sessionIds.add(sessionId);
		}
	}
	return [...sessionIds];
}

export function normalizePersonalRecordSessionExerciseDisplayNames<
	T extends PersonalRecordCatalogJoinRow,
>(
	rows: readonly T[] | null | undefined,
	exercises: readonly SessionExerciseCatalogJoinRow[],
): T[] {
	const exerciseBySessionAndId = new Map<
		string,
		SessionExerciseCatalogJoinRow
	>();
	for (const exercise of exercises) {
		const sessionId = exercise.session_id?.trim();
		const exerciseRowId = exercise.id?.trim();
		if (!sessionId || !exerciseRowId) continue;

		exerciseBySessionAndId.set(`${sessionId}:${exerciseRowId}`, exercise);
		const catalogExerciseId = exercise.exercise_id?.trim();
		if (catalogExerciseId) {
			exerciseBySessionAndId.set(`${sessionId}:${catalogExerciseId}`, exercise);
		}
	}

	return (rows ?? []).map((row) => {
		const rawName = row.exercise_name?.trim() ?? "";
		const sessionId = row.session_id?.trim() ?? "";
		if (!sessionId || !isIdentifierShaped(rawName)) return row;

		const exercise = exerciseBySessionAndId.get(`${sessionId}:${rawName}`);
		if (!exercise) return row;

		const label = catalogLabel(firstCatalog(exercise.catalog));
		const exerciseName = exercise.name?.trim();
		const displayName = label ?? exerciseName;
		if (!displayName) return row;

		return {
			...row,
			exercise_name: displayName,
			exercise_id: row.exercise_id ?? exercise.exercise_id ?? null,
		};
	});
}

export async function resolvePersonalRecordDisplayNames<
	T extends PersonalRecordCatalogJoinRow,
>(rows: readonly T[] | null | undefined, userId: string): Promise<T[]> {
	const catalogNormalized = normalizePersonalRecordCatalogDisplayNames(rows);
	const sessionIds = sessionIdsNeedingExerciseNameLookup(catalogNormalized);
	if (sessionIds.length === 0) return catalogNormalized;

	// Only the sessions this page needs, in bounded `.in("session_id", chunk)`
	// reads: one unbounded id list blew the ~8 KB GET URL limit at a few
	// hundred sessions (F-035), and a user-wide read made every records page
	// cost the user's whole exercise history. Each chunk is paged with a stable
	// order, because a chunk can still pass PostgREST's silent 1,000-row cap
	// (NF-18). The lookup map is keyed by `${session_id}:${exercise id}`.
	const exercises = await fetchAllSupabasePagesForChunks(
		sessionIds,
		(chunk, from, to) =>
			supabase
				.from("exercises")
				.select(
					"id, session_id, name, exercise_id, catalog:exercise_catalog(id, name, display_name)",
				)
				.eq("user_id", userId)
				.in("session_id", chunk)
				.order("session_id", { ascending: true })
				.order("id", { ascending: true })
				.range(from, to),
	);

	return normalizePersonalRecordSessionExerciseDisplayNames(
		catalogNormalized,
		exercises as SessionExerciseCatalogJoinRow[],
	);
}
