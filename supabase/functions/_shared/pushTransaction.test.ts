import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  arrayLiteral,
  beginPushTransaction,
  parseListValue,
  type SqlExecutor,
} from "./pushTransaction.ts";

interface FakeOptions {
  columns?: Record<string, Record<string, string>>;
  functions?: Record<string, Array<Record<string, unknown>>>;
  /** Result rows for a data statement, chosen by the first matching needle. */
  results?: Array<{ match: string; rows?: Array<Record<string, unknown>>; error?: unknown }>;
}

function fakeExecutor(options: FakeOptions = {}) {
  const log: Array<{ text: string; params: ReadonlyArray<string> }> = [];
  let ended = 0;
  const executor: SqlExecutor = {
    async query(text, params) {
      log.push({ text, params });
      if (text.includes("pg_catalog.pg_attribute")) {
        const cols = options.columns?.[params[0]] ?? {};
        return Object.entries(cols).map(([name, type]) => ({ name, type }));
      }
      if (text.includes("pg_catalog.pg_proc")) {
        return options.functions?.[params[0]] ?? [];
      }
      for (const r of options.results ?? []) {
        if (text.includes(r.match)) {
          if (r.error) throw r.error;
          return r.rows ?? [];
        }
      }
      return [];
    },
    async end() {
      ended += 1;
    },
  };
  return { executor, log, ended: () => ended };
}

const statements = (log: Array<{ text: string }>) =>
  log.map((l) => l.text).filter((t) => !t.includes("pg_catalog."));

Deno.test("beginPushTransaction acts as service_role with PostgREST's claims, then commits once", async () => {
  const fake = fakeExecutor();
  const tx = await beginPushTransaction(fake.executor);
  assertEquals(statements(fake.log), [
    "BEGIN",
    "SET LOCAL ROLE service_role",
    "SELECT set_config('request.jwt.claims', $1::text, true)",
    "SET LOCAL TIME ZONE 'UTC'",
  ]);
  assertEquals(fake.log[2].params, [JSON.stringify({ role: "service_role" })]);
  assertEquals(tx.settled, false);
  await tx.commit();
  await tx.rollback(); // settled: a no-op
  assertEquals(statements(fake.log).slice(4), ["COMMIT"]);
  assertEquals(tx.settled, true);
  assertEquals(fake.ended(), 1);
});

Deno.test("select: typed filters, order and range, JSON built by Postgres", async () => {
  const fake = fakeExecutor({
    columns: { local_profiles: { id: "text", user_id: "uuid", name: "text" } },
    results: [{ match: "FROM public.\"local_profiles\"", rows: [{ j: '[{"id":"p1","name":"A"}]' }] }],
  });
  const tx = await beginPushTransaction(fake.executor);
  const { data, error } = await tx.client.from("local_profiles")
    .select("id, name")
    .eq("user_id", "u1")
    .in("id", ["p1", 'p"2'])
    .order("id", { ascending: true })
    .range(0, 9)
    .returns<unknown>();
  assertEquals(error, null);
  assertEquals(data, [{ id: "p1", name: "A" }]);
  const sql = fake.log.find((l) => l.text.includes('FROM public."local_profiles"'))!;
  assertEquals(
    sql.text,
    `SELECT coalesce(json_agg(r), '[]'::json)::text AS j FROM (SELECT "id", "name" FROM public."local_profiles" WHERE "user_id" = $1::text::uuid AND "id" = ANY($2::text::text[]) ORDER BY "id" ASC LIMIT 10 OFFSET 0) r`,
  );
  assertEquals(sql.params, ["u1", '{"p1","p\\"2"}']);
});

Deno.test("upsert: json_populate_recordset, union of keys, DO UPDATE on every column", async () => {
  const fake = fakeExecutor({
    columns: { local_profiles: { user_id: "uuid", id: "text", name: "text" } },
    results: [{ match: "INSERT INTO", rows: [{ j: '[{"id":"p1"}]' }] }],
  });
  const tx = await beginPushTransaction(fake.executor);
  const rows = [{ user_id: "u1", id: "p1" }, { user_id: "u1", id: "p2", name: "B", skipped: undefined }];
  const { data } = await tx.client.from("local_profiles")
    .upsert(rows, { onConflict: "user_id,id" })
    .select("id");
  assertEquals(data, [{ id: "p1" }]);
  const sql = fake.log.find((l) => l.text.includes("INSERT INTO"))!;
  assertEquals(
    sql.text,
    `WITH w AS (INSERT INTO public."local_profiles" ("user_id", "id", "name") SELECT "user_id", "id", "name" FROM json_populate_recordset(NULL::public."local_profiles", $1::text::json) ON CONFLICT ("user_id", "id") DO UPDATE SET "user_id" = EXCLUDED."user_id", "id" = EXCLUDED."id", "name" = EXCLUDED."name" RETURNING "id") SELECT coalesce(json_agg(r), '[]'::json)::text AS j FROM (SELECT * FROM w) r`,
  );
  assertEquals(JSON.parse(sql.params[0]), [{ user_id: "u1", id: "p1" }, { user_id: "u1", id: "p2", name: "B" }]);
});

Deno.test("upsert: ignoreDuplicates is DO NOTHING; without select the data is null", async () => {
  const fake = fakeExecutor({ columns: { vbt_assessments: { user_id: "uuid", exercise_id: "text", created_at: "timestamp with time zone" } } });
  const tx = await beginPushTransaction(fake.executor);
  const { data, error } = await tx.client.from("vbt_assessments")
    .upsert([{ user_id: "u", exercise_id: "e", created_at: "2026-01-01T00:00:00Z" }], {
      onConflict: "user_id,exercise_id,created_at",
      ignoreDuplicates: true,
    });
  assertEquals([data, error], [null, null]);
  assert(fake.log.some((l) => l.text.endsWith('ON CONFLICT ("user_id", "exercise_id", "created_at") DO NOTHING')));
});

