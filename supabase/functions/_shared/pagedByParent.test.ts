import { assert, assertEquals } from "jsr:@std/assert@1";
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
function tableClient(
  rows: Row[],
  parentColumn: string,
  failFor: (parentIds: string[]) => PostgrestErrorLike | null = () => null,
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
          return new Promise((done) => setTimeout(done, 1))
            .then(() => {
              inFlight -= 1;
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
  const parents = Array.from({ length: 250 }, (_, i) => parentId(i));
  // 250 × 9 = 2,250 children: an unpaged `.in()` would be truncated to 1,000,
  // and each 100-parent chunk (900 rows) needs a second PAGE+1 page.
  const rows = childRows(250, 9);
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
    const query = `session_id=in.(${request.parentIds.join(",")})`;
    assert(
      encodeURI(query).length < URL_BUDGET_BYTES / 2,
      `chunk URL ${encodeURI(query).length} bytes`,
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
  const table = tableClient(
    childRows(250, 1),
    "session_id",
    (ids) => ids.includes(failing) ? { code: "57014", message: "canceling statement" } : null,
  );

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
