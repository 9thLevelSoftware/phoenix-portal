import type { Page, Route } from "@playwright/test";
import {
	E2E_SUPABASE_URL,
	createStoredSession,
	seedStoredSession,
} from "./supabase";

export type MockSubscriptionTier = "FREE" | "EMBER" | "FLAME" | "INFERNO";

type IntegrationProvider = "strava" | "fitbit" | "garmin" | "hevy";

interface SubscriptionRow {
	user_id: string;
	tier: MockSubscriptionTier;
	status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
	price_id: string | null;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
}

interface IntegrationRow {
	id: string;
	user_id: string;
	provider: IntegrationProvider;
	provider_user_id: string | null;
	connected_at: string | null;
	last_sync_at: string | null;
	status: "connected" | "disconnected" | "error" | "token_expired";
	error_message: string | null;
}

interface ExerciseRow {
	id: string;
	session_id: string;
	name: string;
	muscle_group: string;
	order_index: number;
}

interface SetRow {
	id: string;
	exercise_id: string;
	set_number: number;
	target_reps: number | null;
	actual_reps: number;
	weight_kg: number;
	rpe: number | null;
	is_pr: boolean;
	notes: string | null;
}

interface ExternalActivityRow {
	id: string;
	user_id: string;
	provider: IntegrationProvider;
	external_id: string;
	name: string;
	activity_type: string;
	started_at: string;
	duration_seconds: number;
	distance_meters: number | null;
	calories: number | null;
	avg_heart_rate: number | null;
	max_heart_rate: number | null;
	elevation_gain_meters: number | null;
	raw_data: Record<string, unknown>;
	synced_at: string;
}

interface SyncQueueRow {
	id: string;
	user_id: string;
	provider: IntegrationProvider;
	sync_type: string;
	status: string;
	error_message: string | null;
	created_at: string;
	started_at: string | null;
	completed_at: string | null;
	retry_count: number;
}

interface MockSupabaseOptions {
	userId?: string;
	email?: string;
	tier?: MockSubscriptionTier;
	subscriptionStatus?: SubscriptionRow["status"];
	integrations?: IntegrationRow[];
	activities?: ExternalActivityRow[];
	syncQueue?: SyncQueueRow[];
	workoutSessions?: Record<string, unknown>[];
	exercises?: ExerciseRow[];
	sets?: SetRow[];
}

const MONTHLY_PRICE_IDS: Record<MockSubscriptionTier, string | null> = {
	FREE: null,
	EMBER: process.env.VITE_PADDLE_EMBER_MONTHLY_PRICE_ID ?? "pri_e2e_ember_monthly",
	FLAME: process.env.VITE_PADDLE_FLAME_MONTHLY_PRICE_ID ?? "pri_e2e_flame_monthly",
	INFERNO:
		process.env.VITE_PADDLE_INFERNO_MONTHLY_PRICE_ID ?? "pri_e2e_inferno_monthly",
};

export async function mockAuthenticatedApp(
	page: Page,
	options: MockSupabaseOptions = {},
) {
	const userId = options.userId ?? "00000000-0000-4000-8000-000000000001";
	await seedStoredSession(
		page,
		createStoredSession({ userId, email: options.email }),
	);
	return installMockSupabase(page, { ...options, userId });
}

