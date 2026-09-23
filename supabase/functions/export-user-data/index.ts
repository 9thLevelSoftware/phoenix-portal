import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import {
  getUserDataTable,
  isNonTableSource,
  USER_DATA_PAGE_SIZE,
  type UserDataTable,
} from '../_shared/userDataManifest.ts';

/**
 * GDPR export, one keyset page at a time (KD-7). Contract: see the header of
 * `_shared/userDataManifest.ts`.
 *
 * POST { table, cursor? } -> { table, rows, nextCursor | null [, tableMissing] }
 *
 * The user id comes only from the verified JWT. Table queries run with the
 * service role (so tier-gated RLS can never hide a user's own data from
 * their export), select only the manifest's explicit columns, are scoped by
 * the entry's ownership path and ordered by its key columns. `nextCursor`
 * is set when a one-row probe after the page's last key finds another row,
 * not from the page length, so a PostgREST `max_rows` below the requested
 * limit cannot end the export early, and an exact multiple of the page size
 * needs no trailing empty page. (PR 37 R-8: the probe replaced a per-page
 * exact count of the remaining rows, which rescanned the rest of a large
 * table on every page and made a long export quadratic.)
 */

export const EXPORT_RATE_LIMIT = { maxRequests: 600, windowSeconds: 3600 } as const;

const MAX_CURSOR_VALUE_LENGTH = 512;
const AVATARS_BUCKET = 'avatars';

type CursorValue = string | number;
export type ExportCursor = Record<string, CursorValue>;
type Row = Record<string, unknown>;

export interface ExportUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  identities?: Array<{ provider?: string | null }> | null;
  app_metadata?: { providers?: unknown } | null;
}

export interface ExportUserDataAuthClient {
  auth: {
    getUser(jwt: string): Promise<unknown>;
  };
}

export interface ExportUserDataHandlerDependencies {
  createAuthClient(authorization: string): ExportUserDataAuthClient;
  createAdminClient(): SupabaseClient;
}

