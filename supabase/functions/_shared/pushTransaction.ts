/**
 * One Postgres transaction around a whole mobile push (F-014,
 * SYNC_PUSH_TRANSACTION).
 *
 * mobile-sync-push reaches the database only through a small slice of the
 * supabase-js query builder: `from(t).select|upsert|delete` with
 * `eq/neq/gte/in/not('in')/order/range`, and `rpc(name, args)`.
 * `TransactionalClient` implements exactly that slice over ONE connection
 * inside one `BEGIN … COMMIT`, so the handler's existing Design K write
 * sequence runs unchanged and either all of it commits or none of it does.
 *
 * Parity with PostgREST, which is what the handler was written against:
 * - it acts as `service_role` with the same `request.jwt.claims`, so grants,
 *   RLS bypass and claim-reading triggers behave as they do over PostgREST;
 * - Postgres builds the JSON (`json_agg` / `to_json`), and writes go through
 *   `json_populate_recordset`, as PostgREST does, so timestamps, numerics and
 *   missing keys (NULL) come back byte-identical;
 * - every call runs in its own SAVEPOINT: a failed call is rolled back alone
 *   and returned as `{ data: null, error }`, exactly like a failed PostgREST
 *   request, so the handler's tolerated failures (optional tables, retries)
 *   keep working. Only the handler's final COMMIT or ROLLBACK decides the
 *   push as a whole.
 * Calls are serialized: the handler runs some probes concurrently, and
 * interleaved savepoints on one connection would release each other.
 */
import postgres from "npm:postgres@3.4.7";

/**
 * Runs one SQL statement. Every parameter is a string declared `$n::text` in
 * the SQL and cast there, so the driver never re-serializes it (postgres.js
 * would JSON-encode a string bound to a json parameter a second time).
 */
export interface SqlExecutor {
  query(
    text: string,
    params: ReadonlyArray<string>,
  ): Promise<Array<Record<string, unknown>>>;
  end(): Promise<void>;
}

/** PostgREST's error shape, which the handler inspects (`code`, `message`). */
export interface PostgrestLikeError {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

export interface QueryResult {
  data: unknown;
  error: PostgrestLikeError | null;
}

export interface PushTransaction {
  /** The supabase-js slice, bound to this transaction. */
  readonly client: TransactionalClient;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** True once commit or rollback has run (or been attempted). */
  readonly settled: boolean;
  /**
   * True once Postgres ended the transaction under a call (a savepoint could
   * not be rolled back: transaction_timeout, a dropped connection). Nothing
   * can commit; the push must answer as a retryable partial write.
   */
  readonly aborted: boolean;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`push transaction: unsupported identifier ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/** A Postgres array literal of text elements (cast by the caller). */
export function arrayLiteral(values: ReadonlyArray<unknown>): string {
  const items = values.map((value) => {
    if (value === null || value === undefined) return "NULL";
    const text = typeof value === "string" ? value : String(value);
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${items.join(",")}}`;
}

/** Splits a PostgREST list value `("a","b",c)` into its items. */
export function parseListValue(list: string): string[] {
  const trimmed = list.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    throw new Error(`push transaction: not a PostgREST list: ${list}`);
  }
  const body = trimmed.slice(1, -1);
  if (body.trim() === "") return [];
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === "\\" && i + 1 < body.length) {
        current += body[i + 1];
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      out.push(wasQuoted ? current : current.trim());
      current = "";
      wasQuoted = false;
    } else {
      current += ch;
    }
  }
  out.push(wasQuoted ? current : current.trim());
  return out;
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toPostgrestError(error: unknown): PostgrestLikeError {
  const e = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    detail?: unknown;
    hint?: unknown;
  };
  return {
    message: typeof e.message === "string" ? e.message : String(error),
    code: typeof e.code === "string" ? e.code : "",
    details: typeof e.detail === "string" ? e.detail : null,
    hint: typeof e.hint === "string" ? e.hint : null,
  };
}

type ReturnKind = "void" | "set" | "row" | "scalar";

interface FunctionInfo {
  inNames: string[];
  inTypes: string[];
  required: number;
  kind: ReturnKind;
}

type Filter =
  | { op: "eq" | "neq" | "gte"; column: string; value: unknown }
  | { op: "in"; column: string; values: ReadonlyArray<unknown> }
  | { op: "notIn"; column: string; values: ReadonlyArray<unknown> };

const COMPARATORS = { eq: "=", neq: "<>", gte: ">=" } as const;

export class TransactionalClient {
  #queue: Promise<unknown> = Promise.resolve();
  #savepoint = 0;
  #columnTypes = new Map<string, Map<string, string>>();
  #functions = new Map<string, FunctionInfo[]>();
  #aborted: PostgrestLikeError | null = null;

