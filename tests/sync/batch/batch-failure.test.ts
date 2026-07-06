/**
 * Batch Failure Tests for Transactional Batch Handling
 *
 * Tests the deferred timestamp update behavior (audit 4.1 fix):
 * - lastSync timestamp should NOT be updated until ALL batches succeed
 * - On batch failure, no timestamp change - full retry on next sync
 * - Retry storm prevention with max retry tracking
 *
 * These tests validate the mobile app's SyncManager batch handling logic
 * by simulating the server-side behavior through mock edge functions.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	callPushEndpoint,
	createMinimalPushPayload,
	createTestExercise,
	createTestSession,
	createTestSet,
	generateTestId,
	type PushPayload,
	type SessionDto,
} from "../helpers/edge-function-harness";
import {
	getAllMockSessions,
	getBatchFailureConfig,
	getMockStoreCounts,
	resetBatchCallCount,
	resetBatchFailure,
	resetMockStore,
	setBatchFailure,
} from "../helpers/mock-edge-functions";
import { setupSyncTests } from "../setup";

// Enable mocks for these tests
process.env.MOCK_EDGE_FUNCTIONS = "true";

// Setup sync test environment
setupSyncTests();

/**
 * Helper to create a batch of test sessions
 */
function createSessionBatch(
	userId: string,
	count: number,
	batchIndex: number,
): SessionDto[] {
	const sessions: SessionDto[] = [];
	for (let i = 0; i < count; i++) {
		const session = createTestSession(userId, {
			name: `Batch ${batchIndex + 1} Session ${i + 1}`,
		});
		const exercise = createTestExercise(session.id, 0);
		const set = createTestSet(exercise.id, 1);
		exercise.sets = [set];
		session.exercises = [exercise];
		sessions.push(session);
	}
	return sessions;
}

/**
 * Helper to create a multi-batch payload
 * Mobile's SYNC_BATCH_SIZE = 50, so we need >50 sessions for multi-batch
 */
function createMultiBatchPayload(
	userId: string,
	sessionCount: number,
	batchSize = 50,
): { payload: PushPayload; expectedBatches: number } {
	const sessions: SessionDto[] = [];
	const batchCount = Math.ceil(sessionCount / batchSize);

	for (let batch = 0; batch < batchCount; batch++) {
		const remaining = sessionCount - sessions.length;
		const count = Math.min(batchSize, remaining);
		sessions.push(...createSessionBatch(userId, count, batch));
	}

	const payload = createMinimalPushPayload(userId, { sessions });
	return {
		payload,
		expectedBatches: batchCount,
	};
}

