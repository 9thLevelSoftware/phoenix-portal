import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { localIntegrationEnvironment } from '../_shared/localIntegrationEnvironment.ts';
import { FakeDb, type Row } from '../_shared/testing/fakeSupabase.ts';
import {
  BATCH_SIZE,
  createGenerateInsightsHandler,
  type GenerateInsightsDependencies,
} from './index.ts';

const SUPABASE_URL = 'http://edge.test';
const SERVICE_ROLE_KEY = 'test-service-role-key';
const ANON_KEY = 'test-anon-key';
const CRON_SECRET = 'test-cron-secret';
const NOW = new Date('2026-09-20T12:00:00.000Z');

const BASE_ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: ANON_KEY,
  CRON_SECRET,
};

function userId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

interface Harness {
  handler: (req: Request) => Promise<Response>;
  db: FakeDb;
}

function harness(options: {
  env?: Record<string, string>;
  tables?: Record<string, Row[]>;
  /** User the JWT path resolves to; null = unauthenticated. */
  user?: { id: string } | null;
} = {}): Harness {
  const db = new FakeDb(options.tables ?? {});
  db.rpcHandlers.check_rate_limit = () => ({
    data: [{ allowed: true, remaining: 4, retry_after_seconds: null }],
    error: null,
  });
  db.rpcHandlers.replace_user_insights = () => ({ data: 0, error: null });
  db.rpcHandlers.set_insights_batch_cursor = () => ({ data: null, error: null });
  db.rpcHandlers.insights_batch_candidates = () => ({ data: [], error: null });

  const env = { ...BASE_ENV, ...(options.env ?? {}) };
  const deps: GenerateInsightsDependencies = {
    env: (key) => env[key],
    // deno-lint-ignore no-explicit-any
    createAdminClient: () => db as any,
    createUserClient: () =>
      ({
        from: (table: string) => db.from(table),
        rpc: (name: string, args: Row) => db.rpc(name, args),
        auth: {
          getUser: () =>
            Promise.resolve({
              data: { user: options.user ?? null },
              error: null,
            }),
        },
        // deno-lint-ignore no-explicit-any
      }) as any,
    now: () => NOW,
  };
  return { handler: createGenerateInsightsHandler(deps), db };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${SUPABASE_URL}/functions/v1/generate-insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return await res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch path: the cron secret is the ONLY key to it.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('batch: 401 without the cron secret header', async () => {
  const { db, handler } = harness();
  const res = await handler(post({ mode: 'batch' }));
  assertEquals(res.status, 401);
  assertEquals((await bodyOf(res)).error, 'Unauthorized');
  assertEquals(db.rpcCallNames(), []);
});

Deno.test('batch: 401 with the wrong cron secret', async () => {
  const { db, handler } = harness();
  const res = await handler(post({ mode: 'batch' }, { 'x-cron-secret': 'nope' }));
  assertEquals(res.status, 401);
  assertEquals(db.rpcCallNames(), []);
});

Deno.test('batch: 401 when CRON_SECRET is unset, even if a header is sent', async () => {
  const { db, handler } = harness({
    env: { CRON_SECRET: '' },
  });
  const res = await handler(post({ mode: 'batch' }, { 'x-cron-secret': '' }));
  assertEquals(res.status, 401);
  assertEquals(db.rpcCallNames(), []);
});

Deno.test('batch: a valid user JWT can never take the batch path', async () => {
  // A FLAME user's bearer token is not a cron secret. Without the header the
  // batch branch must 401 rather than falling through to the user path.
  const { db, handler } = harness({ user: { id: userId(1) } });
  const res = await handler(
    post({ mode: 'batch' }, { Authorization: 'Bearer user-jwt' }),
  );
  assertEquals(res.status, 401);
  assertEquals(db.rpcCallNames(), []);
});

Deno.test('batch: processes a full page and returns the next cursor', async () => {
  const ids = Array.from({ length: BATCH_SIZE }, (_, i) => userId(i + 1));
  const { db, handler } = harness({
    tables: {
      workout_sessions: ids.map((id) => ({
        id: `s-${id}`,
        user_id: id,
        started_at: '2026-09-18T10:00:00.000Z',
        total_volume: 1000,
        set_count: 10,
      })),
    },
  });
  db.rpcHandlers.insights_batch_candidates = () => ({
    data: ids.map((id) => ({ user_id: id })),
    error: null,
  });

  const res = await handler(
    post({ mode: 'batch' }, { 'x-cron-secret': CRON_SECRET }),
  );
  assertEquals(res.status, 200);
  const body = await bodyOf(res);
  assertEquals(body.processed, BATCH_SIZE);
  assertEquals(body.failed, 0);
  assertEquals(body.nextCursor, ids[ids.length - 1]);

  // Exactly one persist per user, for the 30d period, and no rate-limit check.
  const persists = db.rpcCalls.filter((c) => c.name === 'replace_user_insights');
  assertEquals(persists.length, BATCH_SIZE);
  assertEquals(
    persists.map((c) => c.args.p_user_id),
    ids,
  );
  assert(persists.every((c) => c.args.p_period === '30d'));
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'check_rate_limit').length,
    0,
  );
});

