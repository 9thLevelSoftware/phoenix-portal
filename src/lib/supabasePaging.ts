/**
 * Helpers for reading every row of a Supabase/PostgREST result set.
 *
 * Hosted PostgREST silently caps every response at `max_rows` (1,000 by
 * default) without raising an error, so any "all rows" read must page until
 * it receives a short page. Page sizes here must never exceed that cap: a
 * capped full page would look short and end the loop early.
 */

// Must stay <= the server's `max_rows`. Hosted Supabase defaults to 1,000 and
// supabase/config.toml sets no `[api] max_rows` override; if a deployment ever
// lowers it, lower this too or every "all rows" read truncates silently.
export const SUPABASE_PAGE_SIZE = 1000;
export const SUPABASE_FILTER_CHUNK_SIZE = 100;

export type SupabasePageResult<T> = {
	data: T[] | null;
	error: unknown;
};
export type FetchSupabasePage<T> = (
	from: number,
	to: number,
) => PromiseLike<SupabasePageResult<T>>;
export type FetchSupabaseChunkPage<T, V> = (
	values: V[],
	from: number,
	to: number,
) => PromiseLike<SupabasePageResult<T>>;
export type FetchSupabaseKeysetPage<T, C> = (
	after: C | null,
	limit: number,
) => PromiseLike<SupabasePageResult<T>>;

/** Offset paging via `.range(from, to)`. The query must have a stable ORDER BY. */
export async function fetchAllSupabasePages<T>(
	fetchPage: FetchSupabasePage<T>,
	pageSize = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
	const rows: T[] = [];

	for (let offset = 0; ; offset += pageSize) {
		const { data, error } = await fetchPage(offset, offset + pageSize - 1);
		if (error) {
			throw error;
		}

		const page = data ?? [];
		rows.push(...page);
		if (page.length < pageSize) {
			return rows;
		}
	}
}

export async function fetchAllSupabasePagesForChunks<T, V>(
	values: V[],
	fetchPage: FetchSupabaseChunkPage<T, V>,
	options: {
		chunkSize?: number;
		pageSize?: number;
	} = {},
): Promise<T[]> {
	const chunkSize = options.chunkSize ?? SUPABASE_FILTER_CHUNK_SIZE;
	const pageSize = options.pageSize ?? SUPABASE_PAGE_SIZE;
	const rows: T[] = [];

	for (let offset = 0; offset < values.length; offset += chunkSize) {
		const chunk = values.slice(offset, offset + chunkSize);
		rows.push(
			...(await fetchAllSupabasePages(
				(from, to) => fetchPage(chunk, from, to),
				pageSize,
			)),
		);
	}

	return rows;
}

/**
 * Keyset paging: each page asks for rows strictly after the cursor of the last
 * row already received. The query must be ordered by the same unique key that
 * `cursorOf` extracts. Each page costs O(page) rather than O(offset) only when
 * the caller's cursor predicate is index-sargable (e.g. a `gte` on the leading
 * sort column next to the exact tiebreak `or`).
 */
export async function fetchAllKeysetPages<T, C>(
	fetchPage: FetchSupabaseKeysetPage<T, C>,
	cursorOf: (row: T) => C,
	pageSize = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
	const rows: T[] = [];
	let after: C | null = null;

	for (;;) {
		const { data, error } = await fetchPage(after, pageSize);
		if (error) {
			throw error;
		}

		const page = data ?? [];
		rows.push(...page);
		if (page.length < pageSize) {
			return rows;
		}
		after = cursorOf(page[page.length - 1]);
	}
}
