/**
 * Server-Side Invariant Validation Tests
 *
 * Covers invariants the push/pull Edge Functions enforce but the sync test
 * suite previously left untested:
 *   - Payload > 10 MB → 413
 *   - sessions.length > 10_000 → 400
 *   - telemetry.length > 50_000 → 400 (raised from 10_000; see issue #381)
 *   - routines.length > 10_000 → 400
 *   - cycles.length > 10_000 → 400 (aligned with other entities; audit #6)
 *   - Rate limit: 11th request inside the 60s window returns 429
 *   - Subscription gating: non-EMBER tier → 402/403 on push (and pull)
 *   - Missing Authorization header → 401
 *   - Expired / invalid JWT → 401 with AUTH signal
 *
 * Source of truth (Edge Functions):
 *   - supabase/functions/mobile-sync-push/index.ts (lines 477-534 for size
 *     and array caps, 460-472 for rate limit & subscription gate, 422-447
 *     for auth).
 *   - supabase/functions/mobile-sync-pull/index.ts mirrors the auth +
 *     subscription gate but allows 20 req/min.
 *
 * Several tests run against the mock Edge Function harness because the mock
 * already intercepts auth/validation at the same boundaries (see
 * `tests/sync/helpers/mock-edge-functions.ts`). Tests that require live
 * Supabase semantics (rate limit, subscription lookup) are marked
 * `test.skip` with a clear comment pointing at the real Edge Function —
 * we do not synthesize passing assertions against behaviour the mock does
 * not implement.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callPushEndpoint,
  callPullEndpoint,
  createTestUser,
  createMinimalPushPayload,
  createTestSession,
  generateTestId,
  type SessionDto,
  type RoutineDto,
  type CycleDto,
  type RepTelemetryDto,
  type TestUser,
} from './helpers/edge-function-harness';
import { resetMockStore } from './helpers/mock-edge-functions';

vi.setConfig({ testTimeout: 30000 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build N minimal sessions for a given user. Deliberately lightweight —
 * array-cap tests only need IDs and shape, not rep-level telemetry.
 */
function buildSessions(userId: string, count: number): SessionDto[] {
  return Array.from({ length: count }, () =>
    createTestSession(userId, { exercises: [] }),
  );
}

/** Build N minimal routines referencing the given user. */
function buildRoutines(userId: string, count: number): RoutineDto[] {
  return Array.from({ length: count }, (_, i) => ({
    id: generateTestId(),
    userId,
    name: `Routine ${i}`,
    description: null,
    exerciseCount: 0,
    estimatedDuration: 30,
    timesCompleted: 0,
    isFavorite: false,
    exercises: [],
  }));
}

/**
 * Build N minimal telemetry points all pointing at a single fake set ID.
 * Shape matches RepTelemetryDto; values are irrelevant for cap-guard tests.
 */
function buildTelemetry(count: number): RepTelemetryDto[] {
  const setId = generateTestId();
  return Array.from({ length: count }, (_, i) => ({
    id: generateTestId(),
    setId,
    timestampMs: i,
    forceN: 0,
    velocityMps: 0,
    positionMm: 0,
    cable: 'A',
  }));
}

