-- gamification_stats drift cleanup.
--
-- Findings from 2026-04-20 audit:
--   * Portal never SELECTs pr_count or best_streak from gamification_stats
--     (src/queries/profile.ts:172-187 explicitly lists the columns it reads).
--   * Portal computes bestStreak and prCount independently from
--     workout_sessions / personal_records (src/queries/profile.ts:39-90).
--   * Mobile PortalGamificationStatsSyncDto omits both fields — mobile does
--     not push authoritative values.
--   * No server-side trigger or procedure maintains either column.
--
-- Net: both columns are vestigial. They were being written via
-- COALESCE(rec.X, 0) in the LWW RPC (migration 20260420190710), which on
-- insert collapses mobile's NULL to 0 and on UPDATE overwrites any prior
-- server value with 0 — silently corrupting state if anything ever did
-- depend on them.
--
-- Fix (non-destructive):
--   1. Remove pr_count and best_streak from the upsert_gamification_stats_lww
--      INSERT column list and ON CONFLICT UPDATE SET. DEFAULT(0) fills them
--      on initial insert; subsequent upserts leave them alone.
--   2. Add column comments pointing future readers at the authoritative
--      source (portal computation from other tables).
--
-- Column drop is NOT performed here. Safer in a follow-up once we've
-- verified 30+ days of no external readers.

COMMENT ON COLUMN public.gamification_stats.pr_count IS
  'LEGACY / UNUSED. Portal computes PR count from personal_records; mobile '
  'does not push this field. Retained at DEFAULT 0 for schema stability. '
  'Do not add new writers — see src/queries/profile.ts for authoritative source.';

COMMENT ON COLUMN public.gamification_stats.best_streak IS
  'LEGACY / UNUSED. Duplicate of longest_streak. Portal computes bestStreak '
  'from workout_sessions; mobile does not push this field. Retained at '
  'DEFAULT 0 for schema stability.';

CREATE OR REPLACE FUNCTION public.upsert_gamification_stats_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  existing_ts timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.gamification_stats, p_rows)
  LOOP
    SELECT gs.updated_at INTO existing_ts
      FROM public.gamification_stats gs
      WHERE gs.user_id = rec.user_id;

    IF existing_ts IS NULL OR existing_ts <= rec.updated_at THEN
      -- pr_count and best_streak intentionally omitted — see column
      -- comments above. DEFAULT 0 fills them on initial insert; ON CONFLICT
      -- UPDATE leaves them untouched on every subsequent write.
      INSERT INTO public.gamification_stats AS gs (
        user_id, total_workouts, total_reps, total_volume_kg,
        total_time_seconds, current_streak, longest_streak, updated_at
      ) VALUES (
        rec.user_id,
        COALESCE(rec.total_workouts, 0),
        COALESCE(rec.total_reps, 0),
        COALESCE(rec.total_volume_kg, 0),
        COALESCE(rec.total_time_seconds, 0),
        COALESCE(rec.current_streak, 0),
        COALESCE(rec.longest_streak, 0),
        COALESCE(rec.updated_at, NOW())
      )
      ON CONFLICT (user_id) DO UPDATE SET
        total_workouts     = EXCLUDED.total_workouts,
        total_reps         = EXCLUDED.total_reps,
        total_volume_kg    = EXCLUDED.total_volume_kg,
        total_time_seconds = EXCLUDED.total_time_seconds,
        current_streak     = EXCLUDED.current_streak,
        longest_streak     = EXCLUDED.longest_streak,
        updated_at         = EXCLUDED.updated_at
      WHERE gs.updated_at <= EXCLUDED.updated_at;

      RETURN QUERY SELECT rec.user_id::text, TRUE,
        COALESCE(rec.updated_at, NOW());
    ELSE
      RETURN QUERY SELECT rec.user_id::text, FALSE, existing_ts;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_gamification_stats_lww(jsonb)
  TO authenticated, service_role;