Deno.test('batch: only the ids SQL returns are processed', async () => {
  // Eligibility (FLAME+ AND active) is decided by
  // public.insights_batch_candidates; an EMBER or inactive user never reaches
  // the handler. Proven end-to-end in insights_schedule.test.sql and in the
  // "integration: " test below.
  const { db, handler } = harness();
  db.rpcHandlers.insights_batch_candidates = (args) => {
    assertEquals(args.p_limit, BATCH_SIZE);
    assertEquals(args.p_cursor, null);
    return { data: [{ user_id: userId(7) }], error: null };
  };

  const res = await handler(
    post({ mode: 'batch' }, { 'x-cron-secret': CRON_SECRET }),
  );
  assertEquals(res.status, 200);
  const persists = db.rpcCalls.filter((c) => c.name === 'replace_user_insights');
  assertEquals(persists.length, 1);
  assertEquals(persists[0].args.p_user_id, userId(7));
});

Deno.test('batch: the incoming cursor is passed through to SQL', async () => {
  const { db, handler } = harness();
  let seen: unknown = 'unset';
  db.rpcHandlers.insights_batch_candidates = (args) => {
    seen = args.p_cursor;
    return { data: [], error: null };
  };
  await handler(
    post(
      { mode: 'batch', cursor: userId(5) },
      { 'x-cron-secret': CRON_SECRET },
    ),
  );
  assertEquals(seen, userId(5));
  // A short page wraps the cursor back to NULL.
  const cursorWrite = db.rpcCalls.find(
    (c) => c.name === 'set_insights_batch_cursor',
  );
  assertEquals(cursorWrite?.args.p_cursor, null);
});

Deno.test('batch: one failing user does not stop the pass', async () => {
  const ids = [userId(1), userId(2), userId(3)];
  const { db, handler } = harness();
  db.rpcHandlers.insights_batch_candidates = () => ({
    data: ids.map((id) => ({ user_id: id })),
    error: null,
  });
  db.rpcHandlers.replace_user_insights = (args) =>
    args.p_user_id === userId(2)
      ? { data: null, error: { message: 'boom' } }
      : { data: 0, error: null };

  const res = await handler(
    post({ mode: 'batch' }, { 'x-cron-secret': CRON_SECRET }),
  );
  assertEquals(res.status, 200);
  const body = await bodyOf(res);
  assertEquals(body.processed, 2);
  assertEquals(body.failed, 1);
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'replace_user_insights').length,
    3,
  );
});

Deno.test('batch: a failed cursor write is a 500, not a silent success', async () => {
  const { db, handler } = harness();
  db.rpcHandlers.insights_batch_candidates = () => ({
    data: [{ user_id: userId(1) }],
    error: null,
  });
  db.rpcHandlers.set_insights_batch_cursor = () => ({
    data: null,
    error: { message: 'no' },
  });

  const res = await handler(
    post({ mode: 'batch' }, { 'x-cron-secret': CRON_SECRET }),
  );
  assertEquals(res.status, 500);
});

Deno.test('batch: a candidate-lookup failure is a 500 and writes nothing', async () => {
  const { db, handler } = harness();
  db.rpcHandlers.insights_batch_candidates = () => ({
    data: null,
    error: { message: 'down' },
  });

  const res = await handler(
    post({ mode: 'batch' }, { 'x-cron-secret': CRON_SECRET }),
  );
  assertEquals(res.status, 500);
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'replace_user_insights').length,
    0,
  );
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'set_insights_batch_cursor').length,
    0,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// User path: FLAME gate.
// ─────────────────────────────────────────────────────────────────────────────

function subscriptionRow(tier: string, status = 'active'): Row {
  return {
    user_id: userId(1),
    tier,
    status,
    current_period_end: '2026-10-20T00:00:00.000Z',
    cancel_at_period_end: false,
  };
}

