/**
 * Supabase Broadcast Tests (mobile-sync-push → portal)
 *
 * Covers the realtime bridge that ties a successful push to the portal's
 * query cache invalidation in `useRealtimeSync`. The push Edge Function
 * wraps its broadcast in a try/catch so that any error is logged and
 * swallowed — the push still returns 200 regardless of broadcast failure.
 *
 * Invariants asserted:
 *   1. A successful push emits exactly one `sync_complete` event on
 *      `sync:{userId}` with the documented payload shape.
 *   2. A failed push (e.g., validation error pre-broadcast) emits NO event.
 *   3. Broadcast is fire-and-forget: if the channel.send() call throws,
 *      the push still returns 200 with its syncTime.
 *
 * Source:
 *   - supabase/functions/mobile-sync-push/index.ts lines 1449-1471
 *
 * The mock-broadcast helper in tests/sync/helpers/mock-broadcast.ts mirrors
 * the Edge Function's fire-and-forget semantics so these assertions run
 * without live Supabase credentials.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	callPushEndpoint,
	createMinimalPushPayload,
	createTestUser,
	type TestUser,
} from "./helpers/edge-function-harness";
import {
	getBroadcastsByEvent,
	resetBroadcasts,
	setBroadcastShouldThrow,
} from "./helpers/mock-broadcast";
import { resetMockStore } from "./helpers/mock-edge-functions";

vi.setConfig({ testTimeout: 30000 });

describe("mobile-sync-push → Supabase Broadcast", () => {
	let testUser: TestUser;

	beforeEach(async () => {
		resetMockStore();
		resetBroadcasts();
		testUser = await createTestUser();
	});

	it("emits sync_complete on successful push with documented payload shape", async () => {
		const payload = createMinimalPushPayload(testUser.id, {
			deviceId: "device-broadcast-1",
			platform: "android",
			profileId: null,
			profileName: null,
		});

		const pushResult = await callPushEndpoint(payload, testUser.accessToken);
		expect(pushResult.success).toBe(true);

		const events = getBroadcastsByEvent("sync_complete");
		expect(events).toHaveLength(1);

		const [evt] = events;
		// Channel is `sync:{userId}` — the mock derives userId from the
		// sessions payload (or falls back to 'mock-user'). Accept either form.
		expect(evt.channel).toMatch(/^sync:/);
		expect(evt.event).toBe("sync_complete");

		// Private Broadcast payload is { syncTime } only — no training metadata.
		expect(evt.payload).toEqual({
			syncTime: expect.any(String),
		});
		expect(evt.payload).not.toHaveProperty("deviceId");
		expect(evt.payload).not.toHaveProperty("profileName");
		expect(evt.payload).not.toHaveProperty("sessionsInserted");
	});

	it("does NOT broadcast when push fails (missing Authorization)", async () => {
		const payload = createMinimalPushPayload(testUser.id);
		const failed = await callPushEndpoint(payload, "");
		expect(failed.success).toBe(false);
		expect(failed.status).toBe(401);

		// Broadcast must never fire on the failure path — the real Edge
		// Function returns the 401 before reaching the channel.send() call.
		expect(getBroadcastsByEvent("sync_complete")).toHaveLength(0);
	});

	it("does NOT broadcast when payload validation fails (missing deviceId)", async () => {
		// Force a pre-broadcast validation failure. Even though the mock's
		// validation is light, missing deviceId is explicitly rejected
		// (mock-edge-functions.ts lines 97-106).
		const payload = createMinimalPushPayload(testUser.id, { deviceId: "" });
		const failed = await callPushEndpoint(payload, testUser.accessToken);
		expect(failed.success).toBe(false);
		expect(failed.status).toBe(400);
		expect(getBroadcastsByEvent("sync_complete")).toHaveLength(0);
	});

	it("push returns 200 even if broadcast throws (fire-and-forget)", async () => {
		// Simulates a Supabase channel outage. Real Edge Function wraps
		// channel.send in try/catch at lines 1469-1471 so the HTTP response
		// is unaffected.
		setBroadcastShouldThrow(true);

		const payload = createMinimalPushPayload(testUser.id);
		const result = await callPushEndpoint(payload, testUser.accessToken);
		expect(result.success).toBe(true);
		expect(result.status).toBe(200);

		// No event captured because the mock broadcast swallowed the error
		expect(getBroadcastsByEvent("sync_complete")).toHaveLength(0);
	});

	it("channel name encodes userId (sync:{userId})", async () => {
		// Use a distinctive userId via a session's userId field so the mock
		// can derive it. This asserts the channel-naming invariant that
		// useRealtimeSync relies on: `supabase.channel(`sync:${user.id}`)`.
		const payload = createMinimalPushPayload(testUser.id);
		payload.sessions = [
			{
				id: "00000000-0000-4000-8000-000000000001",
				userId: testUser.id,
				name: null,
				startedAt: new Date().toISOString(),
				durationSeconds: 0,
				totalVolume: 0,
				setCount: 0,
				exerciseCount: 0,
				prCount: 0,
				routineName: null,
				workoutMode: null,
				routineSessionId: null,
				exercises: [],
			},
		];

		await callPushEndpoint(payload, testUser.accessToken);

		const events = getBroadcastsByEvent("sync_complete");
		expect(events).toHaveLength(1);
		expect(events[0].channel).toBe(`sync:${testUser.id}`);
	});
});
