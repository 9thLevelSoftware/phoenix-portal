import { supabase } from "@/lib/supabase";
import {
	type CatalogExercise,
	catalogExerciseListSchema,
	catalogExerciseSchema,
} from "@/schemas/transforms";

export interface ExerciseCatalogFilters {
	muscleGroup?: string;
	equipment?: string[];
	search?: string;
	includeArchived?: boolean;
}

export const CATALOG_PAGE_SIZE = 1000;

function applyCatalogFilters<
	Q extends {
		eq: (column: string, value: unknown) => Q;
		overlaps: (column: string, value: string[]) => Q;
		or: (filters: string) => Q;
	},
>(query: Q, filters?: ExerciseCatalogFilters): Q {
	if (!filters?.includeArchived) {
		query = query.eq("archived", false);
	}

	if (filters?.muscleGroup) {
		query = query.eq("muscle_group", filters.muscleGroup);
	}

	if (filters?.equipment?.length) {
		// Contains any of the specified equipment
		query = query.overlaps("equipment", filters.equipment);
	}

	if (filters?.search) {
		// Search across name and display_name.
		// Escape LIKE wildcards/backslash, then strip PostgREST `.or()` delimiters
		// (comma and parentheses) which would otherwise produce malformed filters
		// or unintended OR conditions.
		const escaped = filters.search
			.replace(/[%_\\]/g, "\\$&")
			.replace(/[(),]/g, " ");
		const term = `%${escaped}%`;
		query = query.or(`name.ilike.${term},display_name.ilike.${term}`);
	}

	return query;
}

export async function fetchExerciseCatalog(
	filters?: ExerciseCatalogFilters,
): Promise<CatalogExercise[]> {
	const rows: unknown[] = [];
	for (let from = 0; ; from += CATALOG_PAGE_SIZE) {
		const pageQuery = applyCatalogFilters(
			supabase
				.from("exercise_catalog")
				.select("*")
				.order("popularity", { ascending: false })
				.order("id", { ascending: true }),
			filters,
		);
		const { data, error } = await pageQuery.range(
			from,
			from + CATALOG_PAGE_SIZE - 1,
		);
		if (error) throw error;
		const page = data ?? [];
		rows.push(...page);
		if (page.length < CATALOG_PAGE_SIZE) break;
	}
	return catalogExerciseListSchema.parse(rows);
}

export async function fetchExerciseById(
	id: string,
): Promise<CatalogExercise | null> {
	const { data, error } = await supabase
		.from("exercise_catalog")
		.select("*")
		.eq("id", id)
		.maybeSingle();

	if (error) throw error;
	if (!data) return null;
	return catalogExerciseSchema.parse(data);
}
