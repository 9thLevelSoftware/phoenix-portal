/**
 * Sync Error Classification Tests (Portal-observable surface)
 *
 * The mobile app classifies sync errors into four buckets:
 *   - TRANSIENT (5xx, rate-limit backoff)
 *   - PERMANENT (4xx validation, not-found)
 *   - AUTH     (401 — token expired / invalid)
 *   - NETWORK  (fetch throw / abort / timeout)
 *
 * Portal-side tests assert the Edge Function returns the HTTP signals that
 * the mobile classifier keys off. The classifier itself lives in Kotlin
 * (`shared/src/commonMain/kotlin/.../sync/SyncErrorClassifier.kt`) and is
 * covered by commonTest. Here we verify the WIRE contract only.
 *
 * Where behaviour depends on a live rate-limiter or injected server fault,
 * the test is marked `test.skip` with a clear pointer to the Kotlin test
 * and the live-mode trigger.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callPushEndpoint,
  callPullEndpoint,
  createTestUser,
  createMinimalPushPayload,
  type TestUser,
} from './helpers/edge-function-harness';
import {
  resetMockStore,
  setMockErrorMode,
} from './helpers/mock-edge-functions';

vi.setConfig({ testTimeout: 30000 });

describe('Sync wire-level error class signals', () => {
  let testUser: TestUser;

  beforeEach(async () => {
    resetMockStore();
    setMockErrorMode('none');
    testUser = await createTestUser();
  });

  describe('TRANSIENT (5xx)', () => {
    it.skip(
      '5xx from server surfaces as transient error with retry guidance — depends on live fault injection',
      async () => {
        // The Edge Function surfaces transient DB failures as 500 with a
        // generic message (mobile-sync-push/index.ts lines 1495-1504).
        // Mobile's Kotlin classifier maps 500/502/503 to TRANSIENT and
        // backs off per the policy defined in CLAUDE.md:
        //   5 → 15 → 30 → 60 minutes for transient errors.
        //
        // Live-mode trigger: tear down the DB or rename a target table.
        // Kotlin-side proof: see SyncErrorClassifierTest in mobile
        // commonTest (covered by the audit 05 '799 mobile commonTest' bucket).
        //
        // Leaving this as a wire-contract reminder.
      },
    );

    it('mock server-error mode returns status 500 (transient wire signal)', async () => {
      setMockErrorMode('server');
      // `checkMockError` is wired into the top of both mockPushEndpoint and
      // mockPullEndpoint (see mock-edge-functions.ts), so setMockErrorMode
      // now surfaces the injected 500 the mobile classifier maps to TRANSIENT.
      const result = await callPushEndpoint(
        createMinimalPushPayload(testUser.id),
        testUser.accessToken,
      );
      expect(result.status).toBe(500);
      expect(result.error?.code).toBe('SERVER_ERROR');
    });
  });

  describe('PERMANENT (4xx validation)', () => {
    it('invalid payload (missing deviceId) returns 400 (permanent signal)', async () => {
      const payload = createMinimalPushPayload(testUser.id, { deviceId: '' });
      const result = await callPushEndpoint(payload, testUser.accessToken);
      expect(result.status).toBe(400);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('invalid payload (missing platform) returns 400 (permanent signal)', async () => {
      const payload = createMinimalPushPayload(testUser.id, { platform: '' });
      const result = await callPushEndpoint(payload, testUser.accessToken);
      expect(result.status).toBe(400);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AUTH (401)', () => {
    it('missing Authorization on push returns 401 (AUTH signal)', async () => {
      const result = await callPushEndpoint(
        createMinimalPushPayload(testUser.id),
        '',
      );
      expect(result.status).toBe(401);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('missing Authorization on pull returns 401 (AUTH signal)', async () => {
      const result = await callPullEndpoint(0, '');
      expect(result.status).toBe(401);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });
  });

  describe('NETWORK (fetch throw / abort)', () => {
    it.skip(
      'fetch abort surfaces as NETWORK class — mobile-only concern',
      async () => {
        // The harness wraps fetch in try/catch and returns a
        // { status: 0, code: 'NETWORK_ERROR' } result when fetch throws
        // (edge-function-harness.ts lines 608-618). This is the exact
        // signal mobile's classifier reads as NETWORK.
        //
        // In mock mode, the callPushEndpoint path never invokes fetch
        // (it hits the mock directly), so the NETWORK signal is not
        // reachable here. Kotlin-side proof: see SyncErrorClassifierTest.
        //
        // Live-mode trigger: firewall the Supabase URL while the test runs.
      },
    );

    it('mock network-error mode exposes NETWORK_ERROR code on affected paths', async () => {
      // `checkMockError` is wired into push and pull, so network mode now
      // surfaces the status 0 / NETWORK_ERROR signal the mobile classifier
      // reads as NETWORK.
      setMockErrorMode('network');
      const pushResult = await callPushEndpoint(
        createMinimalPushPayload(testUser.id),
        testUser.accessToken,
      );
      expect(pushResult.status).toBe(0);
      expect(pushResult.error?.code).toBe('NETWORK_ERROR');

      const pullResult = await callPullEndpoint(0, testUser.accessToken);
      expect(pullResult.status).toBe(0);
      expect(pullResult.error?.code).toBe('NETWORK_ERROR');

      setMockErrorMode('none');
    });
  });
});
