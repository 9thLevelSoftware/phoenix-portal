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
}

function newState(activities: Array<Record<string, unknown>> = []): DbState {
  return { lastSyncAt: PREVIOUS_SYNC, status: 'connected', errorMessage: null, activities };
}

function createDbDouble(state: DbState) {
  const from = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;

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
      return { data: null, error: null };
    };

    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'in', 'delete']) {
      builder[method] = () => builder;
    }
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
        // ignoreDuplicates = ON CONFLICT DO NOTHING.
        if (index >= 0 && options?.ignoreDuplicates) {
          return Promise.resolve({ data: null, error: null });
        }
        if (index >= 0) state.activities[index] = { ...state.activities[index], ...row };
        else state.activities.push(row);
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

  const rpc = (name: string) =>
    Promise.resolve(
      name === 'check_rate_limit'
        ? { data: { allowed: true, remaining: 4, retry_after_seconds: null }, error: null }
        : { data: null, error: { message: `unexpected rpc ${name}` } },
    );

  return { from, rpc };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Fake providers: Hevy with `hevyPageCount` pages, Liftosaur serving `liftosaur`. */
function installFakeProviders(options: {
  hevyPageCount?: number;
  liftosaur?: Array<{ id: number; text: string }>;
}) {
  const originalFetch = globalThis.fetch;
  const fake = {
    hevyRequests: 0,
    liftosaurRequests: 0,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname === 'api.hevyapp.com' && url.pathname === '/v1/workouts') {
      fake.hevyRequests++;
      const page = Number(url.searchParams.get('page'));
      const workouts = Array.from({ length: 10 }, (_, i) => ({
        id: `w-${page}-${i}`,
        title: 'Workout',
        start_time: '2026-02-01T10:00:00Z',
        end_time: '2026-02-01T11:00:00Z',
        exercises: [],
      }));
      return Promise.resolve(json({ page, page_count: options.hevyPageCount ?? 1, workouts }));
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
          nextCursor: hasMore ? offset + limit : null,
        },
      }));
    }
    throw new Error(`Unexpected fetch in test: ${url.href}`);
  }) as typeof fetch;
  return fake;
}

async function runAction(
  state: DbState,
  provider: 'hevy' | 'liftosaur',
  action: 'sync' | 'connect' = 'sync',
): Promise<Response> {
  const db = createDbDouble(state);
  const handler = createMobileIntegrationSyncHandler({
    createAuthClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    }),
    // deno-lint-ignore no-explicit-any
    createAdminClient: () => db as any,
  });
  return await handler(
    new Request('http://localhost/functions/v1/mobile-integration-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, action, apiKey: action === 'connect' ? 'provider-key' : undefined }),
    }),
  );
}

Deno.test('mobile-integration-sync: truncated Hevy backfill is an error and keeps the watermark', async () => {
  const state = newState();
  // One page more than the per-run ceiling (HEVY_MAX_PAGES = 100).
  const providers = installFakeProviders({ hevyPageCount: 101 });
  try {
    const response = await runAction(state, 'hevy');
    const body = await response.json();
    assertEquals(response.status, 502, JSON.stringify(body));
    assertEquals(body.status, 'error');
    assertEquals(body.truncated, true);
    assertEquals(providers.hevyRequests, 100);
    assertEquals(state.activities.length, 1000); // what was read is stored
    assertEquals(state.lastSyncAt, PREVIOUS_SYNC);
    assertEquals(state.status, 'error');
    assert(String(state.errorMessage).includes('100-page budget'));
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: 11 Liftosaur pages is an error and keeps the watermark', async () => {
  const state = newState();
  const records = Array.from({ length: 2200 }, (_, i) => ({
    id: 5000 + i,
    text: `${new Date(Date.UTC(2020, 0, 1) + i * 3_600_000).toISOString()} / program: "P" / dayName: "D"`,
  }));
  const providers = installFakeProviders({ liftosaur: records });
  try {
    const response = await runAction(state, 'liftosaur', 'connect');
    const body = await response.json();
    assertEquals(response.status, 502, JSON.stringify(body));
    assertEquals(body.truncated, true);
    assertEquals(providers.liftosaurRequests, 10);
    assertEquals(state.activities.length, 2000);
    assertEquals(state.lastSyncAt, PREVIOUS_SYNC);
    assertEquals(state.status, 'error');
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: re-sync of an undated Liftosaur record keeps its stored date', async () => {
  const storedAt = '2020-01-01T00:00:00.000Z';
  const state = newState([{
    user_id: USER_ID,
    provider: 'liftosaur',
    external_id: 'liftosaur-42',
    name: 'old',
    started_at: storedAt,
  }]);
  const providers = installFakeProviders({
    liftosaur: [{ id: 42, text: 'program: "P" / dayName: "No date"' }],
  });
  try {
    const response = await runAction(state, 'liftosaur');
    assertEquals(response.status, 200, await response.clone().text());
    assertEquals(state.activities.length, 1);
    assertEquals(state.activities[0].started_at, storedAt);
    assert(state.lastSyncAt !== PREVIOUS_SYNC);
  } finally {
    providers.restore();
  }
});

Deno.test('mobile-integration-sync: complete Hevy sync advances the watermark', async () => {
  const state = newState();
  const providers = installFakeProviders({ hevyPageCount: 2 });
  try {
    const response = await runAction(state, 'hevy');
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.status, 'synced');
    assertEquals(body.activities.length, 20);
    assert(state.lastSyncAt !== PREVIOUS_SYNC);
    assertEquals(state.errorMessage, null);
  } finally {
    providers.restore();
  }
});
