/**
 * Minimal in-memory stand-in for a supabase-js client, for Edge handler tests
 * (no network, no live secrets). Supports the PostgREST builder subset the
 * sync handlers use: select / insert / update / upsert(onConflict), eq / is /
 * lt / lte / gt / gte / in, order / limit, single / maybeSingle, awaiting the
 * builder, unique-index enforcement, and `rpc()` against registered stubs.
 */

export type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

/**
 * A unique index over one table. `key` returns the index key of a row, or null
 * when the row is outside the index's partial predicate (and so unconstrained).
 * An insert whose key collides with an existing row fails the way Postgres
 * does: SQLSTATE 23505, naming the index.
 */
export interface FakeUniqueIndex {
  name: string;
  table: string;
  key: (row: Row) => string | null;
}

/** Stub for one RPC: return `{data}` or `{error}`; may throw to simulate a crash. */
export type RpcHandler = (args: Row) => Result;

export class FakeDb {
  tables: Record<string, Row[]>;
  uniqueIndexes: FakeUniqueIndex[];
  /** Registered `rpc(name, args)` stubs. An unregistered name errors. */
  rpcHandlers: Record<string, RpcHandler> = {};
  /** Every rpc call in order, so tests can assert one call per user. */
  rpcCalls: Array<{ name: string; args: Row }> = [];
  constructor(tables: Record<string, Row[]> = {}, uniqueIndexes: FakeUniqueIndex[] = []) {
    this.tables = tables;
    this.uniqueIndexes = uniqueIndexes;
  }
  from(table: string): FakeQuery {
    this.tables[table] ??= [];
    return new FakeQuery(
      this.tables[table],
      this.uniqueIndexes.filter((index) => index.table === table),
    );
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

/**
 * The `sync_queue_one_active` index from migration 20260920005200: one active
 * (pending/processing) row per (user_id, provider, initial-or-not).
 */
export const syncQueueOneActiveIndex: FakeUniqueIndex = {
  name: 'sync_queue_one_active',
  table: 'sync_queue',
  key: (row) => {
    const status = row.status as string | undefined;
    if (status !== 'pending' && status !== 'processing') return null;
    const isInitial = (row.sync_type ?? 'incremental') === 'initial';
    return `${row.user_id}|${row.provider}|${isInitial}`;
  },
};

/** One worker per user/provider, even when pending rows use different classes. */
export const syncQueueOneProcessingIndex: FakeUniqueIndex = {
  name: 'sync_queue_one_processing',
  table: 'sync_queue',
  key: (row) =>
    row.status === 'processing' ? `${row.user_id}|${row.provider}` : null,
};

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
  private ignoreDuplicates = false;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private returning = false;

  constructor(private rows: Row[], private uniqueIndexes: FakeUniqueIndex[] = []) {}

  select(_cols?: string) {
    // `insert(...).select()` returns the inserted rows, as PostgREST does.
    if (this.insertRows) this.returning = true;
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
  upsert(row: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.insertRows = Array.isArray(row) ? row : [row];
    this.upsertConflict = (opts?.onConflict ?? 'id').split(',').map((c) => c.trim());
    // ON CONFLICT DO NOTHING: an existing row is left exactly as it is.
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
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
      const written: Row[] = [];
      for (const row of this.insertRows) {
        const keys = this.upsertConflict;
        const existing = keys
          ? this.rows.find((r) => keys.every((k) => r[k] === row[k]))
          : undefined;
        if (existing) {
          if (!this.ignoreDuplicates) {
            Object.assign(existing, row);
            written.push(existing);
          }
          continue;
        }
        // Only mint an id when the caller asked for the row back (PostgREST
        // would return the DB default); other inserts keep their exact shape.
        const inserted: Row =
          this.returning && row.id === undefined
            ? { id: crypto.randomUUID(), ...row }
            : { ...row };
        const violated = this.uniqueIndexes.find((index) => {
          const key = index.key(inserted);
          return key !== null && this.rows.some((r) => index.key(r) === key);
        });
        if (violated) {
          return {
            data: null,
            error: {
              code: '23505',
              message:
                `duplicate key value violates unique constraint "${violated.name}"`,
            },
          };
        }
        this.rows.push(inserted);
        written.push(inserted);
      }
      if (!this.returning) return { data: null, error: null };
      const copies = written.map((r) => ({ ...r }));
      if (this.mode === 'many') return { data: copies, error: null };
      if (this.mode === 'single' && copies.length !== 1) {
        return { data: null, error: { message: `expected 1 row, got ${copies.length}` } };
      }
      return { data: copies[0] ?? null, error: null };
    }
    let matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.patch) {
      // Unique indexes hold for UPDATEs too, all or nothing (as Postgres).
      const patched = matched.map((r) => ({ ...r, ...this.patch }));
      const violated = this.uniqueIndexes.find((index) =>
        patched.some((next, i) => {
          const key = index.key(next);
          return key !== null &&
            this.rows.some((r) => r !== matched[i] && !matched.includes(r) && index.key(r) === key);
        })
      );
      if (violated) {
        return {
          data: null,
          error: {
            code: '23505',
            message: `duplicate key value violates unique constraint "${violated.name}"`,
          },
        };
      }
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

/**
 * In-memory stand-in for the `public.check_rate_limit` RPC
 * (supabase/migrations/20260420133000_check_rate_limit_rpc.sql), backed by the
 * FakeDb's `rate_limit_tracking` rows so handler tests exercise the real
 * `_shared/rateLimit.ts` helper instead of stubbing it out.
 *
 * Mirrors the SQL: first request in a window inserts, an expired window resets
 * to 1, a full window returns allowed=false with a ceil()'d retry-after of at
 * least 1 second, otherwise the counter increments.
 *
 * Two deliberate omissions, neither observable through `checkRateLimit`:
 *  - the SQL's four `RAISE EXCEPTION` argument checks (blank key, null user,
 *    max < 1, window < 1) — `_shared/rateLimit.ts` pre-validates exactly those
 *    four and 503s first, so they are unreachable. A PR that relaxes that
 *    pre-validation must add them here, or this double will quietly accept
 *    what the real function rejects.
 *  - the `provider = COALESCE(provider, p_key)` backfill on the reset and
 *    increment paths — nothing reads `provider` off these rows.
 */
function checkRateLimitRpc(db: FakeDb, args: Row, now: Date): Result {
  const key = args.p_key as string;
  const userId = args.p_user_id as string;
  const maxRequests = args.p_max_requests as number;
  const windowMs = (args.p_window_seconds as number) * 1000;
  const nowMs = now.getTime();
  const iso = now.toISOString();
  const rows = db.rows('rate_limit_tracking');
  const row = rows.find((r) => r.key === key && r.user_id === userId);
  const allow = (remaining: number): Result => ({
    data: [{ allowed: true, remaining, retry_after_seconds: null }],
    error: null,
  });

  if (!row) {
    rows.push({
      id: crypto.randomUUID(),
      key,
      user_id: userId,
      provider: key,
      requests_this_window: 1,
      window_started_at: iso,
      last_request_at: iso,
      last_reset_at: null,
    });
    return allow(Math.max(maxRequests - 1, 0));
  }

  const windowStart = Date.parse(row.window_started_at as string);
  if (windowStart < nowMs - windowMs) {
    row.requests_this_window = 1;
    row.window_started_at = iso;
    row.last_request_at = iso;
    row.last_reset_at = iso;
    return allow(Math.max(maxRequests - 1, 0));
  }

  const used = row.requests_this_window as number;
  if (used >= maxRequests) {
    return {
      data: [{
        allowed: false,
        remaining: 0,
        retry_after_seconds: Math.max(
          Math.ceil((windowStart + windowMs - nowMs) / 1000),
          1,
        ),
      }],
      error: null,
    };
  }

  row.requests_this_window = used + 1;
  row.last_request_at = iso;
  return allow(Math.max(maxRequests - (used + 1), 0));
}

/**
 * A client whose `auth.getUser()` resolves to `userId` (the browser JWT path)
 * or, by default, to no user at all (the service-role path).
 *
 * `now` drives the RPC doubles, so a test can advance a virtual clock past a
 * rate-limit window without sleeping.
 */
export function fakeClient(
  db: FakeDb,
  userId: string | null = null,
  now: () => Date = () => new Date(),
) {
  const user = userId === null ? null : { id: userId };
  return {
    from: (table: string) => db.from(table),
    auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) },
    rpc: (fn: string, args: Row = {}): Promise<Result> => {
      if (fn === 'check_rate_limit') {
        return Promise.resolve(checkRateLimitRpc(db, args, now()));
      }
      // A stub the test registered on the db.
      if (db.rpcHandlers[fn]) return db.rpc(fn, args);
      // Postgres' "function does not exist" — callers that have a fallback
      // path take it, the rest fail closed.
      return Promise.resolve({
        data: null,
        error: { code: '42883', message: `function public.${fn} does not exist` },
      });
    },
  };
}
