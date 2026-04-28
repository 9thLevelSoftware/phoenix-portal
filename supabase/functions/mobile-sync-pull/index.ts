import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { isValidLocalProfileId } from "../_shared/localProfileId.ts";
import { validatePullRequestShape } from "../_shared/mobileSyncPullRequest.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { readJsonObject } from "../_shared/requestValidation.ts";
import { requireSubscription } from "../_shared/requireSubscription.ts";

/**
 * Mobile Sync Pull — returns portal data modified since the client's last sync.
 *
 * POST /functions/v1/mobile-sync-pull
 * Authorization: Bearer <GoTrue JWT>
 * Body: {
 *   deviceId: string,
 *   lastSync?: number,
 *   profileId?: string,
 *   cursor?: string,          // Optional: pagination cursor from previous response
 *   pageSize?: number,        // Optional: entities per page (default 75, max 300)
 *   knownEntityIds?: {        // Optional: parity-based sync (new)
 *     sessionIds?: string[],
 *     routineIds?: string[],
 *     cycleIds?: string[],
 *     badgeIds?: string[],
 *     personalRecordIds?: string[]
 *   }
 * }
 *
 * Sync Modes:
 *   - Parity mode (new): client sends knownEntityIds → server returns entities NOT in those lists
 *   - Timestamp mode (legacy): client sends lastSync → server returns entities modified since
 *   - Full sync: neither provided → server returns all entities
 *
 * Pagination:
 *   - When cursor is absent, starts from the beginning
 *   - When cursor is present, resumes from that position
 *   - Entity types are paged in order: sessions → routines → cycles → badges → stats
 *   - Response includes nextCursor and hasMore for client to loop
 *   - Client should loop until hasMore: false before updating lastSyncTimestamp
 *
 * Backward Compatibility:
 *   - cursor and pageSize are optional with sensible defaults
 *   - Existing clients without pagination continue to work
 *   - lastSync still supported for timestamp-based filtering
 */

interface PullRequest {
	deviceId: string;
	/** @deprecated Use knownEntityIds for parity-based sync */
	lastSync?: number;
	profileId?: string;
	/** Optional cursor for pagination. If absent, starts from beginning. */
	cursor?: string;
	/** Optional page size. Defaults to 75. */
	pageSize?: number;
	/** Entity IDs client already has. Server returns entities NOT in these lists. */
	knownEntityIds?: {
		sessionIds?: string[];
		routineIds?: string[];
		cycleIds?: string[];
		/** Integer PKs (JSON may send numbers or numeric strings) */
		badgeIds?: (string | number)[];
		personalRecordIds?: (string | number)[];
	};
}

// Cursor ids must remain validated locally because decodeCursor runs before
// request body knownEntityIds validation.
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INT_STRING = /^\d+$/;

/**
 * Enforce MAX_PARITY_IDS on each parity list and reject with HTTP 413 if any
 * exceeds the cap. Resolves audit item #7 (2026-04-19). Client must chunk
 * long parity lists into <=MAX_PARITY_IDS batches.
 */
