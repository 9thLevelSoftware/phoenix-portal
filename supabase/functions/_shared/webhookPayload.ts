/**
 * Builds the event for one data-sharing delivery from the CURRENT rows.
 *
 * This is the only place user data is read for a webhook. Isolation (FP-1)
 * rests on one rule, kept here and nowhere else: the root row is read with
 * both its id AND the delivery owner's user id, so an entity that is not the
 * owner's is simply "not found". Children are then read under ids that came
 * out of that owner-checked read (and, where the child table carries one,
 * its own user id as well).
 *
 * A delivery row is a thin reference, so there is no stored payload to go
 * stale: a row that exists is `<entity>.updated` with its current state, and
 * a row that is gone or soft-deleted is `<entity>.deleted` with the id only.
 *
 * Fields are the GDPR export's column lists (userDataManifest.ts), minus the
 * owner's user id and anything in DATA_SHARING_OMITTED_COLUMNS. The manifest
 * test that forbids credential-like column names therefore covers payloads.
 * Loads are sent per cable, exactly as stored (KD-8): nothing is doubled.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  DATA_SHARING_OMITTED_COLUMNS,
  type DataSharingEntity,
  getDataSharingEntity,
} from './dataSharingScopes.ts';
import { getUserDataTable } from './userDataManifest.ts';

type Row = Record<string, unknown>;

/** Rows fetched per request; PostgREST caps a response at 1,000 by default. */
const PAGE_SIZE = 1000;
/** Ids per `in` filter, to keep the request URL bounded. */
const IN_CHUNK = 150;
/** A child table larger than this for one entity is not a webhook payload. */
const MAX_CHILD_ROWS = 20_000;

export type WebhookEvent =
  | { kind: 'updated'; type: string; data: Row }
  | { kind: 'deleted'; type: string; data: Row }
  | { kind: 'skip'; reason: 'unknown_entity' | 'not_shareable' | 'payload_too_large' }
  | { kind: 'error' };

interface TableShape {
  /** Columns to select: everything shareable plus what the checks need. */
  select: string[];
  /** Columns that reach the payload. */
  shared: string[];
  /** The table carries the owner's id in `user_id`. */
  hasUserId: boolean;
}

function tableShape(table: string, alsoSelect: readonly string[] = []): TableShape | null {
  const manifest = getUserDataTable(table);
  if (!manifest) return null;
  const omitted = new Set<string>(['user_id', ...(DATA_SHARING_OMITTED_COLUMNS[table] ?? [])]);
  const shared = manifest.columns.filter((column) => !omitted.has(column));
  const select = [...new Set([...shared, ...alsoSelect])];
  return { select, shared, hasUserId: manifest.columns.includes('user_id') };
}

function project(row: Row, columns: readonly string[]): Row {
  const out: Row = {};
  for (const column of columns) {
    if (column in row) out[column] = row[column];
  }
  return out;
}

/** Every child row under `parentIds`, keyset-paged by id. */
async function readChildren(
  admin: SupabaseClient,
  userId: string,
  table: string,
  fkColumn: string,
  parentIds: readonly string[],
  shape: TableShape,
): Promise<{ ok: true; rows: Row[] } | { ok: false; reason: 'error' | 'too_large' }> {
  const rows: Row[] = [];
  const select = [...new Set([...shape.select, 'id', fkColumn])].join(', ');
  for (let start = 0; start < parentIds.length; start += IN_CHUNK) {
    const chunk = parentIds.slice(start, start + IN_CHUNK);
    let after: string | null = null;
    while (true) {
      let query = admin.from(table).select(select).in(fkColumn, chunk);
      // Belt and braces: the parents are already the owner's, and where the
      // child has its own owner column that must match too.
      if (shape.hasUserId) query = query.eq('user_id', userId);
      if (after !== null) query = query.gt('id', after);
      const { data, error } = await query.order('id', { ascending: true }).limit(PAGE_SIZE);
      if (error) return { ok: false, reason: 'error' };
      const page = (data ?? []) as unknown as Row[];
      rows.push(...page);
      if (rows.length > MAX_CHILD_ROWS) return { ok: false, reason: 'too_large' };
      if (page.length < PAGE_SIZE) break;
      after = String(page[page.length - 1].id);
    }
  }
  return { ok: true, rows };
}

export async function buildWebhookEvent(
  admin: SupabaseClient,
  params: { userId: string; endpointId: string; entity: string; entityId: string },
): Promise<WebhookEvent> {
  const definition: DataSharingEntity | undefined = getDataSharingEntity(params.entity);
  if (!definition) return { kind: 'skip', reason: 'unknown_entity' };

  const needed = [
    definition.idColumn,
    ...(definition.softDeleteColumn ? [definition.softDeleteColumn] : []),
    ...(definition.exclude ? [definition.exclude.column] : []),
  ];
  const rootShape = tableShape(definition.table, needed);
  if (!rootShape) return { kind: 'skip', reason: 'unknown_entity' };

  const base = { endpointId: params.endpointId, entity: definition.entity, id: params.entityId };

  const { data, error } = await admin
    .from(definition.table)
    .select(rootShape.select.join(', '))
    .eq(definition.idColumn, params.entityId)
    // The owner filter. Without it this function would read anyone's row.
    .eq(definition.userColumn, params.userId)
    .maybeSingle();
  if (error) return { kind: 'error' };

  const root = data as unknown as Row | null;
  if (!root) return { kind: 'deleted', type: `${definition.entity}.deleted`, data: base };
  if (definition.exclude && root[definition.exclude.column] === definition.exclude.equals) {
    return { kind: 'skip', reason: 'not_shareable' };
  }
  if (definition.softDeleteColumn && root[definition.softDeleteColumn] != null) {
    return { kind: 'deleted', type: `${definition.entity}.deleted`, data: base };
  }

  const children: Record<string, Row[]> = {};
  const idsByTable = new Map<string, string[]>([[definition.table, [params.entityId]]]);
  for (const child of definition.children) {
    const shape = tableShape(child.table);
    if (!shape) return { kind: 'skip', reason: 'unknown_entity' };
    const parentIds = idsByTable.get(child.parent) ?? [];
    if (parentIds.length === 0) {
      children[child.table] = [];
      idsByTable.set(child.table, []);
      continue;
    }
    const read = await readChildren(admin, params.userId, child.table, child.fkColumn, parentIds, shape);
    if (!read.ok) {
      return read.reason === 'too_large' ? { kind: 'skip', reason: 'payload_too_large' } : { kind: 'error' };
    }
    idsByTable.set(child.table, read.rows.map((row) => String(row.id)));
    children[child.table] = read.rows.map((row) => project(row, shape.shared));
  }

  return {
    kind: 'updated',
    type: `${definition.entity}.updated`,
    data: {
      ...base,
      // Every weight and volume is per cable, as the phone shows it.
      loadConvention: 'per_cable_kg',
      record: project(root, rootShape.shared),
      ...(definition.children.length > 0 ? { children } : {}),
    },
  };
}