  constructor(private readonly executor: SqlExecutor) {}

  /** See PushTransaction.aborted. */
  get aborted(): boolean {
    return this.#aborted !== null;
  }

  from(table: string): TransactionalQuery {
    return new TransactionalQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown> = {}): Promise<QueryResult> {
    return this.serialized(() => this.callFunction(name, args));
  }

  /** Serializes calls on the single connection (see module comment). */
  serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  /** Runs one statement in its own savepoint; a failure never escapes it. */
  async statement(
    text: string,
    params: ReadonlyArray<string>,
  ): Promise<{ rows: Array<Record<string, unknown>> | null; error: PostgrestLikeError | null }> {
    if (this.#aborted) return { rows: null, error: this.#aborted };
    this.#savepoint += 1;
    const name = `push_call_${this.#savepoint}`;
    try {
      await this.executor.query(`SAVEPOINT ${name}`, []);
    } catch (error) {
      this.#aborted = toPostgrestError(error);
      return { rows: null, error: this.#aborted };
    }
    try {
      const rows = await this.executor.query(text, params);
      await this.executor.query(`RELEASE SAVEPOINT ${name}`, []);
      return { rows, error: null };
    } catch (error) {
      const failure = toPostgrestError(error);
      try {
        await this.executor.query(`ROLLBACK TO SAVEPOINT ${name}`, []);
        await this.executor.query(`RELEASE SAVEPOINT ${name}`, []);
      } catch {
        // The transaction itself is gone (transaction_timeout, connection).
        this.#aborted = failure;
      }
      return { rows: null, error: failure };
    }
  }

  /**
   * A catalog lookup outside any savepoint: a failure here (typically
   * transaction_timeout) ends the transaction, so it marks it aborted.
   */
  private async metadata(
    text: string,
    params: ReadonlyArray<string>,
  ): Promise<Array<Record<string, unknown>>> {
    if (this.#aborted) throw Object.assign(new Error(this.#aborted.message), this.#aborted);
    try {
      return await this.executor.query(text, params);
    } catch (error) {
      this.#aborted = toPostgrestError(error);
      throw error;
    }
  }

  async columnTypes(table: string): Promise<Map<string, string>> {
    const cached = this.#columnTypes.get(table);
    if (cached) return cached;
    const rows = await this.metadata(
      `SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = to_regclass('public.' || quote_ident($1::text))
          AND a.attnum > 0 AND NOT a.attisdropped`,
      [table],
    );
    const types = new Map(rows.map((r) => [String(r.name), String(r.type)]));
    this.#columnTypes.set(table, types);
    return types;
  }

  private async functionInfo(name: string): Promise<FunctionInfo[]> {
    const cached = this.#functions.get(name);
    if (cached) return cached;
    const rows = await this.metadata(
      `SELECT coalesce(p.proargnames, '{}')::text[] AS argnames,
              coalesce(p.proargmodes::text[], '{}') AS argmodes,
              array(SELECT format_type(x, NULL) FROM unnest(p.proargtypes) x) AS argtypes,
              p.pronargs AS nargs, p.pronargdefaults AS ndefaults,
              p.proretset AS retset, t.typtype::text AS typtype,
              p.prorettype = 'pg_catalog.void'::regtype AS isvoid,
              p.prorettype = 'pg_catalog.record'::regtype AS isrecord
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_catalog.pg_type t ON t.oid = p.prorettype
        WHERE n.nspname = 'public' AND p.proname = $1::text`,
      [name],
    );
    const infos = rows.map((r): FunctionInfo => {
      const names = r.argnames as string[];
      const modes = r.argmodes as string[];
      const inNames = modes.length === 0
        ? names
        : names.filter((_, i) => ["i", "b", "v"].includes(modes[i]));
      const kind: ReturnKind = r.isvoid
        ? "void"
        : r.retset
        ? "set"
        : r.typtype === "c" || r.isrecord
        ? "row"
        : "scalar";
      return {
        inNames,
        inTypes: r.argtypes as string[],
        required: Number(r.nargs) - Number(r.ndefaults),
        kind,
      };
    });
    this.#functions.set(name, infos);
    return infos;
  }

  private async callFunction(
    name: string,
    args: Record<string, unknown>,
  ): Promise<QueryResult> {
    // undefined keys are dropped by JSON.stringify over PostgREST too.
    const keys = Object.keys(args).filter((k) => args[k] !== undefined);
    const overloads = await this.functionInfo(name);
    const info = overloads.find((o) =>
      keys.every((k) => o.inNames.includes(k)) &&
      o.inNames.slice(0, o.required).every((k) => keys.includes(k))
    );
    if (!info) {
      return {
        data: null,
        error: {
          message: `Could not find the function public.${name} with the given arguments`,
          code: "PGRST202",
          details: null,
          hint: null,
        },
      };
    }
    const params: string[] = [];
    const named = keys.map((key) => {
      const type = info.inTypes[info.inNames.indexOf(key)];
      const value = args[key];
      if (value === null) return `${ident(key)} => NULL::${type}`;
      if (type === "json" || type === "jsonb") {
        params.push(JSON.stringify(value));
      } else if (type.endsWith("[]")) {
        params.push(arrayLiteral(Array.isArray(value) ? value : [value]));
      } else {
        params.push(scalarText(value));
      }
      return `${ident(key)} => $${params.length}::text::${type}`;
    });
    const call = `public.${ident(name)}(${named.join(", ")})`;
    const text = info.kind === "void"
      ? `SELECT ${call}`
      : info.kind === "set"
      ? `SELECT coalesce(json_agg(r), '[]'::json)::text AS j FROM ${call} r`
      : info.kind === "row"
      ? `SELECT to_json(r)::text AS j FROM ${call} r`
      : `SELECT to_json(${call})::text AS j`;
    const { rows, error } = await this.statement(text, params);
    if (error) return { data: null, error };
    if (info.kind === "void") return { data: null, error: null };
    const json = rows?.[0]?.j;
    return { data: typeof json === "string" ? JSON.parse(json) : null, error: null };
  }
}

export class TransactionalQuery implements PromiseLike<QueryResult> {
  #op: "select" | "upsert" | "delete" | null = null;
  #columns: string[] | null = null;
  #returning: string[] | null = null;
  #rows: Array<Record<string, unknown>> = [];
  #onConflict: string[] = [];
  #ignoreDuplicates = false;
  #filters: Filter[] = [];
  #order: { column: string; ascending: boolean } | null = null;
  #range: { from: number; to: number } | null = null;

  constructor(
    private readonly client: TransactionalClient,
    private readonly table: string,
  ) {}

  select(columns = "*"): this {
    const list = columns.split(",").map((c) => c.trim()).filter(Boolean);
    if (this.#op === "upsert" || this.#op === "delete") {
      this.#returning = list;
    } else {
      this.#op = "select";
      this.#columns = list;
    }
    return this;
  }

  upsert(
    rows: Record<string, unknown> | Array<Record<string, unknown>>,
    options: { onConflict?: string; ignoreDuplicates?: boolean } = {},
  ): this {
    this.#op = "upsert";
    this.#rows = Array.isArray(rows) ? rows : [rows];
    if (!options.onConflict) {
      throw new Error(`push transaction: upsert into ${this.table} needs onConflict`);
    }
    this.#onConflict = options.onConflict.split(",").map((c) => c.trim());
    this.#ignoreDuplicates = options.ignoreDuplicates === true;
    return this;
  }

  delete(): this {
    this.#op = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.#filters.push({ op: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.#filters.push({ op: "neq", column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.#filters.push({ op: "gte", column, value });
    return this;
  }

  in(column: string, values: ReadonlyArray<unknown>): this {
    this.#filters.push({ op: "in", column, values });
    return this;
  }

  not(column: string, operator: string, value: string): this {
    if (operator !== "in") {
      throw new Error(`push transaction: unsupported not(${operator})`);
    }
    this.#filters.push({ op: "notIn", column, values: parseListValue(value) });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.#order = { column, ascending: options.ascending !== false };
    return this;
  }

  range(from: number, to: number): this {
    this.#range = { from, to };
    return this;
  }

  /** Type-only in supabase-js. */
  returns<_T>(): this {
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.client.serialized(() => this.execute()).then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    const types = await this.client.columnTypes(this.table);
    const typeOf = (column: string) => {
      const type = types.get(column);
      if (!type) throw new Error(`push transaction: unknown column ${this.table}.${column}`);
      return type;
    };
    const table = `public.${ident(this.table)}`;
    const params: string[] = [];
    const where = this.#filters.map((f) => {
      const column = ident(f.column);
      const type = typeOf(f.column);
      if (f.op === "in" || f.op === "notIn") {
        params.push(arrayLiteral(f.values));
        const test = `${column} = ANY($${params.length}::text::${type}[])`;
        return f.op === "in" ? test : `NOT (${test})`;
      }
      params.push(scalarText(f.value));
      return `${column} ${COMPARATORS[f.op]} $${params.length}::text::${type}`;
    });
    const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const list = (cols: string[]) => cols.map((c) => (c === "*" ? "*" : ident(c))).join(", ");
    const aggregate = (source: string) =>
      `SELECT coalesce(json_agg(r), '[]'::json)::text AS j FROM (${source}) r`;

    let text: string;
    if (this.#op === "select") {
      let source = `SELECT ${list(this.#columns ?? ["*"])} FROM ${table}${whereSql}`;
      if (this.#order) {
        source += ` ORDER BY ${ident(this.#order.column)} ${this.#order.ascending ? "ASC" : "DESC"}`;
      }
      if (this.#range) {
        source += ` LIMIT ${this.#range.to - this.#range.from + 1} OFFSET ${this.#range.from}`;
      }
      text = aggregate(source);
    } else if (this.#op === "delete") {
      if (!whereSql) throw new Error(`push transaction: unfiltered delete on ${this.table}`);
      text = this.#returning
        ? `WITH w AS (DELETE FROM ${table}${whereSql} RETURNING ${list(this.#returning)}) ${aggregate("SELECT * FROM w")}`
        : `DELETE FROM ${table}${whereSql}`;
    } else if (this.#op === "upsert") {
      if (this.#rows.length === 0) {
        return { data: this.#returning ? [] : null, error: null };
      }
      const columns: string[] = [];
      for (const row of this.#rows) {
        for (const key of Object.keys(row)) {
          if (row[key] !== undefined && !columns.includes(key)) columns.push(key);
        }
      }
      params.push(JSON.stringify(this.#rows));
      const cols = list(columns);
      const action = this.#ignoreDuplicates
        ? "DO NOTHING"
        : `DO UPDATE SET ${columns.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(", ")}`;
      const insert =
        `INSERT INTO ${table} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${table}, $${params.length}::text::json)` +
        ` ON CONFLICT (${list(this.#onConflict)}) ${action}`;
      text = this.#returning
        ? `WITH w AS (${insert} RETURNING ${list(this.#returning)}) ${aggregate("SELECT * FROM w")}`
        : insert;
    } else {
      throw new Error(`push transaction: no operation on ${this.table}`);
    }

    const { rows, error } = await this.client.statement(text, params);
    if (error) return { data: null, error };
    const returnsRows = this.#op === "select" || this.#returning !== null;
    if (!returnsRows) return { data: null, error: null };
    const json = rows?.[0]?.j;
    return { data: typeof json === "string" ? JSON.parse(json) : [], error: null };
  }
}

/**
 * Longest a push transaction may stay open (Postgres 17 transaction_timeout).
 * Every trigger and RPC inside it stamps rows with the transaction-stable
 * now() of BEGIN, yet nothing is visible until COMMIT. mobile-sync-pull
 * re-reads everything changed since `lastSync - STALE_OVERLAP_MS` (two
 * minutes), so a push that committed later than that after its BEGIN could
 * land behind another device's cursor and never reach it. Past this limit
 * Postgres ends the transaction, nothing commits, and the device retries.
 */
export const PUSH_TRANSACTION_TIMEOUT_MS = 100_000;

/**
 * Wraps an executor in BEGIN … COMMIT as `service_role`, like PostgREST's
 * service-role requests. Exported for tests (fake executor).
 */
export async function beginPushTransaction(
  executor: SqlExecutor,
): Promise<PushTransaction> {
  await executor.query("BEGIN", []);
  try {
    await executor.query("SET LOCAL ROLE service_role", []);
    await executor.query(
      "SELECT set_config('request.jwt.claims', $1::text, true)",
      [JSON.stringify({ role: "service_role" })],
    );
    await executor.query("SET LOCAL TIME ZONE 'UTC'", []);
    await executor.query(
      `SET LOCAL transaction_timeout = ${PUSH_TRANSACTION_TIMEOUT_MS}`,
      [],
    );
  } catch (error) {
    await executor.query("ROLLBACK", []).catch(() => undefined);
    await executor.end().catch(() => undefined);
    throw error;
  }
  const client = new TransactionalClient(executor);
  let settled = false;
  const finish = async (statement: "COMMIT" | "ROLLBACK") => {
    if (settled) return;
    settled = true;
    try {
      // Let any in-flight call finish before ending the transaction.
      await client.serialized(() => executor.query(statement, []));
    } finally {
      await executor.end().catch(() => undefined);
    }
  };
  return {
    client,
    commit: () => finish("COMMIT"),
    rollback: () => finish("ROLLBACK"),
    get settled() {
      return settled;
    },
    get aborted() {
      return client.aborted;
    },
  };
}

/**
 * Opens a dedicated connection to `dbUrl` (SUPABASE_DB_URL: Supabase's
 * direct / transaction-mode pooler URL) and begins the push transaction.
 * `prepare: false` keeps it pooler-safe.
 */
export async function openPgPushTransaction(dbUrl: string): Promise<PushTransaction> {
  const sql = postgres(dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const executor: SqlExecutor = {
    query: (text, params) =>
      sql.unsafe(text, params as string[]) as unknown as Promise<Array<Record<string, unknown>>>,
    end: () => sql.end({ timeout: 5 }),
  };
  return await beginPushTransaction(executor);
}
