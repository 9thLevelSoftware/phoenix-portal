import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/queries/keys";
import {
	fetchExerciseCatalog,
	type ExerciseCatalogFilters,
} from "@/queries/exercises";

export function useExerciseCatalog(filters?: ExerciseCatalogFilters) {
	return useQuery({
		queryKey: queryKeys.exercises.catalog(filters),
		queryFn: () => fetchExerciseCatalog(filters),
		staleTime: 1000 * 60 * 30, // 30 min — catalog rarely changes
	});
}
