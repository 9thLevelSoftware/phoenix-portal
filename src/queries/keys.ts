export const queryKeys = {
	workouts: {
		all: ["workouts"] as const,
		list: (userId: string, profileId?: string | null) =>
			[...queryKeys.workouts.all, "list", userId, profileId ?? "all"] as const,
		detail: (sessionId: string) =>
			[...queryKeys.workouts.all, "detail", sessionId] as const,
		comparison: (sessionAId: string, sessionBId: string) =>
			[
				...queryKeys.workouts.all,
				"comparison",
				sessionAId,
				sessionBId,
			] as const,
	},
	records: {
		all: ["records"] as const,
		byUser: (userId: string, profileId?: string | null) =>
			[...queryKeys.records.all, userId, profileId ?? "all"] as const,
	},
	analytics: {
		all: ["analytics"] as const,
		summary: (userId: string, period: string, profileId?: string | null) =>
			[
				...queryKeys.analytics.all,
				"summary",
				userId,
				period,
				profileId ?? "all",
			] as const,
	},
	routines: {
		all: ["routines"] as const,
		byUser: (userId: string, profileId?: string | null) =>
			[...queryKeys.routines.all, userId, profileId ?? "all"] as const,
		detail: (routineId: string) =>
			[...queryKeys.routines.all, "detail", routineId] as const,
	},
	subscription: {
		all: ["subscription"] as const,
		byUser: (userId: string) =>
			[...queryKeys.subscription.all, userId] as const,
	},
	cycles: {
		all: ["cycles"] as const,
		byUser: (userId: string, profileId?: string | null) =>
			[...queryKeys.cycles.all, userId, profileId ?? "all"] as const,
		detail: (cycleId: string) =>
			[...queryKeys.cycles.all, "detail", cycleId] as const,
	},
	telemetry: {
		all: ["telemetry"] as const,
		bySet: (setId: string) =>
			[...queryKeys.telemetry.all, "set", setId] as const,
		repSummaries: (setId: string) =>
			[...queryKeys.telemetry.all, "rep-summaries", setId] as const,
	},
	biomechanics: {
		all: ["biomechanics"] as const,
		asymmetry: (sessionId: string) =>
			[...queryKeys.biomechanics.all, "asymmetry", sessionId] as const,
		rom: (exerciseId: string) =>
			[...queryKeys.biomechanics.all, "rom", exerciseId] as const,
	},
	progress: {
		all: ["progress"] as const,
		exercises: (userId: string, profileId?: string | null) =>
			[
				...queryKeys.progress.all,
				"exercises",
				userId,
				profileId ?? "all",
			] as const,
		byExercise: (
			userId: string,
			exerciseName: string,
			profileId?: string | null,
		) =>
			[
				...queryKeys.progress.all,
				userId,
				exerciseName,
				profileId ?? "all",
			] as const,
		summary: (userId: string, period: string, profileId?: string | null) =>
			[
				...queryKeys.progress.all,
				"summary",
				userId,
				period,
				profileId ?? "all",
			] as const,
	},
	replay: {
		all: ["replay"] as const,
		session: (sessionId: string) =>
			[...queryKeys.replay.all, "session", sessionId] as const,
		telemetry: (setId: string) =>
			[...queryKeys.replay.all, "telemetry", setId] as const,
	},
	integrations: {
		all: ["integrations"] as const,
		byUser: (userId: string) =>
			[...queryKeys.integrations.all, userId] as const,
		external: (userId: string) =>
			[...queryKeys.integrations.all, "external", userId] as const,
		syncQueue: (userId: string) =>
			[...queryKeys.integrations.all, "sync-queue", userId] as const,
	},
	comments: {
		all: ["comments"] as const,
		byItem: (itemId: string) => [...queryKeys.comments.all, itemId] as const,
	},
	community: {
		all: ["community"] as const,
		feed: (params: {
			tab: string;
			sort: string;
			filters?: Record<string, string>;
			search?: string;
			userId?: string;
		}) => [...queryKeys.community.all, "feed", params] as const,
		creators: {
			all: [...["community"], "creators"] as const,
			featured: () =>
				[...queryKeys.community.creators.all, "featured"] as const,
			profile: (userId: string) =>
				[...queryKeys.community.creators.all, userId] as const,
		},
		blocks: (userId: string) =>
			[...queryKeys.community.all, "blocks", userId] as const,
		reports: (userId: string) =>
			[...queryKeys.community.all, "reports", userId] as const,
		saves: (userId: string) =>
			[...queryKeys.community.all, "saves", userId] as const,
		votes: (userId: string) =>
			[...queryKeys.community.all, "votes", userId] as const,
		follows: (followerId: string, followedId: string) =>
			[...queryKeys.community.all, "follows", followerId, followedId] as const,
	},
	challenges: {
		all: ["challenges"] as const,
		list: () => [...queryKeys.challenges.all, "list"] as const,
		detail: (id: string) => [...queryKeys.challenges.all, id] as const,
	},
	onboarding: {
		all: ["onboarding"] as const,
		byUser: (userId: string) => [...queryKeys.onboarding.all, userId] as const,
	},
	goals: {
		all: ["goals"] as const,
		byUser: (userId: string) => [...queryKeys.goals.all, userId] as const,
		progress: (userId: string) =>
			[...queryKeys.goals.all, "progress", userId] as const,
	},
	recovery: {
		all: ["recovery"] as const,
		score: (userId: string) =>
			[...queryKeys.recovery.all, "score", userId] as const,
		wearable: (userId: string) =>
			[...queryKeys.recovery.all, "wearable", userId] as const,
	},
	profile: {
		all: ["profile"] as const,
		byUser: (userId: string) => [...queryKeys.profile.all, userId] as const,
		stats: (userId: string, profileId?: string | null) =>
			[...queryKeys.profile.all, "stats", userId, profileId ?? "all"] as const,
		topExercises: (userId: string, profileId?: string | null) =>
			[
				...queryKeys.profile.all,
				"top-exercises",
				userId,
				profileId ?? "all",
			] as const,
		badges: (userId: string) =>
			[...queryKeys.profile.all, "badges", userId] as const,
		rpg: (userId: string) => [...queryKeys.profile.all, "rpg", userId] as const,
		gamification: (userId: string) =>
			[...queryKeys.profile.all, "gamification", userId] as const,
	},
	insights: {
		all: ["insights"] as const,
		byUser: (userId: string, period: string) =>
			[...queryKeys.insights.all, userId, period] as const,
	},
	benchmarks: {
		all: ["benchmarks"] as const,
		distribution: (metricType: string, metricKey?: string) =>
			[...queryKeys.benchmarks.all, metricType, metricKey] as const,
	},
	localProfiles: {
		all: ["localProfiles"] as const,
		byUser: (userId: string) =>
			[...queryKeys.localProfiles.all, userId] as const,
	},
} as const;