/** Build N minimal cycles. */
function buildCycles(userId: string, count: number): CycleDto[] {
  return Array.from({ length: count }, (_, i) => ({
    id: generateTestId(),
    userId,
    name: `Cycle ${i}`,
    description: null,
    durationWeeks: 4,
    workoutDays: 4,
    restDays: 3,
    currentWeek: 1,
    status: 'active',
    startedAt: new Date().toISOString(),
    lastUsedAt: null,
    progressionSettings: null,
    deloadSettings: null,
    days: [],
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Server-Side Validation Invariants', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    resetMockStore();
    testUser = await createTestUser();
  });

  describe('Payload size (>10 MB)', () => {
    it.skip(
      'rejects payloads > 10 MB with 413 — requires live Edge Function',
      async () => {
        // The real Edge Function reads Content-Length and short-circuits at
        // 10 MB (mobile-sync-push/index.ts lines 477-484). The mock harness
        // does not inspect Content-Length because the test harness serializes
        // the payload to in-memory JSON before dispatch. Flag as a regression
        // marker for when live mode is enabled.
        //
        // To execute: set MOCK_EDGE_FUNCTIONS=false and craft a payload that
        // serializes >10MB (e.g., 100k telemetry rows w/ notes padding).
        //
        // Expected: status === 413 with message matching /Payload too large/i.
        const big = 'x'.repeat(11 * 1024 * 1024); // ~11MB string
        const session = createTestSession(testUser.id, { notes: big });
        const payload = createMinimalPushPayload(testUser.id, {
          sessions: [session],
        });
        const result = await callPushEndpoint(payload, testUser.accessToken);
        expect(result.status).toBe(413);
      },
    );
  });

  describe('Array size caps', () => {
    it.skip(
      'rejects sessions.length > 10_000 with 400 — requires live Edge Function',
      async () => {
        // Enforced in mobile-sync-push/index.ts lines 510-516. Mock does
        // not reproduce this validation because it would allocate 10k+
        // dummy sessions on every suite run. Run against live Supabase by
        // pushing createMinimalPushPayload with 10_001 sessions; expect
        // status 400 and message matching /Too many sessions/.
        const sessions = buildSessions(testUser.id, 10_001);
        const payload = createMinimalPushPayload(testUser.id, { sessions });
        const result = await callPushEndpoint(payload, testUser.accessToken);
        expect(result.status).toBe(400);
        expect(result.error?.message).toMatch(/Too many sessions/i);
      },
    );

    it.skip(
      'rejects telemetry.length > 50_000 with 400 — requires live Edge Function',
      async () => {
        // Enforced in mobile-sync-push/index.ts against MAX_TELEMETRY_POINTS.
        // Cap raised from 10_000 to 50_000 to give server-side headroom for
        // dense BLE sample-rate sessions; see issue #381.
        const telemetry = buildTelemetry(50_001);
        const payload = createMinimalPushPayload(testUser.id, { telemetry });
        const result = await callPushEndpoint(payload, testUser.accessToken);
        expect(result.status).toBe(400);
        expect(result.error?.message).toMatch(/Too many telemetry/i);
        expect(result.error?.message).toMatch(/50000/);
      },
    );

    it.skip(
      'rejects routines.length > 10_000 with 400 — requires live Edge Function',
      async () => {
        // Enforced in mobile-sync-push/index.ts against MAX_ENTITIES_PER_TYPE.
        const routines = buildRoutines(testUser.id, 10_001);
        const payload = createMinimalPushPayload(testUser.id, { routines });
        const result = await callPushEndpoint(payload, testUser.accessToken);
        expect(result.status).toBe(400);
        expect(result.error?.message).toMatch(/Too many routines/i);
      },
    );

    it.skip(
      'rejects cycles.length > 10_000 with 400 — requires live Edge Function',
      async () => {
        // Enforced in mobile-sync-push/index.ts against MAX_ENTITIES_PER_TYPE.
        // Was 1_000 historically; audit #6 aligned it with the other entity
        // caps so large cycle histories no longer silently fail.
        const cycles = buildCycles(testUser.id, 10_001);
        const payload = createMinimalPushPayload(testUser.id, { cycles });
        const result = await callPushEndpoint(payload, testUser.accessToken);
        expect(result.status).toBe(400);
        expect(result.error?.message).toMatch(/Too many cycles/i);
        expect(result.error?.message).toMatch(/10000/);
      },
    );

    it('accepts sessions.length of 100 (well under cap)', async () => {
      // Positive control — verify harness/mock accepts reasonable volumes
      // so the skipped limit assertions above remain the only suspicious case.
      const sessions = buildSessions(testUser.id, 100);
      const payload = createMinimalPushPayload(testUser.id, { sessions });
      const result = await callPushEndpoint(payload, testUser.accessToken);
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    });

    it('accepts telemetry.length of 10_000 (was previous cap, well under new cap)', async () => {
      // Regression guard: locks in that the old 10k ceiling is no longer
      // rejected. Mock harness does not enforce the server's cap check so
      // this runs under MOCK_EDGE_FUNCTIONS=true and continues to pass once
      // the live Edge Function is deployed with the raised cap.
      const telemetry = buildTelemetry(10_000);
      const payload = createMinimalPushPayload(testUser.id, { telemetry });
      const result = await callPushEndpoint(payload, testUser.accessToken);
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    });
  });

  describe('Rate limit (10 req/min per user on push, 11th → 429)', () => {
    it.skip(
      'returns 429 with Retry-After header on 11th push inside 60s — requires live rate limiter',
      async () => {
        // The real limiter lives in supabase/functions/_shared/rateLimit.ts
        // and is keyed by (user_id, endpoint). It relies on the database
        // (or a redis-style backend) that the mock harness does not emulate.
        //
        // To exercise against live Supabase:
        //   1. Push 10 minimal payloads as the same user within <60s
        //   2. Assert all 10 return 200
        //   3. Push an 11th; assert status === 429 and response headers
        //      contain a 'Retry-After' entry with a numeric seconds value.
        const results = [] as Array<Awaited<ReturnType<typeof callPushEndpoint>>>;
        for (let i = 0; i < 10; i++) {
          results.push(
            await callPushEndpoint(
              createMinimalPushPayload(testUser.id),
              testUser.accessToken,
            ),
          );
        }
        for (const r of results) {
          expect(r.status).toBe(200);
        }
        const eleventh = await callPushEndpoint(
          createMinimalPushPayload(testUser.id),
          testUser.accessToken,
        );
        expect(eleventh.status).toBe(429);
        expect(eleventh.error?.code).toBe('RATE_LIMITED');
      },
    );
  });

  describe('Subscription tier gating (EMBER or higher on push)', () => {
    it.skip(
      'rejects FREE tier user with 402/403 on push — requires live subscription lookup',
      async () => {
        // Gate implementation: supabase/functions/_shared/requireSubscription.ts
        // and wired in mobile-sync-push/index.ts lines 471-472.
        // Mock harness does not inspect subscription tier.
        //
        // To exercise: seed a `subscriptions` row with tier='FREE' for the
        // test user (or leave the row absent — the gate's default behaviour)
        // then expect status to be 402 or 403. Audit 01 pins this to 'EMBER+'.
        const result = await callPushEndpoint(
          createMinimalPushPayload(testUser.id),
          testUser.accessToken,
        );
        expect([402, 403]).toContain(result.status);
      },
    );

    it.skip(
      'rejects FREE tier user with 402/403 on pull — requires live subscription lookup',
      async () => {
        // mobile-sync-pull/index.ts enforces the same gate with a 20 req/min
        // limit. Document: per audit 01, FREE users should be rejected
        // consistently across both endpoints.
        const result = await callPullEndpoint(0, testUser.accessToken);
        expect([402, 403]).toContain(result.status);
      },
    );
  });

  describe('Authentication', () => {
    it('rejects push with missing Authorization header (status 401)', async () => {
      const payload = createMinimalPushPayload(testUser.id);
      // Pass empty string — the harness treats this as "no token attached"
      const result = await callPushEndpoint(payload, '');
      expect(result.status).toBe(401);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects pull with missing Authorization header (status 401)', async () => {
      const result = await callPullEndpoint(0, '');
      expect(result.status).toBe(401);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it.skip(
      'rejects expired JWT with 401 and AUTH error signal — requires live Supabase auth',
      async () => {
        // Mock mode returns UNAUTHORIZED for any empty token, but does not
        // validate JWT signatures. A truly expired token (exp < now) hits
        // supabaseAuth.auth.getUser() and returns { user: null } which
        // short-circuits to 401 (mobile-sync-push/index.ts lines 436-445).
        //
        // To exercise: forge a Supabase JWT with `exp: Math.floor(Date.now()
        // / 1000) - 60` using the local JWT secret, then submit it.
        const expiredToken =
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid';
        const result = await callPushEndpoint(
          createMinimalPushPayload(testUser.id),
          expiredToken,
        );
        expect(result.status).toBe(401);
        // Mobile's error classifier treats 401 as AUTH; see Kotlin
        // SyncErrorClassifier in shared/src/commonMain.
      },
    );
  });
});
