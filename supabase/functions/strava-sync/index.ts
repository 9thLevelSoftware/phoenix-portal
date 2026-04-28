import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.ts";
import {
	decryptOAuthSecret,
	encryptOAuthSecret,
} from "../_shared/oauthTokenCrypto.ts";
import { isJsonObject, readJsonObject } from "../_shared/requestValidation.ts";
import { requireSubscription } from "../_shared/requireSubscription.ts";

/**
 * Strava Activity Sync Edge Function
 *
 * Fetches activities from Strava API, normalizes them, and upserts to
 * external_activities. Handles token refresh when access_token is expired.
 *
 * Request body:
 *   - user_id: string
 *   - sync_type: 'initial' | 'manual' | 'incremental'
 *
 * Environment variables:
 *   - STRAVA_CLIENT_ID
 *   - STRAVA_CLIENT_SECRET
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

// ---------------------------------------------------------------------------
// Strava activity normalization (mirrors src/lib/integrations/normalize.ts)
// Duplicated here because Edge Functions run in Deno, not the Vite app.
// ---------------------------------------------------------------------------

const SPORT_TYPE_MAP: Record<string, string> = {
	Run: "running",
	TrailRun: "running",
	VirtualRun: "running",
	Ride: "cycling",
	MountainBikeRide: "cycling",
	GravelRide: "cycling",
	VirtualRide: "cycling",
	Swim: "swimming",
	Walk: "walking",
	Hike: "hiking",
	WeightTraining: "strength",
	Crossfit: "strength",
	Yoga: "flexibility",
	Rowing: "rowing",
	Elliptical: "cardio",
	StairStepper: "cardio",
};

interface StravaActivityRaw {
	id: number;
	name: string;
	sport_type: string;
	start_date: string;
	elapsed_time: number;
	distance?: number;
	kilojoules?: number | null;
	average_heartrate?: number | null;
	max_heartrate?: number | null;
	total_elevation_gain?: number;
}

interface NormalizedActivity {
	external_id: string;
	provider: string;
	name: string;
	activity_type: string;
	started_at: string;
	duration_seconds: number;
	distance_meters: number | null;
	calories: number | null;
	avg_heart_rate: number | null;
	max_heart_rate: number | null;
	elevation_gain_meters: number | null;
}

type SyncType = "initial" | "manual" | "incremental";

function isSyncType(value: unknown): value is SyncType {
	return value === "initial" || value === "manual" || value === "incremental";
}

function isStravaActivityRaw(value: unknown): value is StravaActivityRaw {
	return (
		isJsonObject(value) &&
		typeof value.id === "number" &&
		Number.isFinite(value.id) &&
		typeof value.name === "string" &&
		typeof value.sport_type === "string" &&
		typeof value.start_date === "string" &&
		typeof value.elapsed_time === "number" &&
		Number.isFinite(value.elapsed_time)
	);
}

function isStravaRefreshPayload(value: unknown): value is {
	access_token: string;
	refresh_token?: string;
	expires_at: number;
} {
	return (
		isJsonObject(value) &&
		typeof value.access_token === "string" &&
		(value.refresh_token === undefined ||
			typeof value.refresh_token === "string") &&
		typeof value.expires_at === "number" &&
		Number.isFinite(value.expires_at)
	);
}

function normalizeStravaActivity(raw: StravaActivityRaw): NormalizedActivity {
	return {
		external_id: String(raw.id),
		provider: "strava",
		name: raw.name,
		activity_type: SPORT_TYPE_MAP[raw.sport_type] ?? "other",
		started_at: raw.start_date,
		duration_seconds: raw.elapsed_time,
		distance_meters: raw.distance ?? null,
		calories:
			raw.kilojoules != null ? Math.round(raw.kilojoules * 0.239) : null,
		avg_heart_rate: raw.average_heartrate ?? null,
		max_heart_rate: raw.max_heartrate ?? null,
		elevation_gain_meters: raw.total_elevation_gain ?? null,
	};
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshAccessToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_at: number;
}> {
	const response = await fetchWithTimeout(
		"https://www.strava.com/oauth/token",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				client_id: Deno.env.get("STRAVA_CLIENT_ID"),
				client_secret: Deno.env.get("STRAVA_CLIENT_SECRET"),
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		},
		10_000,
	);

	if (!response.ok) {
		throw new Error(
			`Token refresh failed: ${response.status} ${await response.text()}`,
		);
	}

	const payload: unknown = await response.json();
	if (!isStravaRefreshPayload(payload)) {
		throw new Error("Token refresh returned invalid payload");
	}
	return payload;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
	const cors = getCorsHeaders(req);

	// CORS preflight
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: cors });
	}

	try {
		// Parse request body first (needed for both auth paths)
		const parsedBody = await readJsonObject(req, cors);
		if (!parsedBody.ok) return parsedBody.response;
		const body = parsedBody.data;

		// ---- Auth: Dual-path (browser JWT or service-role key) ----
		const authHeader = req.headers.get("Authorization");

		if (!authHeader) {
			return new Response(JSON.stringify({ error: "Missing authorization" }), {
				status: 401,
				headers: { ...cors, "Content-Type": "application/json" },
			});
		}

		let userId: string;

		// Try JWT auth first (browser-initiated calls)
		const supabaseAuth = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_ANON_KEY")!,
			{ global: { headers: { Authorization: authHeader } } },
		);
		const {
			data: { user: jwtUser },
		} = await supabaseAuth.auth.getUser();

		if (jwtUser) {
			// Browser-initiated: use JWT-verified user ID, ignore body.user_id
			userId = jwtUser.id;
		} else {
			// Not a valid user JWT -- must be service-role call from process-sync-queue
			// Verify the caller is actually using the service role key
			const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
			const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

			if (!isServiceRole || typeof body.user_id !== "string") {
				return new Response(JSON.stringify({ error: "Not authenticated" }), {
					status: 401,
					headers: { ...cors, "Content-Type": "application/json" },
				});
			}
			userId = body.user_id;
		}

		const sync_type = body.sync_type ?? "incremental";
		if (!isSyncType(sync_type)) {
			return new Response(JSON.stringify({ error: "Invalid sync_type" }), {
				status: 400,
				headers: { ...cors, "Content-Type": "application/json" },
			});
		}

		const supabase = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
		);

		// Subscription gate — FLAME or higher required for integrations
		const gate = await requireSubscription(supabase, userId, "FLAME", cors);
		if (!gate.allowed) return gate.response;

		// ---------------------------------------------------------------
		// Fetch user's Strava tokens from oauth_tokens (server-only table)
		// ---------------------------------------------------------------
		const { data: tokens, error: tokenError } = await supabase
			.from("oauth_tokens")
			.select("access_token, refresh_token, token_expires_at")
			.eq("user_id", userId)
			.eq("provider", "strava")
			.single();

		const { data: integration } = await supabase
			.from("user_integrations")
			.select("last_sync_at, status")
			.eq("user_id", userId)
			.eq("provider", "strava")
			.single();

		if (tokenError || !tokens || integration?.status !== "connected") {
			return new Response(
				JSON.stringify({
					error: "Strava integration not found or not connected",
				}),
				{
					status: 404,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		let accessToken =
			(await decryptOAuthSecret(tokens.access_token as string)) ?? "";
		let refreshToken =
			(await decryptOAuthSecret(tokens.refresh_token as string)) ?? "";
		const tokenExpiresAt = tokens.token_expires_at
			? new Date(tokens.token_expires_at).getTime()
			: 0;

		// ---------------------------------------------------------------
		// Refresh token if expired (with 60s buffer)
		// ---------------------------------------------------------------
		if (Date.now() >= tokenExpiresAt - 60_000) {
			console.log("Strava access token expired, refreshing...");
			const refreshed = await refreshAccessToken(refreshToken);

			accessToken = refreshed.access_token;
			// Strava rotates refresh tokens on every refresh call; keep the in-memory
			// copy in sync with what we persist so any subsequent refresh in this
			// invocation uses the rotated value, not the now-revoked original.
			refreshToken = refreshed.refresh_token ?? refreshToken;

			// Persist new tokens in oauth_tokens (server-only table)
			const { error: persistTokenError } = await supabase
				.from("oauth_tokens")
				.update({
					access_token: await encryptOAuthSecret(refreshed.access_token),
					refresh_token: await encryptOAuthSecret(refreshToken),
					token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
					updated_at: new Date().toISOString(),
				})
				.eq("user_id", userId)
				.eq("provider", "strava");

			if (persistTokenError) {
				console.error(
					"Failed to persist refreshed Strava token:",
					persistTokenError,
				);
				return new Response(
					JSON.stringify({ error: "Failed to persist Strava token" }),
					{
						status: 502,
						headers: { ...cors, "Content-Type": "application/json" },
					},
				);
			}
		}

		// ---------------------------------------------------------------
		// Fetch activities from Strava
		// ---------------------------------------------------------------
		const baseParams = new URLSearchParams({ per_page: "200" });

		// For incremental sync, only fetch activities after last sync
		if (sync_type !== "initial" && integration.last_sync_at) {
			const afterEpoch = Math.floor(
				new Date(integration.last_sync_at as string).getTime() / 1000,
			);
			baseParams.set("after", String(afterEpoch));
		}

		const rawActivities: StravaActivityRaw[] = [];
		let page = 1;
		const maxPages = 50;
		const delayBetweenPagesMs = 350;

		while (page <= maxPages) {
			const params = new URLSearchParams(baseParams);
			params.set("page", String(page));

			const activitiesResponse = await fetchWithTimeout(
				`https://www.strava.com/api/v3/athlete/activities?${params}`,
				{
					headers: { Authorization: `Bearer ${accessToken}` },
				},
				10_000,
			);

			if (!activitiesResponse.ok) {
				const errorText = await activitiesResponse.text();
				console.error(
					"Strava activities fetch failed:",
					activitiesResponse.status,
					errorText,
				);

				if (activitiesResponse.status === 401) {
					await supabase
						.from("user_integrations")
						.update({
							status: "token_expired",
							error_message: "Access token revoked or invalid",
						})
						.eq("user_id", userId)
						.eq("provider", "strava");
				}

				return new Response(
					JSON.stringify({
						error: "Failed to fetch Strava activities",
						details: errorText,
					}),
					{
						status: 502,
						headers: { ...cors, "Content-Type": "application/json" },
					},
				);
			}

			const pagePayload: unknown = await activitiesResponse.json();
			if (
				!Array.isArray(pagePayload) ||
				!pagePayload.every(isStravaActivityRaw)
			) {
				return new Response(
					JSON.stringify({ error: "Invalid Strava activities payload" }),
					{
						status: 502,
						headers: { ...cors, "Content-Type": "application/json" },
					},
				);
			}
			const pageActivities = pagePayload;
			rawActivities.push(...pageActivities);

			if (pageActivities.length < 200) {
				break;
			}
			page++;
			await new Promise((r) => setTimeout(r, delayBetweenPagesMs));
		}

		// ---------------------------------------------------------------
		// Normalize and upsert activities
		// ---------------------------------------------------------------
		const errors: string[] = [];
		let syncedCount = 0;

		for (const raw of rawActivities) {
			try {
				const normalized = normalizeStravaActivity(raw);

				const { error: upsertError } = await supabase
					.from("external_activities")
					.upsert(
						{
							user_id: userId,
							...normalized,
							raw_data: raw,
							synced_at: new Date().toISOString(),
						},
						{ onConflict: "user_id,provider,external_id" },
					);

				if (upsertError) {
					errors.push(`Activity ${raw.id}: ${upsertError.message}`);
				} else {
					syncedCount++;
				}
			} catch (err) {
				errors.push(`Activity ${raw.id}: ${(err as Error).message}`);
			}
		}

		// ---------------------------------------------------------------
		// Update last_sync_at
		// ---------------------------------------------------------------
		await supabase
			.from("user_integrations")
			.update({ last_sync_at: new Date().toISOString(), error_message: null })
			.eq("user_id", userId)
			.eq("provider", "strava");

		// Update sync_queue entry if one exists
		await supabase
			.from("sync_queue")
			.update({
				status: errors.length > 0 ? "completed_with_errors" : "completed",
				completed_at: new Date().toISOString(),
			})
			.eq("user_id", userId)
			.eq("provider", "strava")
			.eq("status", "pending")
			.order("created_at", { ascending: false })
			.limit(1);

		return new Response(JSON.stringify({ synced_count: syncedCount, errors }), {
			headers: { ...cors, "Content-Type": "application/json" },
		});
	} catch (err) {
		console.error("Strava sync error:", err);
		return new Response(JSON.stringify({ error: (err as Error).message }), {
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}
});
