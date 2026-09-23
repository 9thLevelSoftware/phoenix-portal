import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  type LiftosaurFetchResult,
  fetchLiftosaurHistory,
  parseLiftosaurHistoryPage,
  liftosaurDateOrder,
  parseLiftoscriptMetadata,
  planLiftosaurSync,
  resolveLiftosaurTruncation,
  toLiftosaurActivityRow,
  writeLiftosaurRows,
} from './liftosaurSync.ts';
import { FakeDb, fakeClient } from './testing/fakeSupabase.ts';

const NOW = new Date('2026-09-19T12:00:00.000Z');

Deno.test('parseLiftoscriptMetadata: a pattern-matching but invalid timestamp is undated', () => {
  assertEquals(
    parseLiftoscriptMetadata('2026-13-45T99:99:99Z / program: "P"').timestamp,
    null,
  );
  assertEquals(
    parseLiftoscriptMetadata('2026-03-01T10:00:00Z / program: "P"').timestamp,
    '2026-03-01T10:00:00Z',
  );
});

Deno.test('fetchLiftosaurHistory: hasMore without nextCursor stops after one request as truncated', async () => {
  let requests = 0;
  const result = await fetchLiftosaurHistory(() => {
    requests++;
    return Promise.resolve({
      data: {
        records: [{ id: 1, text: '2026-03-01T10:00:00Z / x' }],
        hasMore: true,
        nextCursor: null,
      },
    });
  });
  assertEquals(requests, 1);
  assertEquals(result.truncated, true);
  assertEquals(result.reason, 'missing_cursor');
  assertEquals(result.records.length, 1);
});

Deno.test('fetchLiftosaurHistory: reaching the page budget reports page_budget and calls onPage per page', async () => {
  let offset = 0;
  let pages = 0;
  const result = await fetchLiftosaurHistory(() => {
    offset += 1;
    return Promise.resolve({
      data: { records: [{ id: offset, text: 'x' }], hasMore: true, nextCursor: offset },
    });
  }, { maxPages: 3, onPage: () => { pages++; } });
  assertEquals(result.truncated, true);
  assertEquals(result.reason, 'page_budget');
  assertEquals(pages, 3);
});

Deno.test('fetchLiftosaurHistory: a 200 that is not a history page fails instead of ending the history', async () => {
  // Each of these used to default to an empty, final page: the run "completed"
  // and the watermark advanced past records nobody read.
  const malformed: unknown[] = [
    { error: 'rate limited' },
    { data: null },
    { data: { hasMore: false } },
    { data: { records: [], hasMore: 'no' } },
    { data: { records: {}, hasMore: false } },
    { data: { records: [{ id: 1 }], hasMore: false } },
    { data: { records: [null], hasMore: false } },
    [],
    null,
  ];
  for (const body of malformed) {
    let pages = 0;
    await assertRejects(
      () => fetchLiftosaurHistory(() => Promise.resolve(body), { onPage: () => { pages++; } }),
      Error,
      'unexpected history page',
    );
    assertEquals(pages, 0, `onPage must not run for ${JSON.stringify(body)}`);
  }
});

Deno.test('fetchLiftosaurHistory: a malformed later page fails the whole fetch', async () => {
  let requests = 0;
  await assertRejects(
    () =>
      fetchLiftosaurHistory(() => {
        requests++;
        return Promise.resolve(
          requests === 1
            ? { data: { records: [{ id: 1, text: 'x' }], hasMore: true, nextCursor: 1 } }
            : { data: { message: 'schema changed' } },
        );
      }),
    Error,
    'unexpected history page',
  );
  assertEquals(requests, 2);
});

Deno.test('parseLiftosaurHistoryPage: a valid page passes; an unusable cursor becomes null', () => {
  assertEquals(
    parseLiftosaurHistoryPage({ data: { records: [{ id: 2, text: 't' }], hasMore: true, nextCursor: '' } }),
    { data: { records: [{ id: 2, text: 't' }], hasMore: true, nextCursor: null } },
  );
  assertThrows(() => parseLiftosaurHistoryPage('not json object'), Error, 'unexpected history page');
});

