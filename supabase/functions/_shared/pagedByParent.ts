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

/** Shared across the worker pool: one chunk's failure stops everyone else. */
type ChunkControl = {
  /** True once a *different* chunk owns the failure (see reportFailure). */
  stopped(): boolean;
  /**
   * Record that this chunk has failed. Ownership goes to the **lowest** index
   * that has recorded one, so a later failure in an earlier chunk takes over
   * from a later chunk already bisecting ("the failure reported is the
   * lowest-index chunk that recorded one").
   */
  reportFailure(): void;
};

/** `null` means the fetch was stopped because another chunk already failed. */
async function fetchOneChunk(
  supabase: PagedFromClient,
  options: FetchByParentIdsOptions,
  parentIds: readonly string[],
  control: ChunkControl,
): Promise<PagedFetchResult | null> {
  if (parentIds.length === 0) {
    return { ok: true, rows: [] };
  }

  let offset = 0;
  let sawFullPage = false;
  const collected: Record<string, unknown>[] = [];

  while (true) {
    if (control.stopped()) return null;
    let data: Record<string, unknown>[] | null;
    let error: PostgrestErrorLike | null;
    try {
      ({ data, error } = await requestPage(
        supabase,
        options,
        parentIds,
        offset,
      ));
    } catch (err) {
      control.reportFailure();
      throw err;
    }

    if (error) {
      // Record the failure the moment a request errors, not when this chunk's
      // fetch finally returns. Otherwise the bisection below (2·log2(n)
      // sequential round-trips) leaves the failure unrecorded for its whole
      // duration and idle workers claim more chunks meanwhile — which is
      // exactly the "after a failure no new request is started" rule.
      // `control.stopped()` is false for the chunk that owns the failure, so
      // its own bisection still runs to isolate the bad parent.
      control.reportFailure();
      if (parentIds.length > 1) {
        // Only the chunk that owns the failure may bisect. A later failure in
        // a higher-index chunk must not spend 2·log2(n) more requests when a
        // lower-index chunk has already decided the result — it reports its
        // own error and the caller takes the lowest-index one.
        if (control.stopped()) {
          return { ok: false, kind: "error", entity: options.entity, error };
        }
        // Halve and retry each half from the start, so one bad parent in a
        // 100-id chunk costs about 2·log2(100) ≈ 14 requests, not 100.
        const middle = Math.ceil(parentIds.length / 2);
        const merged: Record<string, unknown>[] = [];
        for (const half of [parentIds.slice(0, middle), parentIds.slice(middle)]) {
          const result = await fetchOneChunk(supabase, options, half, control);
          if (result === null) {
            // Stopped mid-bisection by a lower-index failure taking over.
            // Report this request's error rather than dropping it.
            return { ok: false, kind: "error", entity: options.entity, error };
          }
          if (!result.ok) return result;
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
  /** Index of the first chunk that recorded a failure, or -1. */
  let failureOwner = -1;
  const worker = async () => {
    // `failureOwner === -1` rather than a per-result check: a chunk records its
    // failure as soon as a request errors (see fetchOneChunk), so by the time
    // it returns an error result the pool has already stopped claiming work.
    while (failureOwner === -1 && next < chunks.length) {
      const index = next++;
      // A chunk keeps bisecting after its *own* failure (to isolate the bad
      // parent) but nothing belonging to another chunk starts once any chunk
      // has failed — not a new chunk, not further pages or halves.
      const control: ChunkControl = {
        stopped: () => failureOwner !== -1 && failureOwner !== index,
        reportFailure: () => {
          if (failureOwner === -1 || index < failureOwner) failureOwner = index;
        },
      };
      let result: PagedFetchResult | null;
      try {
        result = await fetchOneChunk(supabase, options, chunks[index], control);
      } catch (error) {
        control.reportFailure();
        throw error;
      }
      if (result === null) return;
      results[index] = result;
      if (!result.ok) control.reportFailure();
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
