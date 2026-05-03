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

export async function fetchExerciseCatalog(
	filters?: ExerciseCatalogFilters,
): Promise<CatalogExercise[]> {
	let query = supabase
		.from("exercise_catalog")
		.select("*")
		.order("popularity", { ascending: false });

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
		// Search across name and display_name
		const escaped = filters.search.replace(/[%_\\]/g, "\\$&");
		const term = `%${escaped}%`;
		query = query.or(`name.ilike.${term},display_name.ilike.${term}`);
	}

	const { data, error } = await query;
	if (error) throw error;
	return catalogExerciseListSchema.parse(data);
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
