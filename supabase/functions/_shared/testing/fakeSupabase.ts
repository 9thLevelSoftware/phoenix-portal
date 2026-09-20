/**
 * Minimal in-memory stand-in for a supabase-js client, for Edge handler tests
 * (no network, no live secrets). Supports the PostgREST builder subset the
 * sync handlers use: select / insert / update / upsert(onConflict), eq / is /
 * lt / lte / gt / gte / in, order / limit, single / maybeSingle, awaiting the
 * builder, and `rpc()` against registered stubs.
 */

export type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { message: string } | null };

/** Stub for one RPC: return `{data}` or `{error}`; may throw to simulate a crash. */
export type RpcHandler = (args: Row) => Result;

export class FakeDb {
  tables: Record<string, Row[]>;
  /** Registered `rpc(name, args)` stubs. An unregistered name errors. */
  rpcHandlers: Record<string, RpcHandler> = {};
  /** Every rpc call in order, so tests can assert one call per user. */
  rpcCalls: Array<{ name: string; args: Row }> = [];
  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = tables;
  }
  from(table: string): FakeQuery {
    this.tables[table] ??= [];
    return new FakeQuery(this.tables[table]);
  }
  /** Rows of `table` (created on first access). */
  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }
  rpc(name: string, args: Row = {}): Promise<Result> {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    if (!handler) {
      return Promise.resolve({
        data: null,
        error: { message: `no rpc stub registered for ${name}` },
      });
    }
    return Promise.resolve(handler(args));
  }
  /** Names of the rpc calls made so far, in order. */
  rpcCallNames(): string[] {
    return this.rpcCalls.map((c) => c.name);
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
    return a.localeCompare(b);
  }
  return Number(a) - Number(b);
}

export class FakeQuery implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private patch: Row | null = null;
  private insertRows: Row[] | null = null;
  private upsertConflict: string[] | null = null;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;

  constructor(private rows: Row[]) {}

  select(_cols?: string) {
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  insert(row: Row | Row[]) {
    this.insertRows = Array.isArray(row) ? row : [row];
    return this;
  }
  upsert(row: Row | Row[], opts?: { onConflict?: string }) {
    this.insertRows = Array.isArray(row) ? row : [row];
    this.upsertConflict = (opts?.onConflict ?? 'id').split(',').map((c) => c.trim());
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  lt(col: string, value: string) {
    this.filters.push((r) => r[col] != null && compare(r[col], value) < 0);
    return this;
  }
  lte(col: string, value: string) {
    this.filters.push((r) => r[col] != null && compare(r[col], value) <= 0);
    return this;
  }
  gt(col: string, value: string) {
    this.filters.push((r) => r[col] != null && compare(r[col], value) > 0);
    return this;
  }
  gte(col: string, value: string) {
    this.filters.push((r) => r[col] != null && compare(r[col], value) >= 0);
    return this;
  }
  in(col: string, values: readonly unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  order(col: string, opts: { ascending: boolean }) {
    this.orderBy = { col, asc: opts.ascending };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybeSingle';
    return this;
  }

  private run(): Result {
    if (this.insertRows) {
      for (const row of this.insertRows) {
        const keys = this.upsertConflict;
        const existing = keys
          ? this.rows.find((r) => keys.every((k) => r[k] === row[k]))
          : undefined;
        if (existing) Object.assign(existing, row);
        else this.rows.push({ ...row });
      }
      return { data: null, error: null };
    }
    let matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.patch) {
      for (const r of matched) Object.assign(r, this.patch);
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      matched = [...matched].sort((a, b) => compare(a[col], b[col]) * (asc ? 1 : -1));
    }
    if (this.max !== null) matched = matched.slice(0, this.max);
    const copies = matched.map((r) => ({ ...r }));
    if (this.mode === 'many') return { data: copies, error: null };
    if (this.mode === 'single' && copies.length !== 1) {
      return { data: null, error: { message: `expected 1 row, got ${copies.length}` } };
    }
    return { data: copies[0] ?? null, error: null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/** A client whose `auth.getUser()` resolves to no user (service-role path). */
export function fakeClient(db: FakeDb) {
  return {
    from: (table: string) => db.from(table),
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  };
}
