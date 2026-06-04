/**
 * Pull Endpoint Pagination Tests
 *
 * Validates mobile-sync-pull's cursor-based pagination:
 *   - Default page size and hasMore signal
 *   - Multi-page traversal across >500 entities (regression for commit
 *     a3a2aa1 which tightened the parity-based pull path)
 *   - Composite cursor stability when multiple rows share updated_at
 *   - Empty delta behavior (lastSync at/after latest push)
 *   - Large knownEntityIds list (>MAX_PARITY_IDS = 10_000) rejection semantics
 *   - Entity order enforcement: sessions → routines → cycles → badges → stats
 *
 * Contract reference:
 *   - supabase/functions/mobile-sync-pull/index.ts
 *   - DEFAULT_PAGE_SIZE = 75
 *   - MAX_PAGE_SIZE = 300
 *   - MAX_PARITY_IDS = 10_000
 *
 * CRITICAL: The mock harness (tests/sync/helpers/mock-edge-functions.ts)
 * returns every stored entity on each pull — it does not implement
 * cursor/pageSize semantics. Tests that require true pagination behaviour
 * are marked with `liveIt` or `test.skip` with a clear pointer to the live Edge Function
 * and a description of how to exercise them via `npm run test:sync:live`.
 * Tests that can be validated via interface assertions (response shape,
 * empty-delta semantics, entity order) run as normal Vitest tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callPushEndpoint,
  callPullEndpoint,
  createTestUser,
  createMinimalPushPayload,
  createTestSession,
  type SessionDto,
  type TestUser,
} from './helpers/edge-function-harness';
import { resetMockStore } from './helpers/mock-edge-functions';
import { liveIt } from './setup';

vi.setConfig({ testTimeout: 30000 });

// Contract constants (keep aligned with mobile-sync-pull/index.ts)
const DEFAULT_PAGE_SIZE = 75;
const MAX_PARITY_IDS = 10_000;

function seedSessions(userId: string, count: number): SessionDto[] {
  return Array.from({ length: count }, (_, i) =>
    createTestSession(userId, {
      id: crypto.randomUUID(),
      name: `Session ${i}`,
      startedAt: new Date(Date.parse('2026-04-01T00:00:00Z') + i * 1000).toISOString(),
      exercises: [],
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mobile-sync-pull pagination', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    resetMockStore();
    testUser = await createTestUser();
  });

  describe('Default page size', () => {
    liveIt(
      'returns hasMore=true with nextCursor when >DEFAULT_PAGE_SIZE sessions match — requires live Edge Function',
      async () => {
        // The mock does not honour `pageSize` or emit `nextCursor`. Real
        // Edge Function at mobile-sync-pull/index.ts line 378 fetches
        // pageSize+1 rows, trims to pageSize, and emits nextCursor when the
        // +1 row is present.
        //
        // Seed DEFAULT_PAGE_SIZE+1 sessions, pull with no cursor, expect:
        //   - data.sessions.length === DEFAULT_PAGE_SIZE
        //   - data.hasMore === true
        //   - data.nextCursor is a non-empty base64 string
        const count = DEFAULT_PAGE_SIZE + 1;
        const sessions = seedSessions(testUser.id, count);
        await callPushEndpoint(
          createMinimalPushPayload(testUser.id, { sessions }),
          testUser.accessToken,
        );
        const page1 = await callPullEndpoint(0, testUser.accessToken);
        expect(page1.success).toBe(true);
        expect(page1.data!.sessions.length).toBe(DEFAULT_PAGE_SIZE);
        expect(page1.data!.hasMore).toBe(true);
        expect(typeof page1.data!.nextCursor).toBe('string');
      },
    );

    it('returns all entities in a single page when count ≤ page size', async () => {
      // Positive control that works in mock mode: small payload, single pull.
      const sessions = seedSessions(testUser.id, 10);
      await callPushEndpoint(
        createMinimalPushPayload(testUser.id, { sessions }),
        testUser.accessToken,
      );
      const result = await callPullEndpoint(0, testUser.accessToken);
      expect(result.success).toBe(true);
      expect(result.data!.sessions.length).toBe(10);
    });
  });

  describe('Multi-page traversal (>500 entities)', () => {
    liveIt(
      'union of all pages equals the full set with no duplicates — requires live Edge Function',
      async () => {
        // Regression marker for commit a3a2aa1 which hardened the
        // parity-based pull path. Real behaviour: seed ≥501 sessions,
        // loop pulling with cursor until hasMore === false, union the
        // session IDs, assert size === 501 and no duplicate IDs.
        const count = 501;
        const sessions = seedSessions(testUser.id, count);
        await callPushEndpoint(
          createMinimalPushPayload(testUser.id, { sessions }),
          testUser.accessToken,
        );

        const collected = new Set<string>();
        let cursor: string | undefined;
        let safety = 0;
        do {
          const result = await callPullEndpoint(0, testUser.accessToken, {
            cursor,
          });
          expect(result.success).toBe(true);
          for (const s of result.data!.sessions) collected.add(s.id);
          cursor = result.data!.hasMore ? result.data!.nextCursor : undefined;
          safety++;
        } while (cursor && safety < 20);

        expect(collected.size).toBe(count);
      },
    );
  });

  describe('Composite cursor stability', () => {
    it.skip(
      'entities with identical updated_at but different id are each returned exactly once when paginated one-at-a-time — requires live Edge Function',
      async () => {
        // Real pull builds a PostgREST `.or()` filter:
        //   updated_at.gt.{cursor}
        //   OR (updated_at.eq.{cursor} AND id.gt.{cursorId})
        // (see mobile-sync-pull/index.ts line 408).
        // This test confirms the compound predicate does not duplicate or
        // skip rows when the timestamp collision is non-trivial.
        //
        // Seed 3 sessions with identical started_at/updated_at, varying IDs
        // (sorted ASC). Pull with pageSize=1. Accumulate IDs across 3 pulls.
        // Expect all 3 unique IDs, each returned exactly once, in id-ASC
        // order (stable secondary sort).
      },
    );
  });

  describe('Empty delta (lastSync at or after latest push)', () => {
    it('returns empty arrays and hasMore=false when nothing has changed since lastSync', async () => {
      // Mock does honour the "lastPushTime > lastSync" short-circuit at
      // mock-edge-functions.ts lines 204-230, so an in-the-future timestamp
      // returns empty arrays. This matches the real Edge Function's
      // semantics at mobile-sync-pull/index.ts where cursor filters produce
      // zero rows.
      const future = Date.now() + 60_000; // 1 minute ahead
      const result = await callPullEndpoint(future, testUser.accessToken);
      expect(result.success).toBe(true);
      expect(result.data!.sessions).toEqual([]);
      expect(result.data!.routines).toEqual([]);
      expect(result.data!.cycles).toEqual([]);
      expect(result.data!.badges).toEqual([]);
      // Stats/RPG are singletons — null when unchanged
      expect(result.data!.rpgAttributes).toBeNull();
      expect(result.data!.gamificationStats).toBeNull();
    });

    it(
      'asserts hasMore=false and nextCursor is absent/undefined in empty-delta pull',
      async () => {
        const future = Date.now() + 60_000;
        const result = await callPullEndpoint(future, testUser.accessToken);
        expect(result.data!.hasMore).toBe(false);
        expect(result.data!.nextCursor).toBeUndefined();
      },
    );
  });

  describe('Large knownEntityIds list (>MAX_PARITY_IDS = 10_000)', () => {
    liveIt(
      'rejects entity ID lists exceeding MAX_PARITY_IDS with 413 — requires live Edge Function',
      async () => {
        const knownIds = Array.from({ length: MAX_PARITY_IDS + 1 }, () =>
          crypto.randomUUID(),
        );
        const result = await callPullEndpoint(0, testUser.accessToken, {
          knownEntityIds: { sessionIds: knownIds },
        });
        expect(result.success).toBe(false);
        expect(result.status).toBe(413);
        expect(result.error?.message).toMatch(/maximum is 10000/i);
      },
    );
  });

  describe('Entity order enforcement', () => {
    it('pull response contains entity-bucket keys in the documented order', async () => {
      // Validates the shape, not the page traversal. Per
      // mobile-sync-pull/index.ts line 169, entities are paged in order:
      //   sessions → routines → cycles → badges → stats → customExercises
      // The response object itself carries buckets for each and two
      // singletons (rpgAttributes, gamificationStats). Mock returns the
      // same structure.
      const result = await callPullEndpoint(0, testUser.accessToken);
      expect(result.success).toBe(true);
      const keys = Object.keys(result.data!);

      // Required top-level buckets, in the documented pagination order
      const requiredInOrder = [
        'sessions',
        'routines',
        'cycles',
        'badges',
        // 'stats' is expressed via two singleton fields below
      ];
      const positions = requiredInOrder.map((k) => keys.indexOf(k));
      for (const p of positions) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
      // Monotonically increasing positions → keys appear in the right order
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }

      // Singleton stats keys exist (values may be null when unchanged)
      expect(keys).toContain('rpgAttributes');
      expect(keys).toContain('gamificationStats');
      expect(keys).toContain('customExercises');
    });
  });
});
