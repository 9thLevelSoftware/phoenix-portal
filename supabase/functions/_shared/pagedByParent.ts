/**
 * KD-28 child paging: PostgREST can silently truncate unpaged `.in()` reads.
 *
 * Pattern (only this one):
 *   1. Chunk parent IDs (PARENT_ID_CHUNK_SIZE) to bound the request URL.
 *      Row count never depends on chunk size: each chunk is paged below, and
 *      a page is PAGE+1 = 501 rows, under the hosted max_rows of 1000.
 *   2. `.range(offset, offset + PAGE)` is inclusive → PAGE+1 rows.
 *   3. Consume PAGE rows. Continue iff `length === PAGE + 1`.
 *   4. Chunk complete iff `length <= PAGE` (exact last page of PAGE included).
 *   5. HTTP 200 when every chunk completes.
 *   6. Overflow only when a *single* parent still returns PAGE+1 and further
 *      Range/offset for that parent is refused. A failed multi-parent request
 *      is retried by halving the parent list (about 2·log2(n) requests to
 *      isolate one bad parent), not one request per parent.
 *   7. Up to CHUNK_CONCURRENCY chunks are in flight at once. Rows come back
 *      in chunk order; any chunk failure (returned or thrown) fails the whole
 *      fetch (fail-closed). After a failure no new request is started: not
 *      new chunks, not further pages or halves of chunks already running.
 *      The failure reported is the lowest-index chunk that recorded one.
 */

export const CHILD_PAGE_SIZE = 500;
/**
 * 100 UUIDs as `col=in.(...)`, percent-encoded the way postgrest-js sends it
 * (URLSearchParams: `,` `(` `)` become 3 bytes each), is about 3.9 KB of query
 * string, well under the ~8 KB PostgREST/gateway URL budget.
 */
export const PARENT_ID_CHUNK_SIZE = 100;
export const CHUNK_CONCURRENCY = 4;

export type PostgrestErrorLike = {
  code?: string;
  message?: string;
  hint?: string;
};

/** PostgREST Range/offset refusal (PGRST103 / 416), not a generic read error. */
export function isRangeRefused(error: PostgrestErrorLike): boolean {
  const code = (error.code ?? "").toUpperCase();
  if (code === "PGRST103" || code === "416") return true;
  const text = `${error.message ?? ""} ${error.hint ?? ""}`;
  return /range not satisfiable|requested range|416/i.test(text);
}

export type PagedQueryResult = {
  data: Record<string, unknown>[] | null;
  error: PostgrestErrorLike | null;
};

export type PagedFromClient = {
  // PostgREST filter builder; kept loose so Vite and Deno clients both type-check.
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

export type PagedFetchOk = {
  ok: true;
  rows: Record<string, unknown>[];
};

export type PagedFetchOverflow = {
  ok: false;
  kind: "overflow";
  entity: string;
  parentId: string;
};

export type PagedFetchError = {
  ok: false;
  kind: "error";
  entity: string;
  error: PostgrestErrorLike;
};

export type PagedFetchResult = PagedFetchOk | PagedFetchOverflow | PagedFetchError;

export type FetchByParentIdsOptions = {
  table: string;
  parentColumn: string;
  parentIds: readonly string[];
  entity: string;
  select?: string;
  orderColumn?: string;
};

function chunkIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

async function requestPage(
  supabase: PagedFromClient,
  options: FetchByParentIdsOptions,
  parentIds: readonly string[],
  offset: number,
): Promise<PagedQueryResult> {
  let query = supabase
    .from(options.table)
    .select(options.select ?? "*")
    .in(options.parentColumn, parentIds)
    .order(options.orderColumn ?? "id", { ascending: true });
  query = query.range(offset, offset + CHILD_PAGE_SIZE);
  return await query;
}

/** `null` means the fetch was stopped because another chunk already failed. */
async function fetchOneChunk(
  supabase: PagedFromClient,
  options: FetchByParentIdsOptions,
  parentIds: readonly string[],
  stopped: () => boolean,
): Promise<PagedFetchResult | null> {
  if (parentIds.length === 0) {
    return { ok: true, rows: [] };
  }

  let offset = 0;
  let sawFullPage = false;
  const collected: Record<string, unknown>[] = [];

  while (true) {
    if (stopped()) return null;
    const { data, error } = await requestPage(
      supabase,
      options,
      parentIds,
      offset,
    );

    if (error) {
      if (parentIds.length > 1) {
        // Halve and retry each half from the start, so one bad parent in a
        // 100-id chunk costs about 2·log2(100) ≈ 14 requests, not 100.
        const middle = Math.ceil(parentIds.length / 2);
        const merged: Record<string, unknown>[] = [];
        for (const half of [parentIds.slice(0, middle), parentIds.slice(middle)]) {
          const result = await fetchOneChunk(supabase, options, half, stopped);
          if (result === null || !result.ok) return result;
          merged.push(...result.rows);
        }
        return { ok: true, rows: merged };
      }
      if (sawFullPage && isRangeRefused(error)) {
        return {
          ok: false,
          kind: "overflow",
          entity: options.entity,
          parentId: parentIds[0],
        };
      }
      return { ok: false, kind: "error", entity: options.entity, error };
    }

    const batch = data ?? [];
    if (batch.length === CHILD_PAGE_SIZE + 1) {
      sawFullPage = true;
      collected.push(...batch.slice(0, CHILD_PAGE_SIZE));
      offset += CHILD_PAGE_SIZE;
      continue;
    }

    collected.push(...batch);
    return { ok: true, rows: collected };
  }
}

/**
 * Fetch every child row for the given parent IDs using the PAGE+1 loop.
 */
export async function fetchAllByParentIds(
  supabase: PagedFromClient,
  options: FetchByParentIdsOptions,
): Promise<PagedFetchResult> {
  const parentIds = [...new Set(options.parentIds.filter((id) => id.length > 0))];
  if (parentIds.length === 0) {
    return { ok: true, rows: [] };
  }

  const chunks = chunkIds(parentIds, PARENT_ID_CHUNK_SIZE);
  const results: (PagedFetchResult | undefined)[] = new Array(chunks.length);
  let next = 0;
  let failed = false;
  const stopped = () => failed;
  const worker = async () => {
    while (!failed && next < chunks.length) {
      const index = next++;
      let result: PagedFetchResult | null;
      try {
        result = await fetchOneChunk(supabase, options, chunks[index], stopped);
      } catch (error) {
        failed = true;
        throw error;
      }
      if (result === null) return;
      results[index] = result;
      if (!result.ok) failed = true;
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(CHUNK_CONCURRENCY, chunks.length) },
      () => worker(),
    ),
  );

  const collected: Record<string, unknown>[] = [];
  for (const result of results) {
    // Chunks not started or stopped because another chunk failed stay
    // undefined; that failed chunk is still in `results`, so the loop
    // returns it.
    if (result === undefined) continue;
    if (!result.ok) return result;
    collected.push(...result.rows);
  }
  return { ok: true, rows: collected };
}
