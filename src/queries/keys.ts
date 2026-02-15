export const queryKeys = {
  workouts: {
    all: ['workouts'] as const,
    list: (userId: string) => [...queryKeys.workouts.all, 'list', userId] as const,
    detail: (sessionId: string) => [...queryKeys.workouts.all, 'detail', sessionId] as const,
  },
  records: {
    all: ['records'] as const,
    byUser: (userId: string) => [...queryKeys.records.all, userId] as const,
  },
  analytics: {
    all: ['analytics'] as const,
    summary: (userId: string, period: string) =>
      [...queryKeys.analytics.all, 'summary', userId, period] as const,
  },
  routines: {
    all: ['routines'] as const,
    byUser: (userId: string) => [...queryKeys.routines.all, userId] as const,
    detail: (routineId: string) => [...queryKeys.routines.all, 'detail', routineId] as const,
  },
  cycles: {
    all: ['cycles'] as const,
    byUser: (userId: string) => [...queryKeys.cycles.all, userId] as const,
    detail: (cycleId: string) => [...queryKeys.cycles.all, 'detail', cycleId] as const,
  },
} as const;
