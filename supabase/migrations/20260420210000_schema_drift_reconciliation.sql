-- Migration: Schema drift reconciliation
--
-- Repairs drift between supabase_migrations.schema_migrations entries and
-- actual production schema. Multiple upstream migrations were recorded as
-- applied but their DDL was never (or only partially) executed against
-- prod. This migration re-applies only the verified-missing artifacts;
-- every statement is idempotent so a full re-run is a no-op.
--
-- Drift sources repaired here:
--   20260317143000 routine_exercise_bodyweight_duration
--     - is_bodyweight + duration_seconds columns missing from routine_exercises
--   20260329120000 finalize_insights_benchmarks_rls
--     - old "Anyone can read benchmarks" still present; tightening never ran
--
-- Not repaired here (already applied via dashboard):
--   20260324130000 (function search_path hardening) — all 7 funcs SET search_path=''
--   20260412 (leaderboard RPCs + table) — all artifacts present
--   20260324120000 telemetry_points view + profiles policy — both present
--
-- Intentionally deferred:
--   20260324120000 creator_stats — upstream migration assumed a regular
--   view; production has a MATERIALIZED view with an active cron refresh.
--   Converting requires product-level decision (cron drop + perf cost)
--   and must not be silent inside a drift fix.

BEGIN;

-- ============================================================
-- 1. routine_exercises: bodyweight + duration (20260317143000)
-- ============================================================
ALTER TABLE public.routine_exercises
  ADD COLUMN IF NOT EXISTS is_bodyweight BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duration_seconds INT;

COMMENT ON COLUMN public.routine_exercises.is_bodyweight IS
  'When true, exercise uses bodyweight only with no external load.';
COMMENT ON COLUMN public.routine_exercises.duration_seconds IS
  'Duration in seconds for time-based exercises; NULL means rep-based.';

-- ============================================================
-- 2. community_benchmarks + user_insights RLS (20260329120000)
--    Tighten "Anyone can read" to authenticated-only and remove
--    dead-code service-role policies (service_role bypasses RLS).
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read benchmarks" ON public.community_benchmarks;
DROP POLICY IF EXISTS "Authenticated users can read benchmarks" ON public.community_benchmarks;

CREATE POLICY "Authenticated users can read benchmarks"
  ON public.community_benchmarks FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage insights" ON public.user_insights;
DROP POLICY IF EXISTS "Service role can manage benchmarks" ON public.community_benchmarks;

COMMIT;
