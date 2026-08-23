/**
 * KD-28 child paging: PostgREST can silently truncate unpaged `.in()` reads.
 *
 * Pattern (only this one):
 *   1. Chunk parent IDs so one request is unlikely to hit hosted max_rows.
 *   2. `.range(offset, offset + PAGE)` is inclusive → PAGE+1 rows.
 *   3. Consume PAGE rows. Continue iff `length === PAGE + 1`.
 *   4. Chunk complete iff `length <= PAGE` (exact last page of PAGE included).
 *   5. HTTP 200 when every chunk completes.
 *   6. Overflow only when a *single* parent still returns PAGE+1 and further
 *      Range/offset for that parent is refused.
 */

export const CHILD_PAGE_SIZE = 500;
export const PARENT_ID_CHUNK_SIZE = 20;

export type PostgrestErrorLike = {
  code?: string;
  message?: string;
  hint?: string;
};

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

async function fetchOneChunk(
  supabase: PagedFromClient,
  options: FetchByParentIdsOptions,
  parentIds: readonly string[],
): Promise<PagedFetchResult> {
  if (parentIds.length === 0) {
    return { ok: true, rows: [] };
  }

  let offset = 0;
  let sawFullPage = false;
  const collected: Record<string, unknown>[] = [];

  while (true) {
    const { data, error } = await requestPage(
      supabase,
      options,
      parentIds,
      offset,
    );

    if (error) {
      if (parentIds.length > 1) {
        const merged: Record<string, unknown>[] = [];
        for (const parentId of parentIds) {
          const single = await fetchOneChunk(supabase, options, [parentId]);
          if (!single.ok) return single;
          merged.push(...single.rows);
        }
        return { ok: true, rows: merged };
      }
      if (sawFullPage) {
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

  const collected: Record<string, unknown>[] = [];
  for (const chunk of chunkIds(parentIds, PARENT_ID_CHUNK_SIZE)) {
    const result = await fetchOneChunk(supabase, options, chunk);
    if (!result.ok) return result;
    collected.push(...result.rows);
  }
  return { ok: true, rows: collected };
}
