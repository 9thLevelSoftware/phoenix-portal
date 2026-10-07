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

		it("mock server-error mode returns status 500 (transient wire signal)", async () => {
			setMockErrorMode("server");
			const push = await callPushEndpoint(
				createMinimalPushPayload(testUser.id),
				testUser.accessToken,
			);
			expect(push.success).toBe(false);
			expect(push.status).toBe(500);
			expect(push.error?.code).toBe("SERVER_ERROR");

			const pull = await callPullEndpoint(0, testUser.accessToken);
			expect(pull.success).toBe(false);
			expect(pull.status).toBe(500);
			expect(pull.error?.code).toBe("SERVER_ERROR");
		});
	});

	describe("PERMANENT (4xx validation)", () => {
		it("invalid payload (missing deviceId) returns 400 (permanent signal)", async () => {
			const payload = createMinimalPushPayload(testUser.id, { deviceId: "" });
			const result = await callPushEndpoint(payload, testUser.accessToken);
			expect(result.status).toBe(400);
			expect(result.error?.code).toBe("VALIDATION_ERROR");
		});

		it("blank platform is accepted and normalized to unknown", async () => {
			for (const platform of ["", "   "]) {
				const payload = createMinimalPushPayload(testUser.id, { platform });
				const result = await callPushEndpoint(payload, testUser.accessToken);
				expect(result.success).toBe(true);
				expect(result.status).toBe(200);
				expect(payload.platform).toBe("unknown");
			}
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

		it("mock auth-error mode returns 401 with a bearer token present", async () => {
			setMockErrorMode("auth");
			const push = await callPushEndpoint(
				createMinimalPushPayload(testUser.id),
				testUser.accessToken,
			);
			expect(push.success).toBe(false);
			expect(push.status).toBe(401);
			expect(push.error?.code).toBe("UNAUTHORIZED");
			expect(push.error?.message).toBe("Invalid token");

			const pull = await callPullEndpoint(0, testUser.accessToken);
			expect(pull.success).toBe(false);
			expect(pull.status).toBe(401);
			expect(pull.error?.code).toBe("UNAUTHORIZED");
			expect(pull.error?.message).toBe("Invalid token");
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

		it("mock network-error mode exposes NETWORK_ERROR code on affected paths", async () => {
			setMockErrorMode("network");
			const push = await callPushEndpoint(
				createMinimalPushPayload(testUser.id),
				testUser.accessToken,
			);
			expect(push.success).toBe(false);
			expect(push.status).toBe(0);
			expect(push.error?.code).toBe("NETWORK_ERROR");

			const pull = await callPullEndpoint(0, testUser.accessToken);
			expect(pull.success).toBe(false);
			expect(pull.status).toBe(0);
			expect(pull.error?.code).toBe("NETWORK_ERROR");
		});
	});
});