function enforceParityCaps(
	body: PullRequest,
	cors: Record<string, string>,
): Response | null {
	const k = body.knownEntityIds;
	if (!k) return null;
	const lists: Array<[string, unknown[] | undefined]> = [
		["sessionIds", k.sessionIds],
		["routineIds", k.routineIds],
		["cycleIds", k.cycleIds],
		["badgeIds", k.badgeIds],
		["personalRecordIds", k.personalRecordIds],
	];
	for (const [field, list] of lists) {
		if (list && list.length > MAX_PARITY_IDS) {
			return new Response(
				JSON.stringify({
					error: "parity_ids_exceeds_max",
					message: `knownEntityIds.${field} contains ${list.length} entries; maximum is ${MAX_PARITY_IDS} per request. Chunk the list client-side and issue multiple pull requests.`,
					field,
					maxBatch: MAX_PARITY_IDS,
					received: list.length,
				}),
				{
					status: 413,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}
	}
	return null;
}

function entityFetchErrorResponse(
	entity: string,
	error: { code?: string; message?: string; hint?: string },
	cors: Record<string, string>,
): Response {
	console.error(`Error fetching ${entity}:`, error);
	return new Response(
		JSON.stringify({
			error: `Failed to fetch ${entity}`,
			code: error.code ?? "UNKNOWN",
			details: error.message ?? error.hint ?? null,
		}),
		{
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		},
	);
}

/**
 * Determines if the request uses parity-based sync (new) or timestamp-based (legacy).
 * Parity mode is used when knownEntityIds is provided.
 */
function isParityMode(body: PullRequest): boolean {
	return !!body.knownEntityIds;
}

// ─── Pagination Configuration ───────────────────────────────────────

const DEFAULT_PAGE_SIZE = 75;
const MAX_PAGE_SIZE = 300;

/**
 * Maximum number of entity IDs the client may include in a single parity-based
 * pull request.
 *
 * UPDATE 2026-04-20: Now using RPC functions (get_sessions_excluding_ids, etc.)
 * which accept IDs in POST body instead of URL params. No more URL length limit.
 * Raised cap to 10,000 for power users with years of workout history.
 *
 * The RPC functions use PostgreSQL array parameters, which handle large arrays
 * efficiently via `id != ALL(p_known_ids)`.
 */
const MAX_PARITY_IDS = 10_000;

// Entity types in pagination order
type EntityType = "sessions" | "routines" | "cycles" | "badges" | "stats";
const ENTITY_ORDER: EntityType[] = [
	"sessions",
	"routines",
	"cycles",
	"badges",
	"stats",
];

interface DecodedCursor {
	type: EntityType;
	updatedAt: number; // epoch ms
	id: string;
}

/**
 * Encodes pagination state into an opaque cursor string.
 * Format: base64(JSON({type, updatedAt, id}))
 */
function encodeCursor(type: EntityType, updatedAt: number, id: string): string {
	const payload = JSON.stringify({ type, updatedAt, id });
	// Use btoa for base64 encoding (available in Deno)
	return btoa(payload);
}

/**
 * Decodes a cursor string back to pagination state.
 * Returns null if cursor is invalid or malformed.
 */
function decodeCursor(cursor: string): DecodedCursor | null {
	try {
		const decoded = atob(cursor);
		const parsed = JSON.parse(decoded);
		// Validate structure
		if (
			typeof parsed.type !== "string" ||
			!ENTITY_ORDER.includes(parsed.type as EntityType) ||
			typeof parsed.updatedAt !== "number" ||
			!Number.isFinite(parsed.updatedAt) ||
			typeof parsed.id !== "string"
		) {
			return null;
		}
		// Validate cursor id: UUID for sessions/routines/cycles; positive integer string for badges
		if (parsed.type === "badges") {
			if (
				typeof parsed.id !== "string" ||
				!POSITIVE_INT_STRING.test(parsed.id)
			) {
				return null;
			}
		} else {
			if (!UUID_REGEX.test(parsed.id)) {
				return null;
			}
		}
		return parsed as DecodedCursor;
	} catch {
		return null;
	}
}

Deno.serve(async (req) => {
	const cors = getCorsHeaders(req);

	// CORS preflight
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: cors });
	}

	// POST only
	if (req.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}

	try {
		// =========================================================================
		// 1. JWT verification — authenticate the mobile user
		// =========================================================================
		const authHeader = req.headers.get("Authorization");
		if (!authHeader) {
			return new Response(
				JSON.stringify({ error: "Missing Authorization header" }),
				{
					status: 401,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		const supabaseAuth = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_ANON_KEY")!,
			{ global: { headers: { Authorization: authHeader } } },
		);

		const {
			data: { user },
		} = await supabaseAuth.auth.getUser();

		if (!user) {
			return new Response(JSON.stringify({ error: "Not authenticated" }), {
				status: 401,
				headers: { ...cors, "Content-Type": "application/json" },
			});
		}

		const userId = user.id;

		// =========================================================================
		// 2. Service-role client for DB queries (bypasses RLS)
		// =========================================================================
		// SECURITY: Using service role key bypasses Row Level Security.
		// ALL queries MUST include .eq('user_id', userId) for user isolation.
		// Review any new query additions for this requirement.
		const supabase = createClient(
			Deno.env.get("SUPABASE_URL")!,
			Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
		);

		// =========================================================================
		// 3. Parse request body with pagination parameters
		// =========================================================================
		const parsedBody = await readJsonObject(req, cors);
		if (!parsedBody.ok) return parsedBody.response;
		const body = parsedBody.data as PullRequest;

		const invalidRequest = validatePullRequestShape(parsedBody.data, cors);
		if (invalidRequest) return invalidRequest;
		const profileId: string | null = body.profileId ?? null;

		// Validate profileId format to prevent injection attacks.
		// Accepts UUIDs plus the mobile-seeded "default" sentinel.
		// See _shared/localProfileId.ts for rationale.
		if (profileId && !isValidLocalProfileId(profileId)) {
			return new Response(
				JSON.stringify({ error: "Invalid profileId format" }),
				{
					status: 400,
					headers: { ...cors, "Content-Type": "application/json" },
				},
			);
		}

		// fix(audit #7): reject oversize parity lists with HTTP 413 so the client
		// can chunk. Prior behavior silently returned empty via an impossible-id
		// filter, which looked like a parity match and masked data-loss cases.
		const parityCapExceeded = enforceParityCaps(body, cors);
		if (parityCapExceeded) return parityCapExceeded;

		const rateCheck = await checkRateLimit(
			supabase,
			{
				key: "mobile-sync-pull",
				userId,
				maxRequests: 20,
				windowSeconds: 60,
			},
			cors,
		);
		if (!rateCheck.allowed) return rateCheck.response!;

		const emberGate = await requireSubscription(
			supabase,
			userId,
			"EMBER",
			cors,
		);
		if (!emberGate.allowed) return emberGate.response!;

		const lastSyncISO = new Date(body.lastSync ?? 0).toISOString();
		const syncTime = Date.now();

		// DIAGNOSTIC: Log incoming request parameters
		console.log("[PULL] Request:", {
			userId,
			parityMode: isParityMode(body),
			knownSessions: body.knownEntityIds?.sessionIds?.length ?? 0,
			knownRoutines: body.knownEntityIds?.routineIds?.length ?? 0,
			knownCycles: body.knownEntityIds?.cycleIds?.length ?? 0,
			knownBadges: body.knownEntityIds?.badgeIds?.length ?? 0,
			knownPersonalRecords: body.knownEntityIds?.personalRecordIds?.length ?? 0,
			lastSync: body.lastSync, // Legacy
			profileId,
			cursor: body.cursor,
		});

		// Pagination: parse cursor and pageSize with defaults
		const pageSize = Math.min(
			body.pageSize ?? DEFAULT_PAGE_SIZE,
			MAX_PAGE_SIZE,
		);
		const cursor = body.cursor ? decodeCursor(body.cursor) : null;

		// If cursor is provided but invalid, start fresh (stale cursor handling)
		const startType: EntityType = cursor?.type ?? "sessions";
		const startTypeIndex = ENTITY_ORDER.indexOf(startType);

		// Track pagination state for response
		let nextCursor: string | null = null;
		let hasMore = false;
		let remainingPageSize = pageSize;

		// Initialize result containers (will be populated as we page through entity types)
		let sessionDtos: Record<string, unknown>[] = [];
		let routineDtos: Record<string, unknown>[] = [];
		let cycleDtos: Record<string, unknown>[] = [];
		let badgeDtos: Record<string, unknown>[] = [];
		let gamificationDto: Record<string, unknown> | null = null;
		let rpgDto: Record<string, unknown> | null = null;
		let personalRecordDtos: Record<string, unknown>[] = [];
		let localProfiles: Record<string, unknown>[] = [];
		let externalActivityDtos: Record<string, unknown>[] = [];

		// =========================================================================
		// 4. Paginated fetch of entities in order: sessions → routines → cycles → badges → stats
		//    We fetch pageSize+1 to detect hasMore, then trim to pageSize.
		// =========================================================================

		// Helper to build cursor condition for stable ordering (updated_at ASC, id ASC)
		function buildCursorCondition(
			cursorData: DecodedCursor | null,
			entityType: EntityType,
		): {
			cursorUpdatedAt: string | null;
			cursorId: string | null;
		} {
			if (!cursorData || cursorData.type !== entityType) {
				return { cursorUpdatedAt: null, cursorId: null };
			}
			return {
				cursorUpdatedAt: new Date(cursorData.updatedAt).toISOString(),
				cursorId: cursorData.id,
			};
		}

		// ─── SESSIONS ───────────────────────────────────────────────────────────
		// Using RPC function to bypass URL length limits for large parity ID lists.
		// RPC uses POST body, so no limit on number of IDs (unlike .not().in() which uses GET).
		if (
			startTypeIndex <= ENTITY_ORDER.indexOf("sessions") &&
			remainingPageSize > 0
		) {
			const { cursorUpdatedAt, cursorId } = buildCursorCondition(
				cursor,
				"sessions",
			);
			const knownSessionIds = body.knownEntityIds?.sessionIds ?? [];

			// Use RPC for parity mode OR full sync. Legacy timestamp mode still uses direct query.
			const useRpc =
				knownSessionIds.length > 0 || !body.lastSync || body.lastSync === 0;

			let sessionsRaw: Record<string, unknown>[] = [];
			let sessionsError: {
				code?: string;
				message?: string;
				hint?: string;
			} | null = null;

			if (useRpc) {
				// RPC function handles: NOT IN filter, profile filter, cursor, ordering, limit
				const { data, error } = await supabase.rpc(
					"get_sessions_excluding_ids",
					{
						p_user_id: userId,
						p_known_ids: knownSessionIds,
						p_profile_id: profileId,
						p_cursor_updated_at: cursorUpdatedAt,
						p_cursor_id: cursorId,
						p_limit: remainingPageSize + 1, // +1 to detect hasMore
					},
				);
				sessionsRaw = (data as Record<string, unknown>[]) ?? [];
				sessionsError = error;
			} else {
				// Legacy timestamp-based mode (backward compatibility)
				let sessionsQuery = supabase
					.from("workout_sessions")
					.select("*")
					.eq("user_id", userId)
					.or(`updated_at.gt.${lastSyncISO},started_at.gt.${lastSyncISO}`)
					.order("updated_at", { ascending: true })
					.order("id", { ascending: true })
					.limit(remainingPageSize + 1);

				if (profileId) {
					if (profileId === "default") {
						sessionsQuery = sessionsQuery.is("local_profile_id", null);
					} else {
						sessionsQuery = sessionsQuery.or(
							`local_profile_id.eq.${profileId},local_profile_id.is.null`,
						);
					}
				}

				if (cursorUpdatedAt && cursorId) {
					sessionsQuery = sessionsQuery.or(
						`updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`,
					);
				}

				const { data, error } = await sessionsQuery;
				sessionsRaw = (data as Record<string, unknown>[]) ?? [];
				sessionsError = error;
			}

			if (sessionsError) {
				console.error("Error fetching sessions:", sessionsError);
				return new Response(
					JSON.stringify({
						error: "Failed to fetch workout sessions",
						code: sessionsError.code ?? "UNKNOWN",
						details: sessionsError.message ?? sessionsError.hint ?? null,
						parityIdCount: knownSessionIds.length,
					}),
					{
						status: 500,
						headers: { ...cors, "Content-Type": "application/json" },
					},
				);
			}

			// Check if there are more sessions
			if (sessionsRaw.length > remainingPageSize) {
				hasMore = true;
				const lastSession = sessionsRaw[remainingPageSize - 1];
				const updatedAtRaw = lastSession.updated_at ?? lastSession.started_at;
				const updatedAtMs = updatedAtRaw
					? new Date(updatedAtRaw as string).getTime()
					: Date.now();
				nextCursor = encodeCursor(
					"sessions",
					updatedAtMs,
					lastSession.id as string,
				);
				sessionsRaw.splice(remainingPageSize); // Trim to pageSize
			}

			// Fetch child records for sessions in this page
			const sessionIds = sessionsRaw.map(
				(s: Record<string, unknown>) => s.id as string,
			);
			let exercisesRaw: Record<string, unknown>[] = [];
			let setsRaw: Record<string, unknown>[] = [];
			let repSummariesRaw: Record<string, unknown>[] = [];

			if (sessionIds.length > 0) {
				const { data: exercises } = await supabase
					.from("exercises")
					.select("*")
					.in("session_id", sessionIds)
					.order("order_index", { ascending: true });
				exercisesRaw = exercises ?? [];

				const exerciseIds = exercisesRaw.map((e) => e.id as string);

				if (exerciseIds.length > 0) {
					const { data: sets } = await supabase
						.from("sets")
						.select("*")
						.in("exercise_id", exerciseIds);
					setsRaw = sets ?? [];

					const setIds = setsRaw.map((s) => s.id as string);

					if (setIds.length > 0) {
						const { data: repSums } = await supabase
							.from("rep_summaries")
							.select("*")
							.in("set_id", setIds);
						repSummariesRaw = repSums ?? [];
					}
				}
			}

			// Assemble nested session hierarchy
			const repSummariesBySetId = new Map<string, Record<string, unknown>[]>();
			for (const rs of repSummariesRaw) {
				const setId = rs.set_id as string;
				if (!repSummariesBySetId.has(setId)) {
					repSummariesBySetId.set(setId, []);
				}
				repSummariesBySetId.get(setId)?.push(rs);
			}

			const setsByExerciseId = new Map<string, Record<string, unknown>[]>();
			for (const s of setsRaw) {
				const exerciseId = s.exercise_id as string;
				if (!setsByExerciseId.has(exerciseId)) {
					setsByExerciseId.set(exerciseId, []);
				}
				const setRepSummaries = repSummariesBySetId.get(s.id as string) ?? [];
				setsByExerciseId.get(exerciseId)?.push({
					...s,
					_repSummaries: setRepSummaries,
				});
			}

			const exercisesBySessionId = new Map<string, Record<string, unknown>[]>();
			for (const e of exercisesRaw) {
				const sessionId = e.session_id as string;
				if (!exercisesBySessionId.has(sessionId)) {
					exercisesBySessionId.set(sessionId, []);
				}
				const exerciseSets = setsByExerciseId.get(e.id as string) ?? [];
				exercisesBySessionId.get(sessionId)?.push({
					...e,
					_sets: exerciseSets,
				});
			}

			sessionDtos = sessionsRaw.map((ws: Record<string, unknown>) => {
				const wsExercises = exercisesBySessionId.get(ws.id as string) ?? [];
				return {
					id: ws.id,
					userId: ws.user_id,
					name: ws.name,
					startedAt: ws.started_at,
					durationSeconds: ws.duration_seconds,
					totalVolume: ws.total_volume,
					setCount: ws.set_count,
					exerciseCount: ws.exercise_count,
					prCount: ws.pr_count,
					routineName: ws.routine_name,
					workoutMode: ws.workout_mode,
					routineSessionId: ws.routine_session_id,
					notes: ws.notes ?? null,
					// Phase 3.3 (audit item #1): server-canonical updatedAt for the
					// mobile-side LWW pull merge gate. Mobile parses this via
					// kotlin.time.Instant in PortalPullAdapter and feeds it to
					// SyncRepository.mergeSessionsLww as the per-session timestamp.
					updatedAt: ws.updated_at ?? null,
					avgVelocityMps: ws.avg_velocity_mps,
					avgAsymmetryPct: ws.avg_asymmetry_pct,
					velocityLossPct: ws.velocity_loss_pct,
					dominantSide: ws.dominant_side,
					strengthProfile: ws.strength_profile,
					formScore: ws.form_score,
					deloadWarnings: ws.deload_warnings,
					romViolations: ws.rom_violations,
					spotterActivations: ws.spotter_activations,
					peakForceN: ws.peak_force_n,
					estimatedCalories: ws.estimated_calories,
					heaviestLiftKg: ws.heaviest_lift_kg,
					eccentricLoad: ws.eccentric_load,
					echoLevel: ws.echo_level,
					warmupReps: ws.warmup_reps,
					workingReps: ws.working_reps,
					exercises: wsExercises.map((ex) => ({
						id: ex.id,
						sessionId: ex.session_id,
						name: ex.name,
						muscleGroup: ex.muscle_group,
						orderIndex: ex.order_index,
						sets: ((ex._sets as Record<string, unknown>[]) ?? []).map((st) => ({
							id: st.id,
							exerciseId: st.exercise_id,
							setNumber: st.set_number,
							targetReps: st.target_reps,
							actualReps: st.actual_reps,
							weightKg: st.weight_kg,
							rpe: st.rpe,
							isPr: st.is_pr,
							notes: st.notes,
							workoutMode: st.workout_mode,
							repSummaries: (
								(st._repSummaries as Record<string, unknown>[]) ?? []
							).map((rs) => ({
								id: rs.id,
								setId: rs.set_id,
								repNumber: rs.rep_number,
								meanVelocityMps: rs.mean_velocity_mps,
								peakVelocityMps: rs.peak_velocity_mps,
								meanForceN: rs.mean_force_n,
								peakForceN: rs.peak_force_n,
								powerWatts: rs.power_watts,
								romMm: rs.rom_mm,
								tutMs: rs.tut_ms,
								leftForceAvg: rs.left_force_avg,
								rightForceAvg: rs.right_force_avg,
								asymmetryPct: rs.asymmetry_pct,
								vbtZone: rs.vbt_zone,
							})),
						})),
					})),
				};
			});

			remainingPageSize -= sessionDtos.length;
		}

		// ─── ROUTINES ───────────────────────────────────────────────────────────
		// Using RPC function to bypass URL length limits for large parity ID lists.
		if (
			!hasMore &&
			startTypeIndex <= ENTITY_ORDER.indexOf("routines") &&
			remainingPageSize > 0
		) {
			const { cursorUpdatedAt, cursorId } = buildCursorCondition(
				cursor,
				"routines",
			);
			const knownRoutineIds = body.knownEntityIds?.routineIds ?? [];

			const useRpc =
				knownRoutineIds.length > 0 || !body.lastSync || body.lastSync === 0;

			let routinesData: Record<string, unknown>[] = [];

			if (useRpc) {
				const { data, error } = await supabase.rpc(
					"get_routines_excluding_ids",
					{
						p_user_id: userId,
						p_known_ids: knownRoutineIds,
						p_profile_id: profileId,
						p_cursor_updated_at: cursorUpdatedAt,
						p_cursor_id: cursorId,
						p_limit: remainingPageSize + 1,
						p_last_sync_at: lastSyncISO,
					},
				);
				if (error) return entityFetchErrorResponse("routines", error, cors);
				routinesData = (data as Record<string, unknown>[]) ?? [];
			} else {
				// Legacy timestamp-based mode
				let routinesQuery = supabase
					.from("routines")
					.select("*")
					.eq("user_id", userId)
					.gt("updated_at", lastSyncISO)
					.order("updated_at", { ascending: true })
					.order("id", { ascending: true })
					.limit(remainingPageSize + 1);

				if (profileId) {
					if (profileId === "default") {
						routinesQuery = routinesQuery.is("local_profile_id", null);
					} else {
						routinesQuery = routinesQuery.or(
							`local_profile_id.eq.${profileId},local_profile_id.is.null`,
						);
					}
				}

				if (cursorUpdatedAt && cursorId) {
					routinesQuery = routinesQuery.or(
						`updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`,
					);
				}

				const { data, error } = await routinesQuery;
				if (error) return entityFetchErrorResponse("routines", error, cors);
				routinesData = (data as Record<string, unknown>[]) ?? [];
			}

			if (routinesData.length > remainingPageSize) {
				hasMore = true;
				const lastRoutine = routinesData[remainingPageSize - 1];
				const updatedAtMs = new Date(
					lastRoutine.updated_at as string,
				).getTime();
				nextCursor = encodeCursor(
					"routines",
					updatedAtMs,
					lastRoutine.id as string,
				);
				routinesData.splice(remainingPageSize);
			}

			// Fetch routine exercises
			const routineIds = routinesData.map(
				(r: Record<string, unknown>) => r.id as string,
			);
			let routineExercisesRaw: Record<string, unknown>[] = [];
			if (routineIds.length > 0) {
				const { data: re, error: routineExercisesError } = await supabase
					.from("routine_exercises")
					.select("*")
					.in("routine_id", routineIds);
				if (routineExercisesError) {
					return entityFetchErrorResponse(
						"routine exercises",
						routineExercisesError,
						cors,
					);
				}
				routineExercisesRaw = re ?? [];
			}

			const reByRoutineId = new Map<string, Record<string, unknown>[]>();
			for (const re of routineExercisesRaw) {
				const routineId = re.routine_id as string;
				if (!reByRoutineId.has(routineId)) {
					reByRoutineId.set(routineId, []);
				}
				reByRoutineId.get(routineId)?.push(re);
			}

			routineDtos = routinesData.map((r: Record<string, unknown>) => {
				const rExercises = reByRoutineId.get(r.id as string) ?? [];
				return {
					id: r.id,
					userId: r.user_id,
					name: r.name,
					description: r.description,
					exerciseCount: r.exercise_count,
					estimatedDuration: r.estimated_duration,
					timesCompleted: r.times_completed,
					isFavorite: r.is_favorite,
					updatedAt: r.updated_at
						? new Date(r.updated_at as string).getTime()
						: null,
					exercises: rExercises.map((re) => ({
						id: re.id,
						routineId: re.routine_id,
						name: re.name,
						muscleGroup: re.muscle_group,
						sets: re.sets,
						reps: re.reps,
						weight: re.weight,
						restSeconds: re.rest_seconds,
						mode: re.mode,
						orderIndex: re.order_index,
						supersetId: re.superset_id,
						supersetColor: re.superset_color,
						supersetOrder: re.superset_order,
						perSetWeights:
							re.per_set_weights != null
								? JSON.stringify(re.per_set_weights)
								: null,
						perSetRest:
							re.per_set_rest != null ? JSON.stringify(re.per_set_rest) : null,
						perSetReps:
							re.per_set_reps != null ? JSON.stringify(re.per_set_reps) : null,
						isAmrap: re.is_amrap,
						isBodyweight: re.is_bodyweight ?? false,
						prPercentage: re.pr_percentage,
						repCountTiming: re.rep_count_timing,
						stopAtPosition: re.stop_at_position,
						stallDetection: re.stall_detection,
						eccentricLoad: re.eccentric_load,
						echoLevel: re.echo_level,
						perSetEchoLevels: re.per_set_echo_levels ?? null,
						warmupSets: re.warmup_sets ?? null,
					})),
				};
			});

			remainingPageSize -= routineDtos.length;
		}

		// ─── CYCLES ─────────────────────────────────────────────────────────────
		// Using RPC function to bypass URL length limits for large parity ID lists.
		if (
			!hasMore &&
			startTypeIndex <= ENTITY_ORDER.indexOf("cycles") &&
			remainingPageSize > 0
		) {
			const { cursorUpdatedAt, cursorId } = buildCursorCondition(
				cursor,
				"cycles",
			);
			const knownCycleIds = body.knownEntityIds?.cycleIds ?? [];

			const useRpc =
				knownCycleIds.length > 0 || !body.lastSync || body.lastSync === 0;

			let cyclesData: Record<string, unknown>[] = [];

			if (useRpc) {
				const { data, error } = await supabase.rpc("get_cycles_excluding_ids", {
					p_user_id: userId,
					p_known_ids: knownCycleIds,
					p_profile_id: profileId,
					p_cursor_updated_at: cursorUpdatedAt,
					p_cursor_id: cursorId,
					p_limit: remainingPageSize + 1,
					p_last_sync_at: lastSyncISO,
				});
				if (error) return entityFetchErrorResponse("cycles", error, cors);
				cyclesData = (data as Record<string, unknown>[]) ?? [];
			} else {
				// Legacy timestamp-based mode
				let cyclesQuery = supabase
					.from("training_cycles")
					.select("*")
					.eq("user_id", userId)
					.gt("updated_at", lastSyncISO)
					.order("updated_at", { ascending: true })
					.order("id", { ascending: true })
					.limit(remainingPageSize + 1);

				if (profileId) {
					if (profileId === "default") {
						cyclesQuery = cyclesQuery.is("local_profile_id", null);
					} else {
						cyclesQuery = cyclesQuery.or(
							`local_profile_id.eq.${profileId},local_profile_id.is.null`,
						);
					}
				}

				if (cursorUpdatedAt && cursorId) {
					cyclesQuery = cyclesQuery.or(
						`updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`,
					);
				}

				const { data, error } = await cyclesQuery;
				if (error) return entityFetchErrorResponse("cycles", error, cors);
				cyclesData = (data as Record<string, unknown>[]) ?? [];
			}

			if (cyclesData.length > remainingPageSize) {
				hasMore = true;
				const lastCycle = cyclesData[remainingPageSize - 1];
				const updatedAtMs = new Date(lastCycle.updated_at as string).getTime();
				nextCursor = encodeCursor(
					"cycles",
					updatedAtMs,
					lastCycle.id as string,
				);
				cyclesData.splice(remainingPageSize);
			}

			// Fetch cycle days
			const cycleIds = cyclesData.map(
				(c: Record<string, unknown>) => c.id as string,
			);
			let cycleDaysRaw: Record<string, unknown>[] = [];
			if (cycleIds.length > 0) {
				const { data: cd, error: cycleDaysError } = await supabase
					.from("cycle_days")
					.select("*")
					.in("cycle_id", cycleIds);
				if (cycleDaysError) {
					return entityFetchErrorResponse("cycle days", cycleDaysError, cors);
				}
				cycleDaysRaw = cd ?? [];
			}

			const daysByCycleId = new Map<string, Record<string, unknown>[]>();
			for (const d of cycleDaysRaw) {
				const cycleId = d.cycle_id as string;
				if (!daysByCycleId.has(cycleId)) {
					daysByCycleId.set(cycleId, []);
				}
				daysByCycleId.get(cycleId)?.push(d);
			}

			cycleDtos = cyclesData.map((c: Record<string, unknown>) => {
				const cDays = daysByCycleId.get(c.id as string) ?? [];
				return {
					id: c.id,
					userId: c.user_id,
					name: c.name,
					description: c.description,
					durationWeeks: c.duration_weeks,
					workoutDays: c.workout_days,
					restDays: c.rest_days,
					currentWeek: c.current_week,
					status: c.status,
					startedAt: c.started_at,
					lastUsedAt: c.last_used_at,
					progressionSettings:
						c.progression_settings != null
							? JSON.stringify(c.progression_settings)
							: null,
					deloadSettings:
						c.deload_settings != null
							? JSON.stringify(c.deload_settings)
							: null,
					days: cDays.map((d) => ({
						id: d.id,
						cycleId: d.cycle_id,
						dayNumber: d.day_number,
						dayType: d.day_type,
						routineId: d.routine_id,
						weightAdjustment: d.weight_adjustment,
						repModifier: d.rep_modifier,
						restOverride: d.rest_override,
						restType: d.rest_type,
						notes: d.notes,
					})),
				};
			});

			remainingPageSize -= cycleDtos.length;
		}

		// ─── BADGES ─────────────────────────────────────────────────────────────
		// Using RPC function to bypass URL length limits for large parity ID lists.
		if (
			!hasMore &&
			startTypeIndex <= ENTITY_ORDER.indexOf("badges") &&
			remainingPageSize > 0
		) {
			const { cursorUpdatedAt, cursorId } = buildCursorCondition(
				cursor,
				"badges",
			);
			const knownBadgeIds = (body.knownEntityIds?.badgeIds ?? []).map((x) =>
				typeof x === "number" ? x : parseInt(String(x), 10),
			);

			const useRpc =
				knownBadgeIds.length > 0 || !body.lastSync || body.lastSync === 0;

			let badgesData: Record<string, unknown>[] = [];

			if (useRpc) {
				const { data, error } = await supabase.rpc("get_badges_excluding_ids", {
					p_user_id: userId,
					p_known_ids: knownBadgeIds,
					p_cursor_earned_at: cursorUpdatedAt,
					p_cursor_id: cursorId ? parseInt(cursorId, 10) : null,
					p_limit: remainingPageSize + 1,
				});
				if (error) return entityFetchErrorResponse("badges", error, cors);
				badgesData = (data as Record<string, unknown>[]) ?? [];
			} else {
				// Legacy timestamp-based mode
				let badgesQuery = supabase
					.from("earned_badges")
					.select("*")
					.eq("user_id", userId)
					.gt("earned_at", lastSyncISO)
					.order("earned_at", { ascending: true })
					.order("id", { ascending: true })
					.limit(remainingPageSize + 1);

				if (cursorUpdatedAt && cursorId) {
					badgesQuery = badgesQuery.or(
						`earned_at.gt.${cursorUpdatedAt},and(earned_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`,
					);
				}

				const { data, error } = await badgesQuery;
				if (error) return entityFetchErrorResponse("badges", error, cors);
				badgesData = (data as Record<string, unknown>[]) ?? [];
			}

			if (badgesData.length > remainingPageSize) {
				hasMore = true;
				const lastBadge = badgesData[remainingPageSize - 1];
				const earnedAtMs = new Date(lastBadge.earned_at as string).getTime();
				nextCursor = encodeCursor("badges", earnedAtMs, String(lastBadge.id));
				badgesData.splice(remainingPageSize);
			}

			badgeDtos = badgesData.map((b: Record<string, unknown>) => ({
				id: b.id,
				userId: b.user_id,
				badgeId: b.badge_id,
				badgeName: b.badge_name,
				badgeDescription: b.badge_description,
				badgeTier: b.badge_tier,
				earnedAt: b.earned_at,
			}));

			remainingPageSize -= badgeDtos.length;
		}

		// ─── STATS (RPG + Gamification) ─────────────────────────────────────────
		// Stats are singleton records per user, so we fetch them on the final page
		if (!hasMore && startTypeIndex <= ENTITY_ORDER.indexOf("stats")) {
			// RPG attributes (delta sync)
			const { data: rpgAttributes, error: rpgAttributesError } = await supabase
				.from("rpg_attributes")
				.select("*")
				.eq("user_id", userId)
				.gt("updated_at", lastSyncISO)
				.maybeSingle();
			if (rpgAttributesError) {
				return entityFetchErrorResponse(
					"RPG attributes",
					rpgAttributesError,
					cors,
				);
			}

			rpgDto = rpgAttributes
				? {
						id: rpgAttributes.id,
						userId: rpgAttributes.user_id,
						// fix(audit #8): defensively round integer fields before wire send
						// so kotlinx.serialization on mobile cannot see a float in an Int
						// slot. See _shared/rpgSchema.ts for the contract.
						strength: Math.round(Number(rpgAttributes.strength ?? 0)),
						power: Math.round(Number(rpgAttributes.power ?? 0)),
						stamina: Math.round(Number(rpgAttributes.stamina ?? 0)),
						consistency: Math.round(Number(rpgAttributes.consistency ?? 0)),
						mastery: Math.round(Number(rpgAttributes.mastery ?? 0)),
						characterClass: rpgAttributes.character_class,
						level: Math.round(Number(rpgAttributes.level ?? 1)),
						experiencePoints: Math.round(
							Number(rpgAttributes.experience_points ?? 0),
						),
						updatedAt: rpgAttributes.updated_at,
					}
				: null;

			// Gamification stats (delta sync)
			const { data: gamificationStats, error: gamificationStatsError } =
				await supabase
					.from("gamification_stats")
					.select("*")
					.eq("user_id", userId)
					.gt("updated_at", lastSyncISO)
					.maybeSingle();
			if (gamificationStatsError) {
				return entityFetchErrorResponse(
					"gamification stats",
					gamificationStatsError,
					cors,
				);
			}

			gamificationDto = gamificationStats
				? {
						id: gamificationStats.id,
						userId: gamificationStats.user_id,
						totalWorkouts: gamificationStats.total_workouts,
						totalReps: gamificationStats.total_reps,
						totalVolumeKg: gamificationStats.total_volume_kg,
						longestStreak: gamificationStats.longest_streak,
						currentStreak: gamificationStats.current_streak,
						totalTimeSeconds: gamificationStats.total_time_seconds,
						updatedAt: gamificationStats.updated_at,
					}
				: null;

			// Personal records (always fetched on final page)
			// Using RPC function to bypass URL length limits for large parity ID lists.
			const knownPRIds = (body.knownEntityIds?.personalRecordIds ?? []).map(
				(x) => (typeof x === "number" ? x : parseInt(String(x), 10)),
			);

			const useRpcPR =
				knownPRIds.length > 0 || !body.lastSync || body.lastSync === 0;

			let personalRecordsData: Record<string, unknown>[] = [];

			if (useRpcPR) {
				const { data, error } = await supabase.rpc(
					"get_personal_records_excluding_ids",
					{
						p_user_id: userId,
						p_known_ids: knownPRIds,
						p_profile_id: profileId,
					},
				);
				if (error) {
					return entityFetchErrorResponse("personal records", error, cors);
				}
				personalRecordsData = (data as Record<string, unknown>[]) ?? [];
			} else {
				// Legacy timestamp-based mode
				let personalRecordsQuery = supabase
					.from("personal_records")
					.select("*")
					.eq("user_id", userId)
					.gt("updated_at", lastSyncISO);

				if (profileId) {
					if (profileId === "default") {
						personalRecordsQuery = personalRecordsQuery.is(
							"local_profile_id",
							null,
						);
					} else {
						personalRecordsQuery = personalRecordsQuery.or(
							`local_profile_id.eq.${profileId},local_profile_id.is.null`,
						);
					}
				}

				const { data, error } = await personalRecordsQuery;
				if (error) {
					return entityFetchErrorResponse("personal records", error, cors);
				}
				personalRecordsData = (data as Record<string, unknown>[]) ?? [];
			}

			personalRecordDtos = personalRecordsData.map(
				(pr: Record<string, unknown>) => ({
					id: pr.id,
					userId: pr.user_id,
					exerciseName: pr.exercise_name,
					muscleGroup: pr.muscle_group,
					recordType: pr.record_type,
					value: pr.value,
					weightKg: pr.weight_kg,
					reps: pr.reps,
					workoutPhase: pr.workout_phase,
					sessionId: pr.session_id,
					achievedAt: pr.achieved_at,
					updatedAt: pr.updated_at,
				}),
			);

			// Local profiles (always included on final page)
			const { data: profilesData, error: profilesError } = await supabase
				.from("local_profiles")
				.select("id, name, color_index, device_id, created_at, updated_at")
				.eq("user_id", userId);
			if (profilesError) {
				return entityFetchErrorResponse("local profiles", profilesError, cors);
			}
			// Transform to camelCase for mobile DTO compatibility
			localProfiles = (profilesData ?? []).map(
				(p: Record<string, unknown>) => ({
					id: p.id,
					name: p.name,
					colorIndex: p.color_index,
				}),
			);

			// External activities (EMBER+ enforced at handler start)
			const { data: externalActivitiesRaw, error: externalActivitiesError } =
				await supabase
					.from("external_activities")
					.select("*")
					.eq("user_id", userId)
					.gt("synced_at", lastSyncISO);
			if (externalActivitiesError) {
				return entityFetchErrorResponse(
					"external activities",
					externalActivitiesError,
					cors,
				);
			}

			externalActivityDtos = (externalActivitiesRaw ?? []).map(
				(a: Record<string, unknown>) => ({
					id: a.id,
					externalId: a.external_id,
					provider: a.provider,
					name: a.name,
					activityType: a.activity_type,
					startedAt: a.started_at,
					durationSeconds: a.duration_seconds,
					distanceMeters: a.distance_meters,
					calories: a.calories,
					avgHeartRate: a.avg_heart_rate,
					maxHeartRate: a.max_heart_rate,
					elevationGainMeters: a.elevation_gain_meters,
					rawData: a.raw_data != null ? JSON.stringify(a.raw_data) : null,
				}),
			);
		}

		// =========================================================================
		// 6. Return paginated response with cursor metadata
		// =========================================================================
		const response = {
			syncTime,
			// Pagination metadata (optional for backward compatibility)
			nextCursor: nextCursor ?? undefined,
			hasMore,
			// Entity data
			sessions: sessionDtos,
			routines: routineDtos,
			cycles: cycleDtos,
			personalRecords: personalRecordDtos,
			rpgAttributes: rpgDto,
			badges: badgeDtos,
			gamificationStats: gamificationDto,
			localProfiles: localProfiles,
			externalActivities: externalActivityDtos,
		};

		console.log("[PULL] Response:", {
			sessions: sessionDtos.length,
			routines: routineDtos.length,
			cycles: cycleDtos.length,
			badges: badgeDtos.length,
			hasMore,
		});

		return new Response(JSON.stringify(response), {
			headers: { ...cors, "Content-Type": "application/json" },
		});
	} catch (err) {
		console.error("mobile-sync-pull error:", err);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { ...cors, "Content-Type": "application/json" },
		});
	}
});