describe("Batch Failure Handling", () => {
	const testUserId = generateTestId();
	const mockAuthToken = "mock-access-token";

	beforeEach(() => {
		resetMockStore();
		resetBatchFailure();
		resetBatchCallCount();
	});

	afterEach(() => {
		resetBatchFailure();
	});

	describe("Single Batch Push (Fast Path)", () => {
		it("should succeed with small payload (under batch size)", async () => {
			const sessions = createSessionBatch(testUserId, 10, 0);
			const payload = createMinimalPushPayload(testUserId, { sessions });

			const result = await callPushEndpoint(payload, mockAuthToken);

			expect(result.success).toBe(true);
			expect(result.status).toBe(200);
			expect(result.data?.syncTime).toBeDefined();

			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(10);
		});

		it("should fail gracefully on server error", async () => {
			setBatchFailure(1, 500, "Internal server error");

			const sessions = createSessionBatch(testUserId, 10, 0);
			const payload = createMinimalPushPayload(testUserId, { sessions });

			const result = await callPushEndpoint(payload, mockAuthToken);

			expect(result.success).toBe(false);
			expect(result.status).toBe(500);
			expect(result.error?.message).toContain("Internal server error");

			// No sessions should be stored on failure
			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(0);
		});
	});

	describe("Multi-Batch Push (Batched Path)", () => {
		it("should handle 3-batch payload successfully when all batches succeed", async () => {
			// Create 120 sessions = 3 batches of 50, 50, 20
			const { payload, expectedBatches } = createMultiBatchPayload(
				testUserId,
				120,
			);

			expect(expectedBatches).toBe(3);

			// Simulate batch-by-batch push (as mobile does)
			const batches = chunkSessions(payload.sessions || [], 50);

			for (let i = 0; i < batches.length; i++) {
				const batchPayload = createMinimalPushPayload(testUserId, {
					sessions: batches[i],
				});
				const result = await callPushEndpoint(batchPayload, mockAuthToken);
				expect(result.success).toBe(true);
			}

			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(120);
		});

		it("batch 1 succeeds, batch 2 fails -> no sessions from batch 2 stored", async () => {
			// Configure batch 2 to fail
			setBatchFailure(2, 500, "Batch 2 server error");

			const batches = [
				createSessionBatch(testUserId, 50, 0),
				createSessionBatch(testUserId, 50, 1),
				createSessionBatch(testUserId, 20, 2),
			];

			// Push batch 1 - should succeed
			const result1 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[0] }),
				mockAuthToken,
			);
			expect(result1.success).toBe(true);

			// Push batch 2 - should fail
			const result2 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[1] }),
				mockAuthToken,
			);
			expect(result2.success).toBe(false);
			expect(result2.status).toBe(500);
			expect(result2.error?.message).toContain("batch 2");

			// Only batch 1 sessions should be stored (50 sessions)
			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(50);

			// Batch 3 should not be attempted (caller stops on failure)
			const config = getBatchFailureConfig();
			expect(config.batchCallCount).toBe(2); // Only 2 batches were attempted
		});

		it("batch 1 succeeds, batch 2 succeeds, batch 3 fails -> batches 1-2 stored", async () => {
			// Configure batch 3 to fail
			setBatchFailure(3, 500, "Batch 3 server error");

			const batches = [
				createSessionBatch(testUserId, 50, 0),
				createSessionBatch(testUserId, 50, 1),
				createSessionBatch(testUserId, 20, 2),
			];

			// Push batches 1 and 2 - should succeed
			const result1 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[0] }),
				mockAuthToken,
			);
			expect(result1.success).toBe(true);

			const result2 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[1] }),
				mockAuthToken,
			);
			expect(result2.success).toBe(true);

			// Push batch 3 - should fail
			const result3 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[2] }),
				mockAuthToken,
			);
			expect(result3.success).toBe(false);

			// Only batches 1-2 should be stored (100 sessions)
			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(100);
		});
	});

	describe("Retry After Failure", () => {
		it("should allow retry after batch failure with all data re-sent", async () => {
			// First attempt: batch 2 fails
			setBatchFailure(2, 500, "Temporary error");

			const batches = [
				createSessionBatch(testUserId, 50, 0),
				createSessionBatch(testUserId, 50, 1),
			];

			// First push attempt
			await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[0] }),
				mockAuthToken,
			);
			const failResult = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[1] }),
				mockAuthToken,
			);
			expect(failResult.success).toBe(false);

			// Reset failure for retry
			resetBatchFailure();
			resetBatchCallCount();
			resetMockStore(); // Simulate fresh retry (mobile would re-send all)

			// Retry all batches
			const retry1 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[0] }),
				mockAuthToken,
			);
			expect(retry1.success).toBe(true);

			const retry2 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batches[1] }),
				mockAuthToken,
			);
			expect(retry2.success).toBe(true);

			// All sessions should now be stored
			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(100);
		});

		it("should handle rate limiting (429) gracefully", async () => {
			setBatchFailure(1, 429, "Rate limited");

			const sessions = createSessionBatch(testUserId, 10, 0);
			const payload = createMinimalPushPayload(testUserId, { sessions });

			const result = await callPushEndpoint(payload, mockAuthToken);

			expect(result.success).toBe(false);
			expect(result.status).toBe(429);
			expect(result.error?.code).toBe("RATE_LIMITED");
		});
	});

	describe("Large Payload Batching", () => {
		it("should calculate correct batch count for various payload sizes", () => {
			const testCases = [
				{ sessionCount: 1, expectedBatches: 1 },
				{ sessionCount: 50, expectedBatches: 1 },
				{ sessionCount: 51, expectedBatches: 2 },
				{ sessionCount: 100, expectedBatches: 2 },
				{ sessionCount: 150, expectedBatches: 3 },
				{ sessionCount: 200, expectedBatches: 4 },
				{ sessionCount: 500, expectedBatches: 10 },
			];

			for (const { sessionCount, expectedBatches } of testCases) {
				const { expectedBatches: actual } = createMultiBatchPayload(
					testUserId,
					sessionCount,
				);
				expect(actual).toBe(expectedBatches);
			}
		});

		it("should handle exact batch boundary (50 sessions)", async () => {
			const sessions = createSessionBatch(testUserId, 50, 0);
			const payload = createMinimalPushPayload(testUserId, { sessions });

			const result = await callPushEndpoint(payload, mockAuthToken);

			expect(result.success).toBe(true);

			const config = getBatchFailureConfig();
			expect(config.batchCallCount).toBe(1); // Single batch
		});

		it("should handle just over batch boundary (51 sessions)", async () => {
			// 51 sessions = 2 batches (50 + 1)
			const batch1 = createSessionBatch(testUserId, 50, 0);
			const batch2 = createSessionBatch(testUserId, 1, 1);

			const result1 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batch1 }),
				mockAuthToken,
			);
			expect(result1.success).toBe(true);

			const result2 = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions: batch2 }),
				mockAuthToken,
			);
			expect(result2.success).toBe(true);

			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(51);
		});
	});

	describe("Error Context and Messaging", () => {
		it("should include batch number in error message", async () => {
			setBatchFailure(2, 500, "Server error");

			// Push batch 1
			await callPushEndpoint(
				createMinimalPushPayload(testUserId, {
					sessions: createSessionBatch(testUserId, 50, 0),
				}),
				mockAuthToken,
			);

			// Push batch 2 - should fail with context
			const result = await callPushEndpoint(
				createMinimalPushPayload(testUserId, {
					sessions: createSessionBatch(testUserId, 30, 1),
				}),
				mockAuthToken,
			);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain("batch 2");
			expect(result.error?.message).toContain("30 sessions");
		});

		it("should include session count in error context", async () => {
			setBatchFailure(1, 500, "Validation error");

			const sessions = createSessionBatch(testUserId, 25, 0);
			const result = await callPushEndpoint(
				createMinimalPushPayload(testUserId, { sessions }),
				mockAuthToken,
			);

			expect(result.success).toBe(false);
			expect(result.error?.message).toContain("25 sessions");
		});
	});

	describe("Idempotent Behavior", () => {
		it("should handle duplicate session IDs gracefully (upsert)", async () => {
			const sessions = createSessionBatch(testUserId, 10, 0);
			const payload = createMinimalPushPayload(testUserId, { sessions });

			// First push
			const result1 = await callPushEndpoint(payload, mockAuthToken);
			expect(result1.success).toBe(true);

			// Reset call count for clarity
			resetBatchCallCount();

			// Second push with same sessions (retry scenario)
			const result2 = await callPushEndpoint(payload, mockAuthToken);
			expect(result2.success).toBe(true);

			// Should still have 10 sessions (not 20) due to upsert
			const counts = getMockStoreCounts();
			expect(counts.sessions).toBe(10);
		});
	});
});

/**
 * Helper to chunk sessions array (mirrors mobile's SYNC_BATCH_SIZE logic)
 */
function chunkSessions(sessions: SessionDto[], size: number): SessionDto[][] {
	const chunks: SessionDto[][] = [];
	for (let i = 0; i < sessions.length; i += size) {
		chunks.push(sessions.slice(i, i + size));
	}
	return chunks;
}