Deno.test('liftosaurDateOrder: needs two distinct dates in one direction', () => {
  assertEquals(liftosaurDateOrder([]), 'unknown');
  assertEquals(liftosaurDateOrder([5]), 'unknown');
  assertEquals(liftosaurDateOrder([5, 5, 5]), 'unknown');
  assertEquals(liftosaurDateOrder([1, 2, 2, 3]), 'ascending');
  assertEquals(liftosaurDateOrder([3, 2, 2, 1]), 'descending');
  assertEquals(liftosaurDateOrder([1, 3, 2]), 'unknown');
});

Deno.test('fetchLiftosaurHistory: an opaque string cursor is followed, not treated as missing', async () => {
  const seen: Array<string | null> = [];
  const result = await fetchLiftosaurHistory((params) => {
    seen.push(params.get('cursor'));
    const more = seen.length < 2;
    return Promise.resolve({
      data: { records: [{ id: seen.length, text: 'x' }], hasMore: more, nextCursor: more ? 'abc123' : null },
    });
  });
  assertEquals(seen, [null, 'abc123']);
  assertEquals(result.truncated, false);
  assertEquals(result.records.length, 2);
});

Deno.test('planLiftosaurSync: an initial sync starts a fresh full-history chain even mid-backfill', () => {
  const plan = planLiftosaurSync(
    {
      last_sync_at: '2026-09-10T00:00:00.000Z',
      backfill_before: '2026-08-01T00:00:00.000Z',
      backfill_after: null,
      backfill_started_at: '2026-09-18T00:00:00.000Z',
    },
    'initial',
    NOW,
  );
  assertEquals(
    [plan.inBackfill, plan.startDate, plan.endDate, plan.chainStartedAt],
    [false, null, null, NOW.toISOString()],
  );
});

Deno.test('planLiftosaurSync: a non-initial sync continues the chain below its cursor with the chain lower bound', () => {
  const plan = planLiftosaurSync(
    {
      last_sync_at: '2026-09-10T00:00:00.000Z',
      backfill_before: '2026-08-01T00:00:00.000Z',
      backfill_after: '2026-07-01T00:00:00.000Z',
      backfill_started_at: '2026-09-18T00:00:00.000Z',
    },
    'manual',
    NOW,
  );
  assertEquals(
    [plan.inBackfill, plan.startDate, plan.endDate, plan.chainStartedAt],
    [true, '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-09-18T00:00:00.000Z'],
  );
});

function fetched(overrides: Partial<LiftosaurFetchResult>): LiftosaurFetchResult {
  return {
    records: [],
    truncated: true,
    reason: 'page_budget',
    oldestDatedAt: null,
    newestDatedAt: null,
    order: 'unknown',
    ...overrides,
  };
}

Deno.test('resolveLiftosaurTruncation: newest-first continues 1s above the oldest record read', () => {
  const plan = planLiftosaurSync(null, 'initial', NOW);
  const outcome = resolveLiftosaurTruncation(
    fetched({ order: 'descending', oldestDatedAt: '2026-01-01T00:00:00.000Z' }),
    plan,
    'initial',
    2000,
  );
  assertEquals(outcome.kind, 'continue');
  assertEquals(outcome.columns.backfill_before, '2026-01-01T00:00:01.000Z');
  assertEquals(outcome.columns.backfill_started_at, NOW.toISOString());
  assertEquals('last_sync_at' in outcome.columns, false, 'a continuing chain never moves the watermark');
});

Deno.test('resolveLiftosaurTruncation: a chain that stops progressing is stuck, not looped', () => {
  const plan = planLiftosaurSync(
    { backfill_before: '2026-01-01T00:00:01.000Z', backfill_started_at: NOW.toISOString() },
    'incremental',
    NOW,
  );
  // Every record read shares one second, so the next cursor would not move.
  const outcome = resolveLiftosaurTruncation(
    fetched({ order: 'descending', oldestDatedAt: '2026-01-01T00:00:00.000Z' }),
    plan,
    'incremental',
    2000,
  );
  assertEquals(outcome.kind, 'stuck');
  assertEquals(outcome.columns.status, 'error');
});

Deno.test('resolveLiftosaurTruncation: an unordered page has no safe resume point', () => {
  const outcome = resolveLiftosaurTruncation(
    fetched({ order: 'unknown', oldestDatedAt: '2026-01-01T00:00:00.000Z' }),
    planLiftosaurSync(null, 'manual', NOW),
    'manual',
    10,
  );
  assertEquals(outcome.kind, 'stuck');
  assertEquals('last_sync_at' in outcome.columns, false);
});

