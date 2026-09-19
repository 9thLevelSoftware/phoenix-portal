import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createMobileIntegrationSyncHandler } from './index.ts';

// Handler tests with in-process doubles: an in-memory Supabase client and fake
// Hevy / Liftosaur APIs. No real provider calls.

const USER_ID = '00000000-0000-4000-8000-0000000000c1';
const PREVIOUS_SYNC = '2026-01-01T00:00:00.000Z';

interface DbState {
  lastSyncAt: string | null;
  status: string | null;
  errorMessage: string | null;
  activities: Array<Record<string, unknown>>;
  /** Rate-limit RPC calls by key. */
  rateLimitCalls: Record<string, number>;
  adminClientsCreated: number;
}

function newState(activities: Array<Record<string, unknown>> = []): DbState {
  return {
    lastSyncAt: PREVIOUS_SYNC,
    status: 'connected',
    errorMessage: null,
    activities,
    rateLimitCalls: {},
    adminClientsCreated: 0,
  };
}

function createDbDouble(state: DbState) {
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    let inFilter: unknown[] | null = null;

    const resolve = () => {
      if (table === 'subscriptions') {
        return {
          data: { tier: 'FLAME', status: 'active', current_period_end: '2099-01-01T00:00:00.000Z' },
          error: null,
        };
      }
      if (table === 'oauth_tokens') {
        return { data: { api_key: 'provider-key' }, error: null };
      }
      if (table === 'user_integrations' && pendingUpdate) {
        if ('last_sync_at' in pendingUpdate) state.lastSyncAt = pendingUpdate.last_sync_at as string;
        if ('status' in pendingUpdate) state.status = pendingUpdate.status as string;
        if ('error_message' in pendingUpdate) {
          state.errorMessage = pendingUpdate.error_message as string | null;
        }
      }
      if (table === 'external_activities' && inFilter) {
        const ids = inFilter;
        return {
          data: state.activities
            .filter((row) => ids.includes(row.external_id))
            .map((row) => ({ external_id: row.external_id, started_at: row.started_at })),
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'delete']) {
      builder[method] = () => builder;
    }
    builder.in = (_column: string, values: unknown[]) => {
      inFilter = values;
      return builder;
    };
    builder.update = (values: Record<string, unknown>) => {
      pendingUpdate = values;
      return builder;
    };
    builder.upsert = (
      row: Record<string, unknown>,
      options?: { ignoreDuplicates?: boolean },
    ) => {
      if (table === 'external_activities') {
        const index = state.activities.findIndex((existing) =>
          existing.external_id === row.external_id
        );
        // ignoreDuplicates = ON CONFLICT DO NOTHING; otherwise DO UPDATE of the
        // columns sent. A new row without started_at violates NOT NULL.
        if (index >= 0 && options?.ignoreDuplicates) {
          return Promise.resolve({ data: null, error: null });
        }
        if (index >= 0) state.activities[index] = { ...state.activities[index], ...row };
        else if (!('started_at' in row)) {
          return Promise.resolve({ data: null, error: { message: 'null value in column started_at' } });
        } else state.activities.push(row);
      }
      return Promise.resolve({ data: null, error: null });
    };
    builder.single = () => Promise.resolve(resolve());
    builder.maybeSingle = () => Promise.resolve(resolve());
    builder.then = (
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  };

  // Emulates check_rate_limit per key, enforcing the fresh-call bucket (5).
  const rpc = (name: string, args: { p_key: string; p_max_requests: number }) => {
    if (name !== 'check_rate_limit') {
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    }
    const count = (state.rateLimitCalls[args.p_key] ?? 0) + 1;
    state.rateLimitCalls[args.p_key] = count;
    const allowed = count <= args.p_max_requests;
    return Promise.resolve({
      data: { allowed, remaining: Math.max(args.p_max_requests - count, 0), retry_after_seconds: allowed ? null : 30 },
      error: null,
    });
  };

  return { from, rpc };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FakeOptions {
  /** Hevy workouts in total (10 per page). */
  hevyWorkouts?: number;
  /** Return 429 the first time this Hevy page is requested. */
  hevy429OnPage?: number;
  /** Liftosaur records, served in this order. */
  liftosaur?: Array<{ id: number; text: string }>;
  /** Liftosaur says hasMore but omits nextCursor. */
  liftosaurMissingCursor?: boolean;
  /** Every provider call returns this status/body. */
  failWith?: { status: number; body: string };
}

function installFakeProviders(options: FakeOptions) {
  const originalFetch = globalThis.fetch;
  const fake = {
    hevyPages: [] as number[],
    liftosaurRequests: 0,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
  let served429 = false;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (options.failWith) {
      return Promise.resolve(new Response(options.failWith.body, { status: options.failWith.status }));
    }
    if (url.hostname === 'api.hevyapp.com' && url.pathname === '/v1/workouts') {
      const page = Number(url.searchParams.get('page'));
      if (page === options.hevy429OnPage && !served429) {
        served429 = true;
        return Promise.resolve(json({ error: 'slow down' }, 429));
      }
      fake.hevyPages.push(page);
      const total = options.hevyWorkouts ?? 10;
      const pageCount = Math.max(1, Math.ceil(total / 10));
      const workouts = Array.from(
        { length: Math.max(0, Math.min(10, total - (page - 1) * 10)) },
        (_, i) => ({
          id: `w-${page}-${i}`,
          title: 'Workout',
          start_time: '2026-02-01T10:00:00Z',
          end_time: '2026-02-01T11:00:00Z',
          exercises: [],
        }),
      );
      return Promise.resolve(json({ page, page_count: pageCount, workouts }));
    }
    if (url.hostname === 'www.liftosaur.com' && url.pathname === '/api/v1/history') {
      fake.liftosaurRequests++;
      const all = options.liftosaur ?? [];
      const limit = Number(url.searchParams.get('limit') ?? '200');
      const offset = Number(url.searchParams.get('cursor') ?? '0');
      const hasMore = offset + limit < all.length;
      return Promise.resolve(json({
        data: {
          records: all.slice(offset, offset + limit),
          hasMore,
          nextCursor: hasMore && !options.liftosaurMissingCursor ? offset + limit : null,
        },
      }));
    }
    throw new Error(`Unexpected fetch in test: ${url.href}`);
  }) as typeof fetch;
  return fake;
}

function newHandler(state: DbState, user: { id: string } | null = { id: USER_ID }) {
  return createMobileIntegrationSyncHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user } }) },
    }),
    createAdminClient: () => {
      state.adminClientsCreated++;
      // deno-lint-ignore no-explicit-any
      return createDbDouble(state) as any;
    },
  });
}

