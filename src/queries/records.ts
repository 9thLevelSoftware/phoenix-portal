import { infiniteQueryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
	type PersonalRecord,
	personalRecordListSchema,
} from "@/schemas/transforms";
import { queryKeys } from "./keys";
import {
	PERSONAL_RECORD_WITH_CATALOG_SELECT,
	resolvePersonalRecordDisplayNames,
} from "./personal-record-normalization";

/**
 * Rows fetched per keyset page of personal-record history.
 *
 * Deliberately BELOW PostgREST's 1,000-row `max_rows` (F-012): a page shorter
 * than this therefore means "no more rows", never "the server quietly cut us
 * off". The previous implementation selected every record in one unbounded
 * request and was silently truncated at 1,000 (F-034).
 */
export const PERSONAL_RECORDS_PAGE_SIZE = 500;

export interface PersonalRecordCursor {
	/**
	 * The last row's `achieved_at` EXACTLY as PostgREST returned it, captured
	 * before Zod's `z.coerce.date()` sees it. A JS `Date` round-trip truncates
	 * microseconds, and `personal_record_history` then rejects the cursor with
	 * 22023 by design instead of silently skipping rows.
	 */
	before: string;
	beforeId: string;
}

export interface PersonalRecordPage {
	records: PersonalRecord[];
	nextCursor: PersonalRecordCursor | null;
}

/**
 * PostgREST surfaces the RPC's `22023` cursor guard as a 400. It means the
 * cursor no longer matches a row of ours (the record was edited or removed
 * between pages), so the right recovery is to RESET the infinite query and
 * start from the newest page again — never to retry the same cursor.
 */
export function isStalePersonalRecordCursorError(
	error: unknown,
): error is { code: string } {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "22023"
	);
}

/**
 * Personal records, newest first, as keyset pages over
 * `personal_record_history`.
 *
 * One shared query key for every consumer (Records tab, progression workbench,
 * Goals, deep dive, export), so a page view issues ONE request for records
 * instead of one per consumer.
 */
export function personalRecordsOptions(
	userId: string,
	profileId?: string | null,
) {
	return infiniteQueryOptions({
		queryKey: queryKeys.records.byUser(userId, profileId),
		initialPageParam: null as PersonalRecordCursor | null,
		queryFn: async ({ pageParam }): Promise<PersonalRecordPage> => {
			const { data, error } = await supabase
				.rpc("personal_record_history", {
					p_limit: PERSONAL_RECORDS_PAGE_SIZE,
					// Generated types mark defaulted arguments optional: omit them
					// rather than passing null.
					...(profileId ? { p_profile_id: profileId } : {}),
					...(pageParam
						? { p_before: pageParam.before, p_before_id: pageParam.beforeId }
						: {}),
				})
				.select(PERSONAL_RECORD_WITH_CATALOG_SELECT);
			if (error) throw error;

			const rows = data ?? [];
			const last = rows.length > 0 ? rows[rows.length - 1] : undefined;

			return {
				records: personalRecordListSchema.parse(
					await resolvePersonalRecordDisplayNames(rows),
				),
				nextCursor:
					last && rows.length === PERSONAL_RECORDS_PAGE_SIZE
						? { before: last.achieved_at, beforeId: last.id }
						: null,
			};
		},
		getNextPageParam: (lastPage) => lastPage.nextCursor,
		select: (data) => data.pages.flatMap((page) => page.records),
		retry: (failureCount, error) =>
			!isStalePersonalRecordCursorError(error) && failureCount < 3,
		enabled: !!userId,
	});
}
