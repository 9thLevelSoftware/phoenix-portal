import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import {
  getUserDataTable,
  USER_DATA_PAGE_SIZE,
  type UserDataTable,
} from '../_shared/userDataManifest.ts';

/**
 * GDPR export, one keyset page at a time (KD-7).
 *
 * POST { table, cursor? } -> { table, rows, nextCursor | null }
 *
 * The user id comes only from the verified JWT. The query runs with the
 * service role (so tier-gated RLS can never hide a user's own data from
 * their export) and is scoped by the manifest entry's ownership path.
 * Pages are ordered by the entry's key columns; `nextCursor` holds the last
 * row's key values and is null once a page comes back short.
 */

export const EXPORT_RATE_LIMIT = { maxRequests: 600, windowSeconds: 3600 } as const;

const MAX_CURSOR_VALUE_LENGTH = 512;

type CursorValue = string | number;
export type ExportCursor = Record<string, CursorValue>;

export interface ExportUserDataAuthClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
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
      ) as unknown as ExportUserDataAuthClient;
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

type ParsedRequest =
  | { ok: true; entry: UserDataTable; cursor: ExportCursor | null }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseExportRequest(body: unknown): ParsedRequest {
  if (!isPlainObject(body)) return { ok: false, error: 'Body must be a JSON object' };
  const { table, cursor } = body;
  if (typeof table !== 'string') return { ok: false, error: 'table is required' };
  const entry = getUserDataTable(table);
  if (!entry) return { ok: false, error: 'Unknown or non-exportable table' };
  if (cursor === undefined || cursor === null) return { ok: true, entry, cursor: null };
  if (!isPlainObject(cursor)) return { ok: false, error: 'cursor must be an object' };
  const keys = Object.keys(cursor);
  if (
    keys.length !== entry.keyColumns.length ||
    !entry.keyColumns.every((column) => Object.hasOwn(cursor, column))
  ) {
    return { ok: false, error: `cursor must have exactly: ${entry.keyColumns.join(', ')}` };
  }
  const parsed: ExportCursor = {};
  for (const column of entry.keyColumns) {
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
  return { ok: true, entry, cursor: parsed };
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

function isMissingRelation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation .* does not exist/i.test(error.message ?? '') ||
    /could not find the table/i.test(error.message ?? '')
  );
}

export async function readExportPage(
  admin: SupabaseClient,
  entry: UserDataTable,
  userId: string,
  cursor: ExportCursor | null,
): Promise<
  | { ok: true; rows: Record<string, unknown>[]; nextCursor: ExportCursor | null; tableMissing: boolean }
  | { ok: false; error: unknown }
> {
  const { ownership, keyColumns } = entry;
  const embed = ownership.kind === 'parent'
    ? `${ownership.parentTable}!${ownership.fkColumn}!inner(${ownership.parentColumn})`
    : null;
  let query = admin.from(entry.table).select(embed ? `*, ${embed}` : '*');
  query = ownership.kind === 'parent'
    ? query.eq(`${ownership.parentTable}.${ownership.parentColumn}`, userId)
    : query.eq(ownership.column, userId);
  if (cursor) {
    query = keyColumns.length === 1
      ? query.gt(keyColumns[0], cursor[keyColumns[0]])
      : query.or(buildKeysetOrFilter(keyColumns, cursor));
  }
  for (const column of keyColumns) query = query.order(column, { ascending: true });
  const { data, error } = await query.limit(USER_DATA_PAGE_SIZE);

  if (error) {
    if (isMissingRelation(error)) {
      return { ok: true, rows: [], nextCursor: null, tableMissing: true };
    }
    return { ok: false, error };
  }

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const out = { ...row };
    if (ownership.kind === 'parent') delete out[ownership.parentTable];
    return out;
  });

  let nextCursor: ExportCursor | null = null;
  if (rows.length === USER_DATA_PAGE_SIZE) {
    const last = (data as unknown as Record<string, unknown>[])[rows.length - 1];
    nextCursor = {};
    for (const column of keyColumns) nextCursor[column] = last[column] as CursorValue;
  }
  return { ok: true, rows, nextCursor, tableMissing: false };
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

    const { data: authData, error: authError } = await dependencies
      .createAuthClient(authorization)
      .auth.getUser(bearer[1]);
    const userId = authData?.user?.id;
    if (authError || typeof userId !== 'string' || userId.length === 0) {
      return json({ error: 'Not authenticated' }, 401, cors);
    }

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

    const page = await readExportPage(admin, parsed.entry, userId, parsed.cursor);
    if (!page.ok) {
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
