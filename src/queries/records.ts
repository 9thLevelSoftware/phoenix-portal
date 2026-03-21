import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { personalRecordListSchema } from "@/schemas/transforms";
import { queryKeys } from "./keys";

export function personalRecordsOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.records.byUser(userId, profileId),
		queryFn: async () => {
			let query = supabase
				.from("personal_records")
				.select("*")
				.eq("user_id", userId);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query.order("achieved_at", {
				ascending: false,
			});
			if (error) throw error;
			return personalRecordListSchema.parse(data);
		},
	});
}
