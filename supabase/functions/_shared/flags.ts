/**
 * Shared feature flags for Edge Functions.
 *
 * Flags are read once at cold-start from the Deno environment. To flip a
 * flag in a deployed environment, update the secret in Supabase Dashboard →
 * Edge Functions → Secrets, then redeploy the function. The flags module is
 * intentionally stateless so there is no runtime refresh path — a deploy is
 * the unit of rollout.
 */

/**
 * Gate the Last-Write-Wins upsert path in mobile-sync-push. When false
 * (default), the push handler uses its historical server-wins `.upsert()`
 * behavior. When true, the handler routes each shared-edit entity upsert
 * through the corresponding `upsert_<entity>_lww(p_rows jsonb)` RPC
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
export const SYNC_LWW_ENABLED =
	(Deno.env.get("SYNC_LWW_ENABLED") ?? "false").trim().toLowerCase() === "true";