Deno.test('writeLiftosaurRows: an undated record keeps its first import date on every later run', async () => {
  const db = new FakeDb({ external_activities: [] });
  const client = fakeClient(db, null, () => NOW);
  const undated = { id: 9, text: 'program: "P" / duration: 60s' };

  const first = await writeLiftosaurRows(client, 'u1', [toLiftosaurActivityRow('u1', undated, 'first-run')]);
  assertEquals(first, { written: 1, failed: 0 });
  const later = await writeLiftosaurRows(client, 'u1', [
    toLiftosaurActivityRow('u1', { ...undated, text: 'program: "Renamed" / duration: 60s' }, 'later-run'),
  ]);
  assertEquals(later, { written: 1, failed: 0 });

  const [row] = db.rows('external_activities');
  assertEquals(row.started_at, 'first-run');
  assertEquals(row.name, 'Renamed', 'other columns are refreshed');
});

/** Records every upsert; refuses any request that carries a poisoned row. */
function recordingClient(poisonedExternalId: string | null) {
  const upserts: number[] = [];
  const client = {
    from(_table: string) {
      return {
        upsert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
          const batch = Array.isArray(payload) ? payload : [payload];
          upserts.push(batch.length);
          const poisoned = batch.some((row) => row.external_id === poisonedExternalId);
          return Promise.resolve({ error: poisoned ? { message: 'refused' } : null });
        },
        update() {
          const chain = { eq: () => chain, then: (ok: (v: unknown) => void) => ok({ error: null }) };
          return chain;
        },
      };
    },
  };
  return { client, upserts };
}

const datedRecord = (id: number) => ({
  id,
  text: `2026-03-01T10:00:00Z / program: "P${id}" / duration: 60s`,
});

Deno.test('writeLiftosaurRows: rows are written in chunks, not one request per row', async () => {
  const { client, upserts } = recordingClient(null);
  const rows = Array.from({ length: 250 }, (_, i) => toLiftosaurActivityRow('u1', datedRecord(i + 1), 'run'));
  const progress: number[] = [];
  const result = await writeLiftosaurRows(client, 'u1', rows, {}, (n) => {
    progress.push(n);
  });
  assertEquals(result, { written: 250, failed: 0 });
  assertEquals(upserts, [100, 100, 50]);
  assertEquals(progress, [100, 200, 250]);
});

Deno.test('writeLiftosaurRows: a refused chunk is retried row by row and counts only the bad row', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => toLiftosaurActivityRow('u1', datedRecord(i + 1), 'run'));
  const { client, upserts } = recordingClient(String(rows[2].row.external_id));
  const result = await writeLiftosaurRows(client, 'u1', rows);
  assertEquals(result, { written: 4, failed: 1 });
  assertEquals(upserts, [5, 1, 1, 1, 1, 1]);
});

Deno.test('writeLiftosaurRows: undated rows are refreshed per chunk with their stored dates, with heartbeats', async () => {
  const db = new FakeDb({ external_activities: [] });
  const client = fakeClient(db, null, () => NOW);
  const undated = (id: number, program: string) => ({ id, text: `program: "${program}" / duration: 60s` });
  const first = Array.from({ length: 150 }, (_, i) => toLiftosaurActivityRow('u1', undated(i + 1, 'P'), 'first-run'));
  assertEquals(await writeLiftosaurRows(client, 'u1', first), { written: 150, failed: 0 });

  // Count requests on the re-sync.
  let requests = 0;
  const from = db.from.bind(db);
  db.from = (table: string) => {
    requests++;
    return from(table);
  };
  const progress: number[] = [];
  const later = Array.from({ length: 150 }, (_, i) => toLiftosaurActivityRow('u1', undated(i + 1, 'Renamed'), 'later-run'));
  const result = await writeLiftosaurRows(client, 'u1', later, {}, (n) => {
    progress.push(n);
  });
  assertEquals(result, { written: 150, failed: 0 });
  // Two chunks x (insert-if-absent + read stored dates + refresh), not 150 updates.
  assertEquals(requests, 6);
  assertEquals(progress, [100, 150]);
  const rows = db.rows('external_activities');
  assertEquals(rows.every((row) => row.started_at === 'first-run'), true, 'never re-dated');
  assertEquals(rows.every((row) => row.name === 'Renamed'), true, 'other columns are refreshed');
});
