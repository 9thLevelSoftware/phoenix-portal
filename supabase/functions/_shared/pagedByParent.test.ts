import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  CHILD_PAGE_SIZE,
  CHUNK_CONCURRENCY,
  fetchAllByParentIds,
  PARENT_ID_CHUNK_SIZE,
  type PagedFromClient,
  type PostgrestErrorLike,
} from "./pagedByParent.ts";

/** Hosted PostgREST `max_rows`: larger responses are silently truncated. */
const MAX_ROWS = 1000;
/** Conservative PostgREST/gateway URL budget for one GET. */
const URL_BUDGET_BYTES = 8000;
/** Room left for the host, path and select/order/offset/limit params. */
const URL_OVERHEAD_BYTES = 1500;

type Row = Record<string, unknown>;

type Request = {
  parentIds: string[];
  range: [number, number] | null;
  returned: number;
};

/**
 * In-memory stand-in for a PostgREST table: applies `.in()`, `.order()` and an
 * inclusive `.range()`, then silently truncates to MAX_ROWS like hosted
 * PostgREST. Each request resolves on a later macrotask so concurrent chunks
 * genuinely overlap.
 */
type TableOptions = {
  failFor?: (parentIds: string[]) => PostgrestErrorLike | null;
  throwFor?: (parentIds: string[]) => boolean;
  delayFor?: (parentIds: string[]) => number;
};