export async function installMockSupabase(
	page: Page,
	options: MockSupabaseOptions = {},
) {
	const userId = options.userId ?? "00000000-0000-4000-8000-000000000001";
	const now = new Date().toISOString();
	const futureBillingPeriodEnd = new Date(
		Date.now() + 30 * 24 * 60 * 60 * 1000,
	).toISOString();
	let idCounter = 0;

	const state = {
		userId,
		subscription:
			options.tier && options.tier !== "FREE"
				? ({
						user_id: userId,
						tier: options.tier,
						status: options.subscriptionStatus ?? "active",
						price_id: MONTHLY_PRICE_IDS[options.tier],
						current_period_end: futureBillingPeriodEnd,
						cancel_at_period_end: false,
					} satisfies SubscriptionRow)
				: null,
		integrations: options.integrations ?? [],
		activities: options.activities ?? [],
		syncQueue: options.syncQueue ?? [],
		workoutSessions: options.workoutSessions ?? [],
		exercises: options.exercises ?? [],
		sets: options.sets ?? [],
		onboarding: {
			id: "onboarding-1",
			user_id: userId,
			completed_at: now,
			version_seen: "1.1",
			dismissed_hints: {},
			dismissed_whats_new: true,
			created_at: now,
		},
	};

	const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

	const respondCount = async (route: Route, count: number) => {
		await route.fulfill({
			status: 200,
			body: "",
			headers: {
				"content-range": `0-0/${count}`,
			},
		});
	};

	const decodeFilterList = (value: string) =>
		value
			.replace(/^in\.\(/, "")
			.replace(/\)$/, "")
			.split(",")
			.map((item) => decodeURIComponent(item));

	const filterRows = <TRow extends Record<string, unknown>>(
		rows: TRow[],
		url: URL,
	) =>
		rows.filter((row) => {
			for (const [key, value] of url.searchParams.entries()) {
				if (key === "select" || key === "order" || key === "limit" || key === "offset") {
					continue;
				}

				if (value.startsWith("eq.")) {
					if (String(row[key]) !== decodeURIComponent(value.slice(3))) {
						return false;
					}
					continue;
				}

				if (value.startsWith("in.(")) {
					if (!decodeFilterList(value).includes(String(row[key]))) {
						return false;
					}
				}
			}

			return true;
		});

	const respondRows = async <TRow extends Record<string, unknown>>(
		route: Route,
		rows: TRow[],
		acceptHeader?: string,
	) => {
		const wantsObject = acceptHeader?.includes("application/vnd.pgrst.object+json");
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(wantsObject ? (rows[0] ?? null) : rows),
		});
	};

	const completeLatestSync = (provider: IntegrationProvider) => {
		const syncItem = [...state.syncQueue]
			.reverse()
			.find((item) => item.provider === provider);

		if (syncItem) {
			syncItem.status = "completed";
			syncItem.error_message = null;
			syncItem.completed_at = new Date().toISOString();
		}

		const integration = state.integrations.find((item) => item.provider === provider);
		if (integration) {
			integration.status = "connected";
			integration.error_message = null;
			integration.last_sync_at = new Date().toISOString();
		}
	};

	await page.route(`${E2E_SUPABASE_URL}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const pathname = url.pathname;
		const method = request.method();

		if (pathname === "/auth/v1/logout") {
			await route.fulfill({ status: 204, body: "" });
			return;
		}

		if (pathname.startsWith("/functions/v1/")) {
			const functionName = pathname.split("/").pop();
			const rawBody = request.postData();
			const body = rawBody ? JSON.parse(rawBody) : {};

			if (functionName === "disconnect-integration") {
				const provider = body.provider as IntegrationProvider;
				state.integrations = state.integrations.map((integration) =>
					integration.provider === provider
						? {
								...integration,
								status: "disconnected",
								connected_at: null,
								provider_user_id: null,
								error_message: null,
							}
						: integration,
				);
				state.syncQueue = state.syncQueue.map((item) =>
					item.provider === provider && ["pending", "processing"].includes(item.status)
						? {
								...item,
								status: "failed",
								error_message: "Integration disconnected by user",
								completed_at: new Date().toISOString(),
							}
						: item,
				);
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ success: true }),
				});
				return;
			}

			if (functionName === "strava-sync" || functionName === "fitbit-sync") {
				completeLatestSync(functionName.replace("-sync", "") as IntegrationProvider);
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ success: true, synced: 1 }),
				});
				return;
			}

			if (functionName === "hevy-sync") {
				const timestamp = new Date().toISOString();
				const existing = state.integrations.find(
					(integration) => integration.provider === "hevy",
				);

				if (body.api_key && !existing) {
					state.integrations.push({
						id: nextId("integration"),
						user_id: userId,
						provider: "hevy",
						provider_user_id: null,
						connected_at: timestamp,
						last_sync_at: timestamp,
						status: "connected",
						error_message: null,
					});
				}

				if (body.sync_type === "manual") {
					completeLatestSync("hevy");
				}

				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ success: true, imported: 1 }),
				});
				return;
			}

			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ success: true }),
			});
			return;
		}

		if (!pathname.startsWith("/rest/v1/")) {
			await route.fulfill({ status: 404, body: "" });
			return;
		}

		const table = pathname.split("/").pop();

		switch (table) {
			case "subscriptions": {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(state.subscription),
				});
				return;
			}
			case "user_onboarding": {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(state.onboarding),
				});
				return;
			}
			case "workout_sessions": {
				const sessions = filterRows(state.workoutSessions, url);
				if (method === "HEAD") {
					await respondCount(route, sessions.length);
					return;
				}

				await respondRows(route, sessions, request.headers().accept);
				return;
			}
			case "exercises": {
				const exercises = filterRows(state.exercises, url);
				await respondRows(route, exercises, request.headers().accept);
				return;
			}
			case "sets": {
				const sets = filterRows(state.sets, url);
				await respondRows(route, sets, request.headers().accept);
				return;
			}
			case "challenge_participants": {
				await respondCount(route, 0);
				return;
			}
			case "shared_routines":
			case "shared_cycles": {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([]),
				});
				return;
			}
			case "community_comments": {
				await respondCount(route, 0);
				return;
			}
			case "user_integrations": {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(state.integrations),
				});
				return;
			}
			case "external_activities": {
				if (method === "POST") {
					const rawBody = request.postData();
					const rows = rawBody ? JSON.parse(rawBody) : [];
					const items = Array.isArray(rows) ? rows : [rows];
					for (const item of items) {
						state.activities.push({
							id: nextId("activity"),
							raw_data: {},
							synced_at: new Date().toISOString(),
							avg_heart_rate: null,
							max_heart_rate: null,
							elevation_gain_meters: null,
							...item,
						});
					}
					await route.fulfill({
						status: 201,
						contentType: "application/json",
						body: JSON.stringify(state.activities),
					});
					return;
				}

				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(state.activities),
				});
				return;
			}
			case "sync_queue": {
				if (method === "POST") {
					const rawBody = request.postData();
					const payload = rawBody ? JSON.parse(rawBody) : {};
					const row = {
						id: nextId("sync"),
						user_id: payload.user_id ?? userId,
						provider: payload.provider,
						sync_type: payload.sync_type ?? "manual",
						status: payload.status ?? "pending",
						error_message: null,
						created_at: new Date().toISOString(),
						started_at: null,
						completed_at: null,
						retry_count: 0,
					} satisfies SyncQueueRow;
					state.syncQueue.unshift(row);

					await route.fulfill({
						status: 201,
						contentType: "application/json",
						body:
							request.headers().accept?.includes("application/vnd.pgrst.object+json")
								? JSON.stringify({ id: row.id })
								: JSON.stringify([row]),
					});
					return;
				}

				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(state.syncQueue),
				});
				return;
			}
			default: {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([]),
				});
			}
		}
	});

	return state;
}