async function callOnce(
  state: DbState,
  body: Record<string, unknown>,
  headers: Record<string, string> = { Authorization: 'Bearer user-jwt' },
): Promise<Response> {
  return await newHandler(state)(
    new Request('http://localhost/functions/v1/mobile-integration-sync', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

interface LoopResult {
  responses: Array<{ status: number; body: Record<string, unknown> }>;
  activities: Array<Record<string, unknown>>;
  lastSyncAfterEach: Array<string | null>;
}

/**
 * Mirrors Project-Phoenix-MP IntegrationManager.syncProviderInternal: the
 * apiKey is sent only on the first call, the same action is repeated with the
 * returned cursor while `hasMore && nextCursor`, capped at 50 calls, and any
 * non-2xx or `status: "error"` ends the loop as a failure.
 */
async function runMobileLoop(
  state: DbState,
  provider: 'hevy' | 'liftosaur',
  action: 'sync' | 'connect',
): Promise<LoopResult> {
  const result: LoopResult = { responses: [], activities: [], lastSyncAfterEach: [] };
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const response = await callOnce(state, {
      provider,
      action,
      apiKey: page === 0 && action === 'connect' ? 'provider-key' : null,
      cursor,
    });
    const body = await response.json();
    result.responses.push({ status: response.status, body });
    result.lastSyncAfterEach.push(state.lastSyncAt);
    if (!response.ok || body.status === 'error') break;
    result.activities.push(...(body.activities ?? []));
    if (!body.hasMore || !body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return result;
}

function liftosaurRecords(count: number): Array<{ id: number; text: string }> {
  // Newest first, as the real API returns /history.
  return Array.from({ length: count }, (_, i) => ({
    id: 90000 - i,
    text: `${new Date(Date.UTC(2026, 0, 1) - i * 3_600_000).toISOString()} / program: "P" / dayName: "D"`,
  }));
}

Deno.test('mobile-integration-sync: a 2,500-record Liftosaur connect finishes across 3 paged calls', async () => {
  const state = newState();
  const providers = installFakeProviders({ liftosaur: liftosaurRecords(2500) });
  try {
    const startedAt = Date.now();
    const loop = await runMobileLoop(state, 'liftosaur', 'connect');
    assertEquals(loop.responses.map((r) => r.status), [200, 200, 200]);
    assertEquals(loop.responses.map((r) => r.body.hasMore), [true, true, false]);
    assertEquals(loop.responses.map((r) => r.body.status), ['connected', 'connected', 'connected']);
    // Every record read reaches the phone and the portal.
    assertEquals(loop.activities.length, 2500);
    assertEquals(state.activities.length, 2500);
    // Watermark untouched mid-chain; set to the chain start on the last call.
    assertEquals(loop.lastSyncAfterEach.slice(0, 2), [PREVIOUS_SYNC, PREVIOUS_SYNC]);
    assert(Date.parse(state.lastSyncAt!) >= startedAt - 1000);
    assert(Date.parse(state.lastSyncAt!) <= Date.now());
    assertEquals(state.status, 'connected');
    assertEquals(state.errorMessage, null);
    // Continuations use their own rate-limit bucket.
    assertEquals(state.rateLimitCalls['mobile-integration-sync'], 1);
    assertEquals(state.rateLimitCalls['mobile-integration-sync:page'], 2);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: a 101-page Hevy sync finishes across paged calls', async () => {
  const state = newState();
  const providers = installFakeProviders({ hevyWorkouts: 1010 });
  try {
    const loop = await runMobileLoop(state, 'hevy', 'sync');
    assert(loop.responses.every((r) => r.status === 200));
    assertEquals(loop.responses.length, 26); // 4 pages per call
    assertEquals(loop.activities.length, 1010);
    assertEquals(state.activities.length, 1010);
    assertEquals(new Set(providers.hevyPages).size, 101);
    assertEquals(loop.lastSyncAfterEach.at(-2), PREVIOUS_SYNC);
    assert(state.lastSyncAt !== PREVIOUS_SYNC);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: a Hevy 429 ends the call early with hasMore and the same resume page', async () => {
  const state = newState();
  const providers = installFakeProviders({ hevyWorkouts: 100, hevy429OnPage: 3 });
  try {
    const first = await callOnce(state, { provider: 'hevy', action: 'sync' });
    const body = await first.json();
    assertEquals(first.status, 200, JSON.stringify(body));
    assertEquals(body.activities.length, 20); // pages 1-2 were read and kept
    assertEquals(body.hasMore, true);
    assertEquals(body.partial, true);
    assertEquals(body.errors[0].code, 'provider_rate_limited');
    assertEquals(JSON.parse(body.nextCursor).hevyPage, 3);
    assertEquals(state.lastSyncAt, PREVIOUS_SYNC);

    // Finishing the chain imports everything.
    let cursor = body.nextCursor;
    let hasMore = true;
    for (let i = 0; i < 10 && hasMore; i++) {
      const next = await (await callOnce(state, { provider: 'hevy', action: 'sync', cursor })).json();
      hasMore = next.hasMore;
      cursor = next.nextCursor;
    }
    assertEquals(state.activities.length, 100);
    assert(state.lastSyncAt !== PREVIOUS_SYNC);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: Liftosaur hasMore without a cursor still returns what was read and reports the failure', async () => {
  const state = newState();
  const providers = installFakeProviders({
    liftosaur: liftosaurRecords(400),
    liftosaurMissingCursor: true,
  });
  try {
    const response = await callOnce(state, { provider: 'liftosaur', action: 'sync' });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(providers.liftosaurRequests, 1);
    assertEquals(body.activities.length, 200);
    assertEquals(body.hasMore, false);
    assertEquals(body.partial, true);
    assertEquals(body.errors[0].code, 'history_truncated');
    assertEquals(state.activities.length, 200);
    assertEquals(state.lastSyncAt, PREVIOUS_SYNC);
    assertEquals(state.status, 'error');
    assert(String(state.errorMessage).includes('no cursor'));
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: re-sync of an undated Liftosaur record returns and keeps its stored date, and applies edits', async () => {
  const storedAt = '2020-01-01T00:00:00.000Z';
  const state = newState([{
    user_id: USER_ID,
    provider: 'liftosaur',
    external_id: 'liftosaur-42',
    name: 'old',
    started_at: storedAt,
  }]);
  const providers = installFakeProviders({
    liftosaur: [{ id: 42, text: 'program: "P" / dayName: "Renamed"' }],
  });
  try {
    const response = await callOnce(state, { provider: 'liftosaur', action: 'sync' });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.activities[0].startedAt, storedAt);
    assertEquals(state.activities.length, 1);
    assertEquals(state.activities[0].started_at, storedAt);
    assertEquals(state.activities[0].name, 'P — Renamed');
    assert(state.lastSyncAt !== PREVIOUS_SYNC);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: a new undated Liftosaur record is inserted with a date', async () => {
  const state = newState();
  const providers = installFakeProviders({
    liftosaur: [{ id: 43, text: 'program: "P" / dayName: "No date"' }],
  });
  try {
    const response = await callOnce(state, { provider: 'liftosaur', action: 'sync' });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(state.activities.length, 1);
    assertEquals(typeof state.activities[0].started_at, 'string');
    assertEquals(body.activities[0].startedAt, state.activities[0].started_at);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: a complete single-call Hevy sync advances the watermark', async () => {
  const state = newState();
  const providers = installFakeProviders({ hevyWorkouts: 20 });
  try {
    const response = await callOnce(state, { provider: 'hevy', action: 'sync' });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.status, 'synced');
    assertEquals(body.hasMore, false);
    assertEquals(body.activities.length, 20);
    assert(state.lastSyncAt !== PREVIOUS_SYNC);
    assertEquals(state.errorMessage, null);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: an invalid or foreign cursor is rejected', async () => {
  const state = newState();
  const providers = installFakeProviders({ hevyWorkouts: 20 });
  try {
    for (const cursor of [
      'not-json',
      JSON.stringify({ v: 1, provider: 'liftosaur', liftosaurCursor: 5, chainStartedAt: PREVIOUS_SYNC }),
      JSON.stringify({ v: 1, provider: 'hevy', hevyPage: 0, chainStartedAt: PREVIOUS_SYNC }),
    ]) {
      const response = await callOnce(state, { provider: 'hevy', action: 'sync', cursor });
      assertEquals(response.status, 400, cursor);
      assert((await response.text()).includes('INVALID_CURSOR'));
    }
    assertEquals(providers.hevyPages.length, 0);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: provider error text never reaches the card or the caller', async () => {
  const state = newState();
  const providers = installFakeProviders({
    failWith: { status: 200, body: '<html>proxy error page</html>' },
  });
  try {
    const response = await callOnce(state, { provider: 'hevy', action: 'sync' });
    const text = await response.text();
    assertEquals(response.status, 502, text);
    assert(!text.includes('html'), text);
    assert(text.includes('PROVIDER_FETCH'));
    assert(!String(state.errorMessage).includes('html'));
    assertEquals(state.lastSyncAt, PREVIOUS_SYNC);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: missing Authorization header is 401 before any DB access', async () => {
  const state = newState();
  const response = await callOnce(state, { provider: 'hevy', action: 'sync' }, {});
  assertEquals(response.status, 401);
  assertEquals(state.adminClientsCreated, 0);
});

Deno.test('mobile-integration-sync: a token getUser() rejects is 401 before any DB access', async () => {
  const state = newState();
  const response = await newHandler(state, null)(
    new Request('http://localhost/functions/v1/mobile-integration-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer forged', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'hevy', action: 'sync' }),
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(state.adminClientsCreated, 0);
});