function tableClient(
  rows: Row[],
  parentColumn: string,
  {
    failFor = () => null,
    throwFor = () => false,
    delayFor = () => 1,
  }: TableOptions = {},
) {
  const requests: Request[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const client: PagedFromClient = {
    from: () => {
      let parentIds: string[] = [];
      let range: [number, number] | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        in: (_column: string, ids: readonly string[]) => {
          parentIds = [...ids];
          return builder;
        },
        range: (from: number, to: number) => {
          range = [from, to];
          return builder;
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          const request: Request = { parentIds, range, returned: 0 };
          requests.push(request);
          return new Promise((done) => setTimeout(done, delayFor(parentIds)))
            .then(() => {
              inFlight -= 1;
              if (throwFor(parentIds)) throw new Error("network down");
              const error = failFor(parentIds);
              if (error) return { data: null, error };
              const wanted = new Set(parentIds);
              const matching = rows
                .filter((row) => wanted.has(row[parentColumn] as string))
                .sort((a, b) => String(a.id).localeCompare(String(b.id)));
              const [from, to] = range ?? [0, matching.length - 1];
              const data = matching.slice(from, to + 1).slice(0, MAX_ROWS);
              request.returned = data.length;
              return { data, error: null };
            })
            .then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return {
    client,
    requests,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

function parentId(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

function childRows(parentCount: number, perParent: number): Row[] {
  const rows: Row[] = [];
  for (let p = 0; p < parentCount; p++) {
    for (let c = 0; c < perParent; c++) {
      rows.push({ id: `${parentId(p)}-${String(c).padStart(3, "0")}`, session_id: parentId(p) });
    }
  }
  return rows;
}

Deno.test("250 parents → 3 chunks, every child returned, no truncation", async () => {
  assertEquals(PARENT_ID_CHUNK_SIZE, 100);
  // Every page must stay under hosted max_rows, or the mock (like PostgREST)
  // silently truncates it.
  assert(CHILD_PAGE_SIZE + 1 < MAX_ROWS);
  const parents = Array.from({ length: 250 }, (_, i) => parentId(i));
  // 250 × 12 = 3,000 children. A full 100-parent chunk holds 1,200 rows, more
  // than max_rows, so an unpaged or oversized page would lose rows.
  const rows = childRows(250, 12);
  const table = tableClient(rows, "session_id");

  const result = await fetchAllByParentIds(table.client, {
    table: "exercises",
    parentColumn: "session_id",
    parentIds: parents,
    entity: "session exercises",
  });

  assert(result.ok);
  assertEquals(result.rows.length, rows.length);
  assertEquals(new Set(result.rows.map((r) => r.id)).size, rows.length);
  // Rows keep chunk order even though chunks ran concurrently.
  assertEquals(
    result.rows.map((r) => r.id),
    [...rows].map((r) => r.id),
  );

  const chunks = [...new Set(table.requests.map((r) => r.parentIds.join(",")))];
  assertEquals(
    chunks.map((c) => c.split(",").length),
    [100, 100, 50],
  );
  for (const request of table.requests) {
    assert(request.returned <= CHILD_PAGE_SIZE + 1);
    assert(request.returned < MAX_ROWS, "a page must never reach max_rows");
    // postgrest-js appends filters via URL.searchParams, which percent-encodes
    // `,` `(` `)`; measure the bytes actually sent.
    const query = new URLSearchParams({
      session_id: `in.(${request.parentIds.join(",")})`,
    }).toString();
    assert(
      query.length < URL_BUDGET_BYTES - URL_OVERHEAD_BYTES,
      `chunk filter ${query.length} bytes`,
    );
  }
});

Deno.test("chunks run with bounded concurrency", async () => {
  const parents = Array.from({ length: 1000 }, (_, i) => parentId(i));
  const table = tableClient(childRows(1000, 1), "session_id");

  const result = await fetchAllByParentIds(table.client, {
    table: "exercises",
    parentColumn: "session_id",
    parentIds: parents,
    entity: "session exercises",
  });

  assert(result.ok);
  assertEquals(result.rows.length, 1000);
  assertEquals(table.requests.length, 10);
  assertEquals(CHUNK_CONCURRENCY, 4);
  assertEquals(table.maxInFlight, 4);
});

Deno.test("one failing chunk fails the whole fetch (fail-closed)", async () => {
  const parents = Array.from({ length: 250 }, (_, i) => parentId(i));
  const failing = parentId(150);
  const table = tableClient(childRows(250, 1), "session_id", {
    failFor: (ids) => ids.includes(failing) ? { code: "57014", message: "canceling statement" } : null,
  });

  const result = await fetchAllByParentIds(table.client, {
    table: "exercises",
    parentColumn: "session_id",
    parentIds: parents,
    entity: "session exercises",
  });

  assertEquals(result.ok, false);
  assert(!result.ok && result.kind === "error");
  assertEquals(result.error.code, "57014");
});

Deno.test("a single overflowing parent in a 100-id chunk still reports overflow", async () => {
  const parents = Array.from({ length: 250 }, (_, i) => parentId(i));
  const heavy = parentId(120);
  const rows = [
    ...childRows(250, 1),
    ...Array.from({ length: CHILD_PAGE_SIZE + 1 }, (_, i) => ({
      id: `${heavy}-heavy-${String(i).padStart(4, "0")}`,
      session_id: heavy,
    })),
  ];
  // The heavy parent's second page is refused, like a PostgREST Range cap.
  const base = tableClient(rows, "session_id");
  const client: PagedFromClient = {
    from: (table: string) => {
      const builder = base.client.from(table);
      const range = builder.range;
      builder.range = (from: number, to: number) => {
        range(from, to);
        if (from > 0) {
          builder.then = (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { code: "PGRST103", message: "Requested range not satisfiable" },
            }).then(resolve);
        }
        return builder;
      };
      return builder;
    },
  };

  const result = await fetchAllByParentIds(client, {
    table: "exercises",
    parentColumn: "session_id",
    parentIds: parents,
    entity: "session exercises",
  });

  assertEquals(result.ok, false);
  assert(!result.ok && result.kind === "overflow");
  assertEquals(result.parentId, heavy);
});

/** Chunk index of a request, from the numeric suffix of its first parent id. */
function chunkOf(parentIds: readonly string[]): number {
  return Math.floor(Number(parentIds[0].slice(-12)) / PARENT_ID_CHUNK_SIZE);
}

function startedChunks(requests: Request[]): number[] {
  return [...new Set(requests.map((r) => chunkOf(r.parentIds)))].sort((a, b) => a - b);
}

Deno.test("a failed chunk is bisected, not retried one parent at a time", async () => {
  const parents = Array.from({ length: 100 }, (_, i) => parentId(i));
  const bad = parentId(37);
  const table = tableClient(childRows(100, 1), "session_id", {
    failFor: (ids) => ids.includes(bad) ? { code: "57014", message: "timeout" } : null,
  });

  const result = await fetchAllByParentIds(table.client, {
    table: "exercises",
    parentColumn: "session_id",
    parentIds: parents,
    entity: "session exercises",
  });

  assert(!result.ok && result.kind === "error");
  // 100 → 50 → 25 → 13 → 7 → 4 → 2 → 1: at most 2 requests per level.
  assert(table.requests.length <= 2 * 8, `${table.requests.length} requests`);
  assertEquals(table.requests.at(-1)?.parentIds, [bad]);
});

Deno.test("after a failure no new chunk starts and the failing chunk's error is returned", async () => {
  const parents = Array.from({ length: 1000 }, (_, i) => parentId(i));
  // Chunk 1 fails fast (and keeps failing while bisected); chunks 0, 2 and 3
  // are still in flight when it does.
  const table = tableClient(childRows(1000, 1), "session_id", {
    failFor: (ids) => chunkOf(ids) === 1 ? { code: "57014", message: "timeout" } : null,
    delayFor: (ids) => chunkOf(ids) === 1 ? 0 : 30,
  });

  const result = await fetchAllByParentIds(table.client, {
    table: "exercises",
    parentColumn: "session_id",
    parentIds: parents,
    entity: "session exercises",
  });

  assert(!result.ok && result.kind === "error");
  assertEquals(result.error.code, "57014");
  assertEquals(startedChunks(table.requests), [0, 1, 2, 3]);
});

Deno.test("a failure halts a bisection already running in another chunk", async () => {
  const parents = Array.from({ length: 300 }, (_, i) => parentId(i));
  const heavy = parentId(250); // in chunk 2
  let chunk2Requests = 0;
  const table = tableClient(childRows(300, 1), "session_id", {
    failFor: (ids) =>
      chunkOf(ids) === 1 || ids.includes(heavy)
        ? { code: "57014", message: "timeout" }
        : null,
    delayFor: (ids) => {
      if (chunkOf(ids) === 1) return 2;
      if (chunkOf(ids) === 2) {
        chunk2Requests += 1;
        // Chunk 2's first request fails fast; its bisection steps are slow.
        return chunk2Requests === 1 ? 1 : 40;
      }
      return 1;
    },
  });

  const result = await fetchAllByParentIds(table.client, {
    table: "exercises",
    parentColumn: "session_id",
    parentIds: parents,
    entity: "session exercises",
  });

  assert(!result.ok && result.kind === "error");
  // Chunk 1 decided the result while chunk 2's first half was in flight, so
  // chunk 2 made no further requests (unstopped it would make ~14).
  assertEquals(chunk2Requests, 2);
});

Deno.test("a thrown query stops the other workers from starting chunks", async () => {
  const parents = Array.from({ length: 1000 }, (_, i) => parentId(i));
  const table = tableClient(childRows(1000, 1), "session_id", {
    throwFor: (ids) => chunkOf(ids) === 0,
    delayFor: (ids) => chunkOf(ids) === 0 ? 0 : 20,
  });

  await assertRejects(
    () =>
      fetchAllByParentIds(table.client, {
        table: "exercises",
        parentColumn: "session_id",
        parentIds: parents,
        entity: "session exercises",
      }),
    Error,
    "network down",
  );
  // Let the chunks still in flight settle, then check nothing new started.
  await new Promise((done) => setTimeout(done, 100));
  assertEquals(startedChunks(table.requests), [0, 1, 2, 3]);
});
