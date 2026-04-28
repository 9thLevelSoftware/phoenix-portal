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

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	callPullEndpoint,
	callPushEndpoint,
	createMinimalPushPayload,
	createTestUser,
	type TestUser,
} from "./helpers/edge-function-harness";
import {
	resetMockStore,
	setMockErrorMode,
} from "./helpers/mock-edge-functions";

vi.setConfig({ testTimeout: 30000 });

describe("Sync wire-level error class signals", () => {
	let testUser: TestUser;

	beforeEach(async () => {
		resetMockStore();
		setMockErrorMode("none");
		testUser = await createTestUser();
	});

	describe("TRANSIENT (5xx)", () => {
		it.skip("5xx from server surfaces as transient error with retry guidance — depends on live fault injection", async () => {
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
		});

		it("mock server-error mode is currently a no-op for push", async () => {
			setMockErrorMode("server");
			// The mock's `checkMockError` returns a 500 at every call (see
			// mock-edge-functions.ts lines 364-372). Even though the default
			// mockPushEndpoint path doesn't invoke checkMockError, we can still
			// assert the flag round-trips via a pull to exercise shape.
			//
			// NOTE: setMockErrorMode only affects functions that call
			// checkMockError. Neither mockPushEndpoint nor mockPullEndpoint
			// invoke it directly today — this is an observable gap. Flag for
			// follow-up so the mock stays useful for classifier testing.
			//
			// Regression marker until the mock wires in checkMockError at the
			// top of push/pull: expect a successful call (current behavior),
			// not the injected 500. When the wiring lands, flip these
			// expectations.
			const result = await callPushEndpoint(
				createMinimalPushPayload(testUser.id),
				testUser.accessToken,
			);
			// Current mock behavior: succeeds despite setMockErrorMode('server')
			// TODO(mock): wire checkMockError into mockPushEndpoint, then flip
			// this to expect result.status === 500.
			expect(result.status).toBe(200);
		});
	});

	describe("PERMANENT (4xx validation)", () => {
		it("invalid payload (missing deviceId) returns 400 (permanent signal)", async () => {
			const payload = createMinimalPushPayload(testUser.id, { deviceId: "" });
			const result = await callPushEndpoint(payload, testUser.accessToken);
			expect(result.status).toBe(400);
			expect(result.error?.code).toBe("VALIDATION_ERROR");
		});

		it("invalid payload (missing platform) returns 400 (permanent signal)", async () => {
			const payload = createMinimalPushPayload(testUser.id, { platform: "" });
			const result = await callPushEndpoint(payload, testUser.accessToken);
			expect(result.status).toBe(400);
			expect(result.error?.code).toBe("VALIDATION_ERROR");
		});
	});

	describe("AUTH (401)", () => {
		it("missing Authorization on push returns 401 (AUTH signal)", async () => {
			const result = await callPushEndpoint(
				createMinimalPushPayload(testUser.id),
				"",
			);
			expect(result.status).toBe(401);
			expect(result.error?.code).toBe("UNAUTHORIZED");
		});

		it("missing Authorization on pull returns 401 (AUTH signal)", async () => {
			const result = await callPullEndpoint(0, "");
			expect(result.status).toBe(401);
			expect(result.error?.code).toBe("UNAUTHORIZED");
		});
	});

	describe("NETWORK (fetch throw / abort)", () => {
		it.skip("fetch abort surfaces as NETWORK class — mobile-only concern", async () => {
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
		});

		it("mock network-error mode setter is currently a no-op for push/pull", async () => {
			// Mirrors the TRANSIENT mock-wiring gap above. setMockErrorMode is
			// honoured only by functions that call checkMockError. We assert the
			// setter doesn't throw and document the gap so classifier-dependent
			// tests don't silently pass.
			setMockErrorMode("network");
			expect(() => setMockErrorMode("network")).not.toThrow();
			setMockErrorMode("none");
		});
	});
});
