import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { personalRecordListSchema } from "@/schemas/transforms";
import { queryKeys } from "./keys";
import {
	PERSONAL_RECORD_WITH_CATALOG_SELECT,
	resolvePersonalRecordDisplayNames,
} from "./personal-record-normalization";

export function personalRecordsOptions(
	userId: string,
	profileId?: string | null,
) {
	return queryOptions({
		queryKey: queryKeys.records.byUser(userId, profileId),
		queryFn: async () => {
			let query = supabase
				.from("personal_records")
				.select(PERSONAL_RECORD_WITH_CATALOG_SELECT)
				.eq("user_id", userId)
				.is("deleted_at", null);

			if (profileId) {
				query = query.eq("local_profile_id", profileId);
			}

			const { data, error } = await query.order("achieved_at", {
				ascending: false,
			});
			if (error) throw error;
			return personalRecordListSchema.parse(
				await resolvePersonalRecordDisplayNames(data),
			);
		},
		enabled: !!userId,
	});
}