Deno.test('user path: EMBER is refused with 402 and writes no insights', async () => {
  const { db, handler } = harness({
    user: { id: userId(1) },
    tables: { subscriptions: [subscriptionRow('EMBER')] },
  });
  const res = await handler(
    post({ period: '30d' }, { Authorization: 'Bearer user-jwt' }),
  );
  assertEquals(res.status, 402);
  const body = await bodyOf(res);
  assertEquals(body.error, 'subscription_required');
  assertEquals(body.requiredTier, 'FLAME');
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'replace_user_insights').length,
    0,
  );
});

Deno.test('user path: a user with no subscription row is refused with 402', async () => {
  const { db, handler } = harness({ user: { id: userId(1) } });
  const res = await handler(
    post({}, { Authorization: 'Bearer user-jwt' }),
  );
  assertEquals(res.status, 402);
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'replace_user_insights').length,
    0,
  );
});

Deno.test('user path: FLAME succeeds and persists for the requested period', async () => {
  const { db, handler } = harness({
    user: { id: userId(1) },
    tables: {
      subscriptions: [subscriptionRow('FLAME')],
      workout_sessions: [
        {
          id: 's1',
          user_id: userId(1),
          started_at: '2026-09-18T10:00:00.000Z',
          total_volume: 1000,
          set_count: 10,
        },
      ],
    },
  });
  const res = await handler(
    post({ period: '7d' }, { Authorization: 'Bearer user-jwt' }),
  );
  assertEquals(res.status, 200);
  const body = await bodyOf(res);
  assertEquals(body.success, true);
  assert(Array.isArray(body.data));
  const persists = db.rpcCalls.filter((c) => c.name === 'replace_user_insights');
  assertEquals(persists.length, 1);
  assertEquals(persists[0].args.p_user_id, userId(1));
  assertEquals(persists[0].args.p_period, '7d');
});

Deno.test('user path: past_due FLAME is still entitled (PR 8 grace rules)', async () => {
  const { handler } = harness({
    user: { id: userId(1) },
    tables: {
      subscriptions: [
        {
          ...subscriptionRow('FLAME', 'past_due'),
          current_period_end: '2026-09-01T00:00:00.000Z',
        },
      ],
    },
  });
  const res = await handler(post({}, { Authorization: 'Bearer user-jwt' }));
  assertEquals(res.status, 200);
});

Deno.test('user path: 401 without an Authorization header', async () => {
  const { handler } = harness({ user: { id: userId(1) } });
  const res = await handler(post({ period: '30d' }));
  assertEquals(res.status, 401);
});

Deno.test('user path: 401 when the JWT resolves to no user', async () => {
  const { handler } = harness({ user: null });
  const res = await handler(
    post({ period: '30d' }, { Authorization: 'Bearer bad' }),
  );
  assertEquals(res.status, 401);
});

Deno.test('user path: an unknown period is a 400 after the tier gate', async () => {
  const { handler } = harness({
    user: { id: userId(1) },
    tables: { subscriptions: [subscriptionRow('FLAME')] },
  });
  const res = await handler(
    post({ period: '3d' }, { Authorization: 'Bearer user-jwt' }),
  );
  assertEquals(res.status, 400);
});

