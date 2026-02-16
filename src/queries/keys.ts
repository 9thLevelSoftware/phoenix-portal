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
  subscription: {
    all: ['subscription'] as const,
    byUser: (userId: string) => [...queryKeys.subscription.all, userId] as const,
  },
  cycles: {
    all: ['cycles'] as const,
    byUser: (userId: string) => [...queryKeys.cycles.all, userId] as const,
    detail: (cycleId: string) => [...queryKeys.cycles.all, 'detail', cycleId] as const,
  },
  telemetry: {
    all: ['telemetry'] as const,
    bySet: (setId: string) => [...queryKeys.telemetry.all, 'set', setId] as const,
    repSummaries: (setId: string) =>
      [...queryKeys.telemetry.all, 'rep-summaries', setId] as const,
  },
  biomechanics: {
    all: ['biomechanics'] as const,
    asymmetry: (sessionId: string) =>
      [...queryKeys.biomechanics.all, 'asymmetry', sessionId] as const,
    rom: (exerciseId: string) =>
      [...queryKeys.biomechanics.all, 'rom', exerciseId] as const,
  },
  progress: {
    all: ['progress'] as const,
    byExercise: (userId: string, exerciseName: string) =>
      [...queryKeys.progress.all, userId, exerciseName] as const,
    summary: (userId: string, period: string) =>
      [...queryKeys.progress.all, 'summary', userId, period] as const,
  },
  community: {
    all: ['community'] as const,
    feed: (params: {
      tab: string;
      sort: string;
      filters?: Record<string, string>;
      search?: string;
      userId?: string;
    }) => [...queryKeys.community.all, 'feed', params] as const,
    creators: {
      all: [...['community'], 'creators'] as const,
      featured: () => [...queryKeys.community.creators.all, 'featured'] as const,
      profile: (userId: string) =>
        [...queryKeys.community.creators.all, userId] as const,
    },
    saves: (userId: string) =>
      [...queryKeys.community.all, 'saves', userId] as const,
    votes: (userId: string) =>
      [...queryKeys.community.all, 'votes', userId] as const,
  },
} as const;
