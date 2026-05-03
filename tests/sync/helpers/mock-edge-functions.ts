/**
 * Mock Edge Function Implementations
 *
 * Provides mock implementations of mobile-sync-push and mobile-sync-pull
 * for CI environments without Supabase access.
 *
 * Enable mocks by setting MOCK_EDGE_FUNCTIONS=true environment variable.
 */

import type {
  PushPayload,
  PullResponse,
  EdgeFunctionResult,
  SessionResponseDto,
  RoutineResponseDto,
  CycleResponseDto,
  BadgeResponseDto,
} from './edge-function-harness';
import { recordBroadcast } from './mock-broadcast';

/**
 * Check if mocks should be used
 */
export function useMocks(): boolean {
  return process.env.MOCK_EDGE_FUNCTIONS === 'true';
}

// ============================================================================
// Mock State
// ============================================================================

/**
 * In-memory store for mock data
 * Simulates the database state for testing
 */
interface MockStore {
  sessions: Map<string, SessionResponseDto>;
  routines: Map<string, RoutineResponseDto>;
  cycles: Map<string, CycleResponseDto>;
  badges: Map<string, BadgeResponseDto>; // keyed by `userId:badgeId` for union merge
  lastPushTime: number;
}

const mockStore: MockStore = {
  sessions: new Map(),
  routines: new Map(),
  cycles: new Map(),
  badges: new Map(),
  lastPushTime: 0,
};

/**
 * Reset mock store state (useful between tests)
 */
export function resetMockStore(): void {
  mockStore.sessions.clear();
  mockStore.routines.clear();
  mockStore.cycles.clear();
  mockStore.badges.clear();
  mockStore.lastPushTime = 0;
}

// ============================================================================
// Mock Edge Function Implementations
// ============================================================================

/**
 * Mock implementation of mobile-sync-push
 *
 * Validates the payload structure and stores data in memory.
 * Returns success/error responses matching the real endpoint behavior.
 * Supports batch failure injection for testing transactional batch handling.
 */