Deno.test('non-POST methods are rejected before any auth or write', async () => {
  const { db, handler } = harness();
  const res = await handler(
    new Request(`${SUPABASE_URL}/functions/v1/generate-insights`, {
      method: 'GET',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  );
  assertEquals(res.status, 405);
  assertEquals(db.rpcCallNames(), []);
});

Deno.test('malformed JSON is a 400, not an empty-body default', async () => {
  const { handler } = harness();
  const res = await handler(
    new Request(`${SUPABASE_URL}/functions/v1/generate-insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: '{not json',
    }),
  );
  assertEquals(res.status, 400);
});

// ─────────────────────────────────────────────────────────────────────────────
// Real-SQL: the eligibility predicate lives in
// public.insights_batch_candidates, so only a live database can prove that an
// EMBER or inactive user cannot be refreshed. Gated on a local stack (PR 5
// contract); run by `npm run test:edge:integration`.
// ─────────────────────────────────────────────────────────────────────────────

interface BatchFixture {
  // Loose client type: the bare generic collapses row payloads to `never`.
  // deno-lint-ignore no-explicit-any
  admin: SupabaseClient<any, any, any>;
  userIds: string[];
  flameId: string;
  emberId: string;
  pastDueFlameId: string;
  inactiveFlameId: string;
}

async function createBatchFixture(): Promise<BatchFixture> {
  assert(localIntegrationEnvironment);
  const admin = createClient(
    localIntegrationEnvironment.url,
    localIntegrationEnvironment.serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const suffix = crypto.randomUUID();
  const userIds: string[] = [];
  const make = async (label: string) => {
    const created = await admin.auth.admin.createUser({
      email: `pr64-${label}-${suffix}@example.invalid`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`${label} Auth fixture creation failed`);
    }
    userIds.push(created.data.user.id);
    return created.data.user.id;
  };

  const flameId = await make('flame');
  const emberId = await make('ember');
  const pastDueFlameId = await make('pastdue');
  const inactiveFlameId = await make('inactive');

  const future = new Date(Date.now() + 20 * 86400_000).toISOString();
  const past = new Date(Date.now() - 3 * 86400_000).toISOString();
  const subscriptions = await admin.from('subscriptions').insert([
    { user_id: flameId, tier: 'FLAME', status: 'active', current_period_end: future },
    { user_id: emberId, tier: 'EMBER', status: 'active', current_period_end: future },
    { user_id: pastDueFlameId, tier: 'FLAME', status: 'past_due', current_period_end: past },
    { user_id: inactiveFlameId, tier: 'FLAME', status: 'active', current_period_end: future },
  ]);
  if (subscriptions.error) throw new Error('subscription fixture failed');

  const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
  const stale = new Date(Date.now() - 90 * 86400_000).toISOString();
  const sessions = await admin.from('workout_sessions').insert([
    { id: crypto.randomUUID(), user_id: flameId, started_at: recent, total_volume: 20000, set_count: 40 },
    { id: crypto.randomUUID(), user_id: emberId, started_at: recent, total_volume: 20000, set_count: 40 },
    { id: crypto.randomUUID(), user_id: pastDueFlameId, started_at: recent, total_volume: 20000, set_count: 40 },
    // FLAME, but the only session is outside the 30-day activity window.
    { id: crypto.randomUUID(), user_id: inactiveFlameId, started_at: stale, total_volume: 20000, set_count: 40 },
  ]);
  if (sessions.error) throw new Error('session fixture failed');

  return { admin, userIds, flameId, emberId, pastDueFlameId, inactiveFlameId };
}

async function destroyBatchFixture(fixture: BatchFixture): Promise<void> {
  for (const id of fixture.userIds) {
    await fixture.admin.auth.admin.deleteUser(id);
  }
}

Deno.test({
  name:
    'integration: the scheduled batch refreshes FLAME and past_due FLAME users only',
  ignore: localIntegrationEnvironment === null,
  fn: async () => {
    assert(localIntegrationEnvironment);
    const fixture = await createBatchFixture();
    try {
      const env: Record<string, string> = {
        SUPABASE_URL: localIntegrationEnvironment.url,
        SUPABASE_ANON_KEY: localIntegrationEnvironment.anonKey,
        SUPABASE_SERVICE_ROLE_KEY: localIntegrationEnvironment.serviceRoleKey,
        CRON_SECRET,
      };
      const handler = createGenerateInsightsHandler({
        env: (key) => env[key],
        // deno-lint-ignore no-explicit-any
        createAdminClient: () => fixture.admin as any,
        createUserClient: () => {
          throw new Error('the batch path must never build a user client');
        },
        now: () => new Date(),
      });

      // Without the shared secret, no SQL runs at all.
      const denied = await handler(post({ mode: 'batch' }));
      assertEquals(denied.status, 401);

      const res = await handler(
        post({ mode: 'batch' }, { 'x-cron-secret': CRON_SECRET }),
      );
      assertEquals(res.status, 200);
      const body = await bodyOf(res);
      assertEquals(body.failed, 0);

      const { data: rows, error } = await fixture.admin
        .from('user_insights')
        .select('user_id, period, expires_at')
        .in('user_id', fixture.userIds);
      if (error) throw new Error(`user_insights read failed: ${error.message}`);

      const insightRows = (rows ?? []) as Array<{
        user_id: string;
        period: string;
        expires_at: string | null;
      }>;
      const refreshed = new Set(insightRows.map((r) => r.user_id));
      assert(refreshed.has(fixture.flameId), 'FLAME user was refreshed');
      assert(
        refreshed.has(fixture.pastDueFlameId),
        'past_due FLAME user was refreshed',
      );
      assert(
        !refreshed.has(fixture.emberId),
        'EMBER user must NOT get server insights',
      );
      assert(
        !refreshed.has(fixture.inactiveFlameId),
        'a FLAME user with no recent session must NOT be refreshed',
      );

      assert(insightRows.length > 0, 'the pass wrote at least one row');
      for (const row of insightRows) {
        assertEquals(row.period, '30d');
        assert(
          row.expires_at !== null && Date.parse(row.expires_at) > Date.now(),
          'every written row carries a future expires_at',
        );
      }
    } finally {
      await destroyBatchFixture(fixture);
    }
  },
});