Deno.test("delete: not('in') takes a PostgREST list; an unfiltered delete is refused", async () => {
  const fake = fakeExecutor({ columns: { routine_exercises: { id: "uuid", routine_id: "uuid" } } });
  const tx = await beginPushTransaction(fake.executor);
  await tx.client.from("routine_exercises").delete().eq("routine_id", "r1").not("id", "in", "(a,b)");
  const sql = fake.log.find((l) => l.text.startsWith("DELETE"))!;
  assertEquals(sql.text, `DELETE FROM public."routine_exercises" WHERE "routine_id" = $1::text::uuid AND NOT ("id" = ANY($2::text::uuid[]))`);
  assertEquals(sql.params, ["r1", '{"a","b"}']);
  await assertRejects(() => Promise.resolve(tx.client.from("routine_exercises").delete()));
});

Deno.test("rpc: named, typed arguments; the result shape follows the return type", async () => {
  const fn = (argnames: string[], argtypes: string[], extra: Record<string, unknown>) => [{
    argnames, argmodes: [], argtypes, nargs: argtypes.length, ndefaults: 0,
    retset: false, typtype: "b", isvoid: false, isrecord: false, ...extra,
  }];
  const fake = fakeExecutor({
    functions: {
      merge_x: fn(["p_user_id", "p_rows", "p_ids", "p_flag"], ["uuid", "jsonb", "uuid[]", "boolean"], { retset: true }),
      recompute_x: fn(["p_user_id"], ["uuid"], { isvoid: true }),
      scalar_x: fn(["p_n"], ["integer"], {}),
    },
    results: [
      { match: "public.\"merge_x\"", rows: [{ j: '[{"id":"a","accepted":true}]' }] },
      { match: "public.\"scalar_x\"", rows: [{ j: "7" }] },
    ],
  });
  const tx = await beginPushTransaction(fake.executor);
  const merged = await tx.client.rpc("merge_x", {
    p_user_id: "u",
    p_rows: [{ a: 1 }],
    p_ids: ["i1"],
    p_flag: null,
    p_unused: undefined,
  });
  assertEquals(merged, { data: [{ id: "a", accepted: true }], error: null });
  const call = fake.log.find((l) => l.text.includes('public."merge_x"'))!;
  assertEquals(
    call.text,
    `SELECT coalesce(json_agg(r), '[]'::json)::text AS j FROM public."merge_x"("p_user_id" => $1::text::uuid, "p_rows" => $2::text::jsonb, "p_ids" => $3::text::uuid[], "p_flag" => NULL::boolean) r`,
  );
  assertEquals(call.params, ["u", '[{"a":1}]', '{"i1"}']);
  assertEquals(await tx.client.rpc("recompute_x", { p_user_id: "u" }), { data: null, error: null });
  assertEquals(await tx.client.rpc("scalar_x", { p_n: 3 }), { data: 7, error: null });
  const missing = await tx.client.rpc("nope", {});
  assertEquals(missing.error?.code, "PGRST202");
});

Deno.test("a failed call is rolled back to its savepoint and returned like a PostgREST error", async () => {
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
    code: "23505",
    detail: "Key (id)=(1) already exists.",
  });
  const fake = fakeExecutor({
    columns: { t: { id: "uuid" } },
    results: [{ match: "INSERT INTO", error: pgError }],
  });
  const tx = await beginPushTransaction(fake.executor);
  const { data, error } = await tx.client.from("t").upsert([{ id: "1" }], { onConflict: "id" });
  assertEquals(data, null);
  assertEquals(error, {
    message: 'duplicate key value violates unique constraint "x"',
    code: "23505",
    details: "Key (id)=(1) already exists.",
    hint: null,
  });
  assertEquals(statements(fake.log).slice(4), [
    "SAVEPOINT push_call_1",
    statements(fake.log)[5],
    "ROLLBACK TO SAVEPOINT push_call_1",
    "RELEASE SAVEPOINT push_call_1",
  ]);
  // The transaction is still usable afterwards.
  const next = await tx.client.from("t").select("id");
  assertEquals(next.error, null);
});

Deno.test("concurrent calls are serialized, so savepoints never interleave", async () => {
  const fake = fakeExecutor({ columns: { a: { id: "uuid" }, b: { id: "uuid" } } });
  const tx = await beginPushTransaction(fake.executor);
  await Promise.all([
    tx.client.from("a").select("id"),
    tx.client.from("b").select("id"),
    tx.client.rpc("missing_fn", {}),
  ]);
  const seq = statements(fake.log).slice(4).map((s) =>
    s.startsWith("SAVEPOINT") ? "S" : s.startsWith("RELEASE") ? "R" : s.startsWith("SELECT coalesce") ? "Q" : s
  );
  assertEquals(seq, ["S", "Q", "R", "S", "Q", "R"]);
});

Deno.test("parseListValue and arrayLiteral round-trip quoted ids", () => {
  assertEquals(parseListValue('("a","b,c",d)'), ["a", "b,c", "d"]);
  assertEquals(parseListValue("()"), []);
  assertEquals(parseListValue('("x\\"y")'), ['x"y']);
  assertEquals(arrayLiteral(["a", 'b"c', "d\\e", null]), '{"a","b\\"c","d\\\\e",NULL}');
  assertThrows(() => parseListValue("a,b"));
});
