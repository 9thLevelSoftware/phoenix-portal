import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "./keys";

export interface LocalProfile {
	id: string;
	name: string;
	color_index: number;
	device_id: string | null;
	created_at: string;
	updated_at: string;
}

export function localProfilesOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.localProfiles.byUser(userId),
		queryFn: async (): Promise<LocalProfile[]> => {
			const { data, error } = await supabase
				.from("local_profiles")
				.select("id, name, color_index, device_id, created_at, updated_at")
				.eq("user_id", userId)
				.order("created_at", { ascending: true });

			if (error) throw error;
			return data ?? [];
		},
		staleTime: 5 * 60 * 1000,
		enabled: !!userId,
	});
}
