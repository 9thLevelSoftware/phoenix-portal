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
} from './edge-function-harness';

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
  lastPushTime: number;
}

const mockStore: MockStore = {
  sessions: new Map(),
  routines: new Map(),
  cycles: new Map(),
  lastPushTime: 0,
};

/**
 * Reset mock store state (useful between tests)
 */
export function resetMockStore(): void {
  mockStore.sessions.clear();
  mockStore.routines.clear();
  mockStore.cycles.clear();
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
 */
export function mockPushEndpoint(
  payload: PushPayload,
  authToken: string
): EdgeFunctionResult<{ success: boolean; syncTime?: number }> {
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

  const syncTime = Date.now();
  mockStore.lastPushTime = syncTime;

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

  const response: PullResponse = {
    syncTime,
    sessions,
    routines,
    cycles,
    personalRecords: [],
    rpgAttributes: null,
    badges: [],
    gamificationStats: null,
    localProfiles: [],
    externalActivities: [],
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