function defaultDependencies(): ExportUserDataHandlerDependencies {
  return {
    createAuthClient(authorization: string) {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        {
          global: { headers: { Authorization: authorization } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
    },
    createAdminClient() {
      return createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    },
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ParsedRequest =
  | { ok: true; kind: 'table'; entry: UserDataTable; cursor: ExportCursor | null }
  | { ok: true; kind: 'source'; source: string }
  | { ok: false; error: string };

export function parseExportRequest(body: unknown): ParsedRequest {
  if (!isPlainObject(body)) return { ok: false, error: 'Body must be a JSON object' };
  const { table, cursor } = body;
  if (typeof table !== 'string') return { ok: false, error: 'table is required' };
  if (isNonTableSource(table)) {
    if (cursor !== undefined && cursor !== null) {
      return { ok: false, error: 'cursor is not supported for this source' };
    }
    return { ok: true, kind: 'source', source: table };
  }
  const entry = getUserDataTable(table);
  if (!entry) return { ok: false, error: 'Unknown or non-exportable table' };
  if (cursor === undefined || cursor === null) {
    return { ok: true, kind: 'table', entry, cursor: null };
  }
  if (!isPlainObject(cursor)) return { ok: false, error: 'cursor must be an object' };
  const keys = Object.keys(cursor);
  const cursorColumns = entry.exportPager ? [entry.exportPager.cursorColumn] : entry.keyColumns;
  if (
    keys.length !== cursorColumns.length ||
    !cursorColumns.every((column) => Object.hasOwn(cursor, column))
  ) {
    return { ok: false, error: `cursor must have exactly: ${cursorColumns.join(', ')}` };
  }
  const parsed: ExportCursor = {};
  for (const column of cursorColumns) {
    const value = cursor[column];
    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed[column] = value;
    } else if (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_CURSOR_VALUE_LENGTH
    ) {
      parsed[column] = value;
    } else {
      return { ok: false, error: `cursor.${column} is invalid` };
    }
  }
  return { ok: true, kind: 'table', entry, cursor: parsed };
}

/** Quotes a value for a PostgREST logic-tree (`or=`) filter. */
function quoteFilterValue(value: CursorValue): string {
  if (typeof value === 'number') return String(value);
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Row-value comparison `(k1, k2, ...) > (v1, v2, ...)` expanded for
 * PostgREST: `k1.gt.v1,and(k1.eq.v1,k2.gt.v2),...` (used inside `or(...)`).
 */
export function buildKeysetOrFilter(
  keyColumns: readonly string[],
  cursor: ExportCursor,
): string {
  const branches: string[] = [];
  for (let i = 0; i < keyColumns.length; i++) {
    const terms = keyColumns
      .slice(0, i)
      .map((column) => `${column}.eq.${quoteFilterValue(cursor[column])}`);
    terms.push(`${keyColumns[i]}.gt.${quoteFilterValue(cursor[keyColumns[i]])}`);
    branches.push(terms.length === 1 ? terms[0] : `and(${terms.join(',')})`);
  }
  return branches.join(',');
}

interface PgError {
  code?: string;
  message?: string;
}

export function isMissingRelation(error: PgError): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation .* does not exist/i.test(error.message ?? '') ||
    /could not find the table/i.test(error.message ?? '')
  );
}

/** Postgres input-syntax errors: a cursor value of the wrong type. */
function isInvalidInput(error: PgError): boolean {
  return ['22P02', '22007', '22008', '22003'].includes(error.code ?? '');
}

function isUndefinedColumn(error: PgError): boolean {
  return error.code === '42703' || error.code === 'PGRST204';
}

export type ExportPageResult =
  | { ok: true; rows: Row[]; nextCursor: ExportCursor | null; tableMissing: boolean }
  | { ok: false; reason: 'invalid_cursor' | 'query_failed'; error: unknown };

async function queryPage(
  admin: SupabaseClient,
  entry: UserDataTable,
  userId: string,
  cursor: ExportCursor | null,
  columns: readonly string[],
  limit: number = USER_DATA_PAGE_SIZE,
) {
  const { ownership, keyColumns } = entry;
  const select = ownership.kind === 'parent'
    ? `${columns.join(',')},${ownership.parentTable}!${ownership.fkColumn}!inner(${ownership.parentColumn})`
    : columns.join(',');
  let query = admin.from(entry.table).select(select);
  query = ownership.kind === 'parent'
    ? query.eq(`${ownership.parentTable}.${ownership.parentColumn}`, userId)
    : query.eq(ownership.column, userId);
  if (cursor) {
    query = keyColumns.length === 1
      ? query.gt(keyColumns[0], cursor[keyColumns[0]])
      : query.or(buildKeysetOrFilter(keyColumns, cursor));
  }
  for (const column of keyColumns) query = query.order(column, { ascending: true });
  return await query.limit(limit);
}

async function readPagerPage(
  admin: SupabaseClient,
  entry: UserDataTable & { exportPager: { rpc: string; cursorColumn: string } },
  userId: string,
  cursor: ExportCursor | null,
): Promise<ExportPageResult> {
  const { rpc, cursorColumn } = entry.exportPager;
  const call = (after: CursorValue | null, target: number) =>
    admin.rpc(rpc, { p_user_id: userId, p_after_set_id: after, p_target_rows: target });
  const { data, error } = await call(cursor ? cursor[cursorColumn] : null, USER_DATA_PAGE_SIZE);
  if (error) {
    if (cursor && isInvalidInput(error as PgError)) return { ok: false, reason: 'invalid_cursor', error };
    return { ok: false, reason: 'query_failed', error };
  }
  // One jsonb array per call (never a row set PostgREST could cap).
  const rows = ((Array.isArray(data) ? data : []) as Row[]).map((row) => {
    const out: Row = {};
    for (const column of entry.columns) out[column] = row[column];
    return out;
  });
  if (rows.length === 0) return { ok: true, rows, nextCursor: null, tableMissing: false };
  const lastKey: ExportCursor = { [cursorColumn]: rows[rows.length - 1][cursorColumn] as CursorValue };
  const probe = await call(lastKey[cursorColumn], 1);
  if (probe.error) return { ok: false, reason: 'query_failed', error: probe.error };
  const nextCursor = Array.isArray(probe.data) && probe.data.length > 0 ? lastKey : null;
  return { ok: true, rows, nextCursor, tableMissing: false };
}

export async function readExportPage(
  admin: SupabaseClient,
  entry: UserDataTable,
  userId: string,
  cursor: ExportCursor | null,
): Promise<ExportPageResult> {
  if (entry.exportPager) {
    return await readPagerPage(
      admin,
      entry as UserDataTable & { exportPager: { rpc: string; cursorColumn: string } },
      userId,
      cursor,
    );
  }
  const optional = entry.optionalColumns ?? [];
  let result = await queryPage(admin, entry, userId, cursor, [...entry.columns, ...optional]);
  if (result.error && optional.length > 0 && isUndefinedColumn(result.error)) {
    // Prod-only drift columns are absent in this database.
    result = await queryPage(admin, entry, userId, cursor, entry.columns);
  }
  const { data, error } = result;

  if (error) {
    if (isMissingRelation(error) && entry.mayBeAbsent) {
      return { ok: true, rows: [], nextCursor: null, tableMissing: true };
    }
    if (cursor && isInvalidInput(error)) {
      return { ok: false, reason: 'invalid_cursor', error };
    }
    return { ok: false, reason: 'query_failed', error };
  }

  const raw = (data ?? []) as unknown as Row[];
  const rows = raw.map((row) => {
    if (entry.ownership.kind !== 'parent') return row;
    const out = { ...row };
    delete out[entry.ownership.parentTable];
    return out;
  });

  if (raw.length === 0) return { ok: true, rows, nextCursor: null, tableMissing: false };
  const last = raw[raw.length - 1];
  const lastKey: ExportCursor = {};
  for (const column of entry.keyColumns) lastKey[column] = last[column] as CursorValue;

  // More pages remain exactly when a row exists after this page's last key.
  const probe = await queryPage(admin, entry, userId, lastKey, entry.keyColumns, 1);
  if (probe.error) return { ok: false, reason: 'query_failed', error: probe.error };
  const nextCursor = (probe.data ?? []).length > 0 ? lastKey : null;
  return { ok: true, rows, nextCursor, tableMissing: false };
}

function accountRow(user: ExportUser): Row {
  const fromIdentities = (user.identities ?? [])
    .map((identity) => identity?.provider)
    .filter((provider): provider is string => typeof provider === 'string');
  const fromMetadata = Array.isArray(user.app_metadata?.providers)
    ? (user.app_metadata!.providers as unknown[]).filter(
      (provider): provider is string => typeof provider === 'string',
    )
    : [];
  return {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone || null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    identity_providers: [...new Set([...fromIdentities, ...fromMetadata])].sort(),
  };
}

async function readSource(
  admin: SupabaseClient,
  source: string,
  user: ExportUser,
): Promise<{ ok: true; rows: Row[] } | { ok: false; error: unknown }> {
  if (source === 'auth_account') return { ok: true, rows: [accountRow(user)] };
  // storage_avatars
  const { data, error } = await admin.storage
    .from(AVATARS_BUCKET)
    .list(user.id, { limit: USER_DATA_PAGE_SIZE, sortBy: { column: 'name', order: 'asc' } });
  if (error) return { ok: false, error };
  const rows = (data ?? [])
    .filter((object) => object.id !== null) // folders have no id
    .map((object) => {
      const metadata = (object.metadata ?? {}) as Record<string, unknown>;
      return {
        bucket: AVATARS_BUCKET,
        path: `${user.id}/${object.name}`,
        size: typeof metadata.size === 'number' ? metadata.size : null,
        mimetype: typeof metadata.mimetype === 'string' ? metadata.mimetype : null,
        updated_at: object.updated_at ?? null,
      };
    });
  return { ok: true, rows };
}

function authStatus(error: unknown): number | null {
  if (!isPlainObject(error)) return null;
  const status = error.status;
  return typeof status === 'number' ? status : null;
}

async function exportUserDataHandler(
  req: Request,
  dependencies: ExportUserDataHandlerDependencies,
): Promise<Response> {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  try {
    const authorization = req.headers.get('Authorization');
    const bearer = authorization ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
    if (!authorization || !bearer) return json({ error: 'Missing bearer token' }, 401, cors);

    // A rejected JWT is 401; an auth-service failure is 503 so the client
    // retries instead of treating it as a signed-out session.
    let authResult: unknown;
    try {
      authResult = await dependencies.createAuthClient(authorization).auth.getUser(bearer[1]);
    } catch (error) {
      console.error('[EXPORT_USER_DATA] auth service error', error);
      return json({ error: 'Authentication service unavailable' }, 503, cors);
    }
    const authError = isPlainObject(authResult) ? authResult.error : null;
    if (authError) {
      const status = authStatus(authError);
      if (status === 400 || status === 401 || status === 403) {
        return json({ error: 'Invalid bearer token' }, 401, cors);
      }
      console.error('[EXPORT_USER_DATA] auth service error', { status });
      return json({ error: 'Authentication service unavailable' }, 503, cors);
    }
    const authData = isPlainObject(authResult) ? authResult.data : null;
    const user = isPlainObject(authData) ? authData.user : null;
    if (!isPlainObject(user) || typeof user.id !== 'string' || user.id.length === 0) {
      return json({ error: 'Invalid bearer token' }, 401, cors);
    }
    const verifiedUser = user as unknown as ExportUser;
    const userId = verifiedUser.id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, cors);
    }
    const parsed = parseExportRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400, cors);

    const admin = dependencies.createAdminClient();
    const rate = await checkRateLimit(admin, {
      key: 'export-user-data',
      userId,
      ...EXPORT_RATE_LIMIT,
    }, cors);
    if (!rate.allowed) return rate.response!;

    if (parsed.kind === 'source') {
      const result = await readSource(admin, parsed.source, verifiedUser);
      if (!result.ok) {
        console.error('[EXPORT_USER_DATA] source read failed', {
          source: parsed.source,
          error: result.error,
        });
        return json({ error: 'Export query failed' }, 500, cors);
      }
      return json({ table: parsed.source, rows: result.rows, nextCursor: null }, 200, cors);
    }

    const page = await readExportPage(admin, parsed.entry, userId, parsed.cursor);
    if (!page.ok) {
      if (page.reason === 'invalid_cursor') {
        return json({ error: 'cursor is invalid' }, 400, cors);
      }
      console.error('[EXPORT_USER_DATA] page query failed', {
        table: parsed.entry.table,
        error: page.error,
      });
      return json({ error: 'Export query failed' }, 500, cors);
    }
    if (page.tableMissing) {
      console.warn('[EXPORT_USER_DATA] table missing in this database', {
        table: parsed.entry.table,
      });
    }
    return json({
      table: parsed.entry.table,
      rows: page.rows,
      nextCursor: page.nextCursor,
      ...(page.tableMissing ? { tableMissing: true } : {}),
    }, 200, cors);
  } catch (err) {
    console.error('export-user-data error:', err);
    return json({ error: 'Internal server error' }, 500, cors);
  }
}

export function createExportUserDataHandler(
  dependencies: ExportUserDataHandlerDependencies = defaultDependencies(),
): (req: Request) => Promise<Response> {
  return (req) => exportUserDataHandler(req, dependencies);
}

if (import.meta.main) {
  Deno.serve(createExportUserDataHandler());
}