export function mockPushEndpoint(
  payload: PushPayload,
  authToken: string
): EdgeFunctionResult<{ success: boolean; syncTime?: number }> {
  // Check for injected batch failure first (simulates server-side batch processing)
  const sessionCount = payload.sessions?.length ?? 0;
  const batchError = checkBatchFailure(sessionCount);
  if (batchError) {
    return batchError as EdgeFunctionResult<{ success: boolean; syncTime?: number }>;
  }

  // Validate auth token
  if (!authToken || authToken === '') {
    return {
      success: false,
      status: 401,
      error: {
        message: 'Missing Authorization header',
        code: 'UNAUTHORIZED',
      },
    };
  }

  // Validate required fields
  if (!payload.deviceId) {
    return {
      success: false,
      status: 400,
      error: {
        message: 'Missing required field: deviceId',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  if (!payload.platform) {
    return {
      success: false,
      status: 400,
      error: {
        message: 'Missing required field: platform',
        code: 'VALIDATION_ERROR',
      },
    };
  }

  // Store sessions
  if (payload.sessions) {
    for (const session of payload.sessions) {
      // Transform to response format
      const responseSession: SessionResponseDto = {
        ...session,
        exercises: session.exercises.map((ex) => ({
          ...ex,
          sets: ex.sets.map((set) => ({
            ...set,
            repSummaries: set.repSummaries || [],
          })),
        })),
      };
      mockStore.sessions.set(session.id, responseSession);
    }
  }

  // Store routines
  if (payload.routines) {
    for (const routine of payload.routines) {
      mockStore.routines.set(routine.id, routine as RoutineResponseDto);
    }
  }

  // Store cycles
  if (payload.cycles) {
    for (const cycle of payload.cycles) {
      mockStore.cycles.set(cycle.id, cycle as CycleResponseDto);
    }
  }

  // Store badges (union merge: keyed by userId:badgeId to prevent duplicates)
  if (payload.badges) {
    for (const badge of payload.badges) {
      // Extract userId from auth token context or use a placeholder
      // In mock, we'll use badgeId as the key part that matters for union
      const badgeKey = `mock-user:${badge.badgeId}`;
      const responseBadge: BadgeResponseDto = {
        ...badge,
        userId: 'mock-user', // In real impl, this comes from JWT
      };
      mockStore.badges.set(badgeKey, responseBadge);
    }
  }

  const syncTime = Date.now();
  mockStore.lastPushTime = syncTime;

  // Emit mirror of the Edge Function's fire-and-forget broadcast.
  // The real implementation is at mobile-sync-push/index.ts lines 1449-1471.
  // We derive a userId from the sessions payload or fall back to 'mock-user'.
  const userId = payload.sessions?.[0]?.userId ?? 'mock-user';
  recordBroadcast(`sync:${userId}`, 'sync_complete', {
    syncTime: new Date(syncTime).toISOString(),
    deviceId: payload.deviceId,
    platform: payload.platform,
    profileId: payload.profileId ?? null,
    profileName: payload.profileName ?? null,
    sessionsInserted: payload.sessions?.length ?? 0,
    routinesUpserted: payload.routines?.length ?? 0,
    cyclesUpserted: payload.cycles?.length ?? 0,
    badgesUpserted: payload.badges?.length ?? 0,
  });

  return {
    success: true,
    status: 200,
    data: {
      success: true,
      syncTime,
    },
  };
}

/**
 * Mock implementation of mobile-sync-pull
 *
 * Returns data from the mock store that was added after lastSync.
 * Simulates delta sync behavior.
 */
export function mockPullEndpoint(
  lastSync: number,
  authToken: string,
  options?: { deviceId?: string; profileId?: string }
): EdgeFunctionResult<PullResponse> {
  // Validate auth token
  if (!authToken || authToken === '') {
    return {
      success: false,
      status: 401,
      error: {
        message: 'Missing Authorization header',
        code: 'UNAUTHORIZED',
      },
    };
  }

  const syncTime = Date.now();

  // Filter sessions modified after lastSync
  // In mock mode, we return all sessions since we don't track timestamps per-item
  const sessions = lastSync === 0
    ? Array.from(mockStore.sessions.values())
    : mockStore.lastPushTime > lastSync
      ? Array.from(mockStore.sessions.values())
      : [];

  // Filter routines modified after lastSync
  const routines = lastSync === 0
    ? Array.from(mockStore.routines.values())
    : mockStore.lastPushTime > lastSync
      ? Array.from(mockStore.routines.values())
      : [];

  // Filter cycles modified after lastSync
  const cycles = lastSync === 0
    ? Array.from(mockStore.cycles.values())
    : mockStore.lastPushTime > lastSync
      ? Array.from(mockStore.cycles.values())
      : [];

  // Return all badges (union merge means all unique badges are returned)
  const badges = lastSync === 0
    ? Array.from(mockStore.badges.values())
    : mockStore.lastPushTime > lastSync
      ? Array.from(mockStore.badges.values())
      : [];

  const response: PullResponse = {
    syncTime,
    sessions,
    routines,
    cycles,
    personalRecords: [],
    rpgAttributes: null,
    badges,
    gamificationStats: null,
    localProfiles: [],
    externalActivities: [],
    customExercises: [],
  };

  return {
    success: true,
    status: 200,
    data: response,
  };
}

// ============================================================================
// Mock Assertion Helpers
// ============================================================================

/**
 * Get a session from the mock store by ID
 */
export function getMockSession(sessionId: string): SessionResponseDto | undefined {
  return mockStore.sessions.get(sessionId);
}

/**
 * Get a routine from the mock store by ID
 */
export function getMockRoutine(routineId: string): RoutineResponseDto | undefined {
  return mockStore.routines.get(routineId);
}

/**
 * Get a cycle from the mock store by ID
 */
export function getMockCycle(cycleId: string): CycleResponseDto | undefined {
  return mockStore.cycles.get(cycleId);
}

/**
 * Get all sessions from the mock store
 */
export function getAllMockSessions(): SessionResponseDto[] {
  return Array.from(mockStore.sessions.values());
}

/**
 * Get all routines from the mock store
 */
export function getAllMockRoutines(): RoutineResponseDto[] {
  return Array.from(mockStore.routines.values());
}

/**
 * Get all cycles from the mock store
 */
export function getAllMockCycles(): CycleResponseDto[] {
  return Array.from(mockStore.cycles.values());
}

/**
 * Check if a session exists in the mock store
 */
export function mockSessionExists(sessionId: string): boolean {
  return mockStore.sessions.has(sessionId);
}

/**
 * Get the number of items in the mock store
 */
export function getMockStoreCounts(): {
  sessions: number;
  routines: number;
  cycles: number;
} {
  return {
    sessions: mockStore.sessions.size,
    routines: mockStore.routines.size,
    cycles: mockStore.cycles.size,
  };
}

// ============================================================================
// Mock Error Injection
// ============================================================================

let mockErrorMode: 'none' | 'network' | 'auth' | 'server' = 'none';

/**
 * Set mock error mode for testing error handling
 */
export function setMockErrorMode(mode: typeof mockErrorMode): void {
  mockErrorMode = mode;
}

/**
 * Get current mock error mode
 */
export function getMockErrorMode(): typeof mockErrorMode {
  return mockErrorMode;
}

/**
 * Check and potentially inject mock errors
 * Call this at the start of mock functions to simulate failures
 */
export function checkMockError(): EdgeFunctionResult<never> | null {
  switch (mockErrorMode) {
    case 'network':
      return {
        success: false,
        status: 0,
        error: {
          message: 'Network error',
          code: 'NETWORK_ERROR',
        },
      };
    case 'auth':
      return {
        success: false,
        status: 401,
        error: {
          message: 'Invalid token',
          code: 'UNAUTHORIZED',
        },
      };
    case 'server':
      return {
        success: false,
        status: 500,
        error: {
          message: 'Internal server error',
          code: 'SERVER_ERROR',
        },
      };
    default:
      return null;
  }
}

// ============================================================================
// Batch Failure Injection (for testing transactional batch handling)
// ============================================================================

/**
 * Configuration for batch failure injection.
 * Allows simulating failures at specific batch numbers with specific error codes.
 */
interface BatchFailureConfig {
  /** Which batch number (1-indexed) should fail. null = no batch failure */
  failOnBatch: number | null;
  /** HTTP status code to return on failure */
  errorCode: number;
  /** Error message to return */
  errorMessage: string;
  /** Number of times this batch has been called (for tracking) */
  batchCallCount: number;
  /** Total batches seen in current push sequence */
  currentSequenceBatches: number;
}

const batchFailureConfig: BatchFailureConfig = {
  failOnBatch: null,
  errorCode: 500,
  errorMessage: 'Internal server error',
  batchCallCount: 0,
  currentSequenceBatches: 0,
};

/**
 * Configure batch failure injection for testing.
 *
 * @param batchNumber - Which batch (1-indexed) should fail, or null to disable
 * @param errorCode - HTTP status code to return (default 500)
 * @param errorMessage - Error message to return
 */
export function setBatchFailure(
  batchNumber: number | null,
  errorCode = 500,
  errorMessage = 'Internal server error'
): void {
  batchFailureConfig.failOnBatch = batchNumber;
  batchFailureConfig.errorCode = errorCode;
  batchFailureConfig.errorMessage = errorMessage;
  batchFailureConfig.batchCallCount = 0;
  batchFailureConfig.currentSequenceBatches = 0;
}

/**
 * Reset batch failure configuration
 */
export function resetBatchFailure(): void {
  batchFailureConfig.failOnBatch = null;
  batchFailureConfig.errorCode = 500;
  batchFailureConfig.errorMessage = 'Internal server error';
  batchFailureConfig.batchCallCount = 0;
  batchFailureConfig.currentSequenceBatches = 0;
}

/**
 * Get current batch failure configuration (for test assertions)
 */
export function getBatchFailureConfig(): Readonly<BatchFailureConfig> {
  return { ...batchFailureConfig };
}

/**
 * Track a batch push and check if it should fail.
 * Returns an error result if this batch should fail, null otherwise.
 */
export function checkBatchFailure(
  sessionCount: number
): EdgeFunctionResult<never> | null {
  batchFailureConfig.batchCallCount++;
  batchFailureConfig.currentSequenceBatches++;

  if (
    batchFailureConfig.failOnBatch !== null &&
    batchFailureConfig.batchCallCount === batchFailureConfig.failOnBatch
  ) {
    return {
      success: false,
      status: batchFailureConfig.errorCode,
      error: {
        message: `${batchFailureConfig.errorMessage} (batch ${batchFailureConfig.batchCallCount}, ${sessionCount} sessions)`,
        code: batchFailureConfig.errorCode === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
      },
    };
  }

  return null;
}

/**
 * Reset the batch call counter (call between test push sequences)
 */
export function resetBatchCallCount(): void {
  batchFailureConfig.batchCallCount = 0;
  batchFailureConfig.currentSequenceBatches = 0;
}
