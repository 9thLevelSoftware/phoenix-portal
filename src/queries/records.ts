import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { personalRecordListSchema } from "@/schemas/transforms";
import { queryKeys } from "./keys";

export function personalRecordsOptions(userId: string) {
	return queryOptions({
		queryKey: queryKeys.records.byUser(userId),
		queryFn: async () => {
			const { data, error } = await supabase
				.from("personal_records")
				.select("*")
				.eq("user_id", userId)
				.order("achieved_at", { ascending: false });
			if (error) throw error;
			return personalRecordListSchema.parse(data);
		},
	});
}
