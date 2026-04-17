import JSZip from "jszip";
import { supabase } from "@/lib/supabase";

type ProgressCallback = (step: string, current: number, total: number) => void;

/**
 * Export all user-owned data as a downloadable ZIP file containing JSON files.
 * Implements GDPR Article 20 data portability requirements.
 *
 * Sensitive fields (billing provider IDs, OAuth tokens, API keys) are excluded.
 * Large tables (rep_telemetry) are paginated at 1000 rows per page.
 */
export async function exportAllUserData(
	userId: string,
	onProgress?: ProgressCallback,
): Promise<void> {
	const zip = new JSZip();
	const TOTAL_STEPS = 30;
	let step = 0;

	function progress(label: string) {
		step++;
		onProgress?.(label, step, TOTAL_STEPS);
	}

	async function addTable<T>(
		tableName: string,
		filename: string,
		query: PromiseLike<{ data: T[] | null; error: unknown }>,
	): Promise<T[] | null> {
		progress(`Exporting ${tableName}...`);
		const { data, error } = await query;
		if (error) {
			throw new Error(
				`Export failed for ${tableName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (data && data.length > 0) {
			zip.file(`${filename}.json`, JSON.stringify(data, null, 2));
		}
		return data;
	}

	try {
		// ──────────────────────────────────────
		// Direct user-owned tables
		// ──────────────────────────────────────

		// profiles — explicit select to exclude sensitive fields
		await addTable(
			"profiles",
			"profile",
			supabase
				.from("profiles")
				.select(
					"id, user_id, display_name, avatar_url, weight_unit, profile_visible, leaderboard_participation, push_notifications, email_digests, streak_reminders, challenge_updates, created_at, updated_at",
				)
				.eq("id", userId),
		);

		const workoutResult = await addTable(
			"workout_sessions",
			"workouts",
			supabase
				.from("workout_sessions")
				.select("*")
				.eq("user_id", userId)
				.order("started_at", { ascending: false }),
		);

		await addTable(
			"personal_records",
			"records",
			supabase.from("personal_records").select("*").eq("user_id", userId),
		);

		await addTable(
			"exercise_progress",
			"progress",
			supabase.from("exercise_progress").select("*").eq("user_id", userId),
		);

		const routineResult = await addTable(
			"routines",
			"routines",
			supabase.from("routines").select("*").eq("user_id", userId),
		);

		const cycleResult = await addTable(
			"training_cycles",
			"cycles",
			supabase.from("training_cycles").select("*").eq("user_id", userId),
		);

		await addTable(
			"user_goals",
			"goals",
			supabase.from("user_goals").select("*").eq("user_id", userId),
		);

		await addTable(
			"external_activities",
			"external-activities",
			supabase.from("external_activities").select("*").eq("user_id", userId),
		);

		// user_integrations — EXCLUDE sensitive token fields
		await addTable(
			"user_integrations",
			"integrations",
			supabase
				.from("user_integrations")
				.select(
					"id, user_id, provider, status, last_sync_at, connected_at, error_message, provider_user_id",
				)
				.eq("user_id", userId),
		);

		await addTable(
			"community_comments",
			"comments",
			supabase.from("community_comments").select("*").eq("user_id", userId),
		);

		await addTable(
			"community_votes",
			"votes",
			supabase.from("community_votes").select("*").eq("user_id", userId),
		);

		await addTable(
			"saved_community_items",
			"saved-items",
			supabase.from("saved_community_items").select("*").eq("user_id", userId),
		);

		await addTable(
			"challenge_participants",
			"challenges",
			supabase.from("challenge_participants").select("*").eq("user_id", userId),
		);

		// subscriptions — explicit select to exclude provider-specific fields
		await addTable(
			"subscriptions",
			"subscription",
			supabase
				.from("subscriptions")
				.select(
					"id, user_id, tier, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at",
				)
				.eq("user_id", userId),
		);

		await addTable(
			"user_onboarding",
			"onboarding",
			supabase.from("user_onboarding").select("*").eq("user_id", userId),
		);

		await addTable(
			"shared_routines",
			"shared-routines",
			supabase.from("shared_routines").select("*").eq("user_id", userId),
		);

		await addTable(
			"shared_cycles",
			"shared-cycles",
			supabase.from("shared_cycles").select("*").eq("user_id", userId),
		);

		await addTable(
			"earned_badges",
			"earned-badges",
			supabase.from("earned_badges").select("*").eq("user_id", userId),
		);

		await addTable(
			"gamification_stats",
			"gamification-stats",
			supabase.from("gamification_stats").select("*").eq("user_id", userId),
		);

		await addTable(
			"rpg_attributes",
			"rpg-attributes",
			supabase.from("rpg_attributes").select("*").eq("user_id", userId),
		);

		await addTable(
			"content_reports",
			"content-reports",
			supabase
				.from("content_reports")
				.select(
					"id, reporter_id, content_type, content_id, category, description, created_at",
				)
				.eq("reporter_id", userId),
		);

		await addTable(
			"creator_follows",
			"creator-follows",
			supabase.from("creator_follows").select("*").eq("follower_id", userId),
		);

		await addTable(
			"user_blocks",
			"user-blocks",
			supabase.from("user_blocks").select("*").eq("blocker_id", userId),
		);

		await addTable(
			"deletion_requests",
			"deletion-requests",
			supabase.from("deletion_requests").select("*").eq("user_id", userId),
		);

		// ──────────────────────────────────────
		// Nested data (joined through parent tables)
		// ──────────────────────────────────────

		// Exercises via workout IDs (exercises table does NOT have user_id)
		const workoutIds = workoutResult?.map((w) => w.id) ?? [];

		if (workoutIds.length > 0) {
			await addTable(
				"exercises",
				"exercises",
				supabase.from("exercises").select("*").in("session_id", workoutIds),
			);
		} else {
			progress("Skipping exercises (no workouts)...");
		}

		// Sets — direct user_id query (denormalized in Phase 15 DB-02)
		await addTable(
			"sets",
			"sets",
			supabase.from("sets").select("*").eq("user_id", userId),
		);

		// Rep summaries — direct user_id query (denormalized in Phase 15 DB-02)
		await addTable(
			"rep_summaries",
			"rep-summaries",
			supabase.from("rep_summaries").select("*").eq("user_id", userId),
		);

		// Rep telemetry — LARGE table, paginated at 1000 rows, direct user_id query
		progress("Exporting rep_telemetry (paginated)...");
		const PAGE_SIZE = 1000;
		const allTelemetry: Record<string, unknown>[] = [];
		let offset = 0;
		let hasMore = true;

		while (hasMore) {
			const { data, error } = await supabase
				.from("rep_telemetry")
				.select("*")
				.eq("user_id", userId)
				.range(offset, offset + PAGE_SIZE - 1);

			if (error) {
				console.warn("Failed to export rep_telemetry page:", error);
				break;
			}

			if (data && data.length > 0) {
				allTelemetry.push(...data);
				offset += PAGE_SIZE;
				hasMore = data.length === PAGE_SIZE;
			} else {
				hasMore = false;
			}
		}

		if (allTelemetry.length > 0) {
			zip.file("telemetry.json", JSON.stringify(allTelemetry, null, 2));
		}

		// Routine exercises via routine IDs
		const routineIds = routineResult?.map((r) => r.id) ?? [];

		if (routineIds.length > 0) {
			await addTable(
				"routine_exercises",
				"routine-exercises",
				supabase
					.from("routine_exercises")
					.select("*")
					.in("routine_id", routineIds),
			);
		} else {
			progress("Skipping routine exercises (no routines)...");
		}

		// Cycle days via cycle IDs
		const cycleIds = cycleResult?.map((c) => c.id) ?? [];

		if (cycleIds.length > 0) {
			await addTable(
				"cycle_days",
				"cycle-days",
				supabase
					.from("cycle_days")
					.select("*")
					.in("cycle_id", cycleIds),
			);
		} else {
			progress("Skipping cycle days (no training cycles)...");
		}

		// ──────────────────────────────────────
		// Generate and download ZIP
		// ──────────────────────────────────────

		const blob = await zip.generateAsync({ type: "blob" });

		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `phoenix-data-export-${new Date().toISOString().split("T")[0]}.zip`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	} catch (error) {
		console.error("Data export failed:", error);
		throw new Error(
			error instanceof Error
				? `Data export failed: ${error.message}`
				: "Data export failed unexpectedly",
		);
	}
}
