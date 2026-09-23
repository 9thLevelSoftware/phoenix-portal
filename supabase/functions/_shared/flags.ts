/**
 * Shared feature flags for Edge Functions.
 *
 * Flags are read once at cold-start from the Deno environment. To flip a
 * flag in a deployed environment, update the secret in Supabase Dashboard →
 * Edge Functions → Secrets, then redeploy the function. The flags module is
 * intentionally stateless so there is no runtime refresh path — a deploy is
 * the unit of rollout.
 */

/** A boolean flag: on only when the secret is "true" (trimmed, any case). */
function parseBoolFlag(name: string): boolean {
	return (Deno.env.get(name) ?? "false").trim().toLowerCase() === "true";
}

/**
 * Gate the Last-Write-Wins upsert path in mobile-sync-push. When false
 * (default), the push handler uses last-push-wins `.upsert()` — the incoming
 * push overwrites the server row on `id`. When true, the handler routes each
 * shared-edit entity upsert through the corresponding
 * `upsert_<entity>_lww(p_rows jsonb)` RPC
 * (Phase 3.1 migration, 20260419120000_lww_upsert_functions.sql) and
 * returns per-entity `rejections` in the response so the mobile client can
 * detect stale-push cases and log them.
 *
 * Rollout plan (Phase 3.4):
 *   1. Apply migration to staging (functions unused while flag OFF).
 *   2. Set `SYNC_LWW_ENABLED=true` in staging; run one-week soak.
 *   3. Enable in production; monitor rejection-rate telemetry for 72h.
 *   4. After ≥70% mobile rollout has the Phase 3.3 LWW pull merge, remove
 *      the flag entirely and inline the LWW path.
 *
 * Resolves audit item #1 when combined with Phases 3.3 and 3.4. See
 * phoenix-portal/docs/dto-drift-matrix.md.
 */
export const SYNC_LWW_ENABLED = parseBoolFlag("SYNC_LWW_ENABLED");

/**
 * Run the mobile push's whole write sequence in ONE Postgres transaction
 * (F-014). When false (default) every write is its own PostgREST request, as
 * before, so a failure part-way through leaves the earlier writes committed
 * and the device retries (503 partial_write_retry). When true, the handler
 * opens a connection with SUPABASE_DB_URL and runs the same Design K calls
 * inside BEGIN … COMMIT (see _shared/pushTransaction.ts): a failure commits
 * nothing, and the broadcast happens only after COMMIT. A push must commit
 * within PUSH_TRANSACTION_TIMEOUT_MS (100 s, inside the pull's two-minute
 * re-read overlap) or Postgres ends it and the device retries. Exactly
 * "true" enables it; the response contract is identical either way.
 */
export const SYNC_PUSH_TRANSACTION = parseBoolFlag("SYNC_PUSH_TRANSACTION");
