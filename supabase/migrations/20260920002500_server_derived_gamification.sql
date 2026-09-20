-- Server-derived gamification counters (F-070, F-094, R-12, R-26).
--
-- Who owns each gamification_stats / rpg_attributes column after this
-- migration:
--
--   SERVER-DERIVED (recomputed from the rows the server stores; a device
--   value for these is ignored, so an inflated push cannot stick and a
--   delete lowers the total):
--     gamification_stats.total_workouts     count(workout_sessions)
--     gamification_stats.total_volume_kg    sum(workout_sessions.total_volume)
--                                           (per cable as stored, KD-8 — never doubled)
--     gamification_stats.total_time_seconds sum(workout_sessions.duration_seconds)
--     gamification_stats.total_reps         sum(sets.actual_reps) over the
--                                           user's sessions (sets -> exercises
--                                           -> workout_sessions)
--     gamification_stats.pr_count           count(personal_records
--                                           WHERE deleted_at IS NULL)
--
--   MONOTONIC (a best-ever value cannot go down, so a stale device can never
--   lower it — GREATEST(existing, incoming)):
--     gamification_stats.longest_streak
--     gamification_stats.best_streak        (prod duplicate of longest_streak,
--                                            read by get_profile_stats)
--
--   DEVICE-OWNED (not derivable from server rows; taken from whichever write
--   carries the later last-workout date, see last_workout_at below):
--     gamification_stats.current_streak
--     rpg_attributes.strength/power/stamina/consistency/mastery
--     rpg_attributes.character_class/level/experience_points
--
--   SERVER BOOKKEEPING:
--     *.updated_at        server stamp of the last row change. It is the
--                         delta-sync cursor mobile-sync-pull filters on
--                         (`.gt('updated_at', lastSync)`), NOT the conflict
--                         key any more (F-070: comparing a server stamp made
--                         every push win against itself, and a recompute
--                         would have frozen out every later device write).
--     *.last_workout_at   the last-workout date the write carried. The Edge
--                         function derives it from the pushed sessions
--                         (max started_at); NULL when the push carried no
--                         session (older app versions and stats-only pushes),
--                         which is treated as "no opinion" and accepted.
--
-- The two dashboard counter triggers captured by 20260920000200
-- (trg_update_profile_stats_on_workout, trg_update_pr_count_on_record) are
-- dropped here: they only ever ADDED to the counters, so a re-push, a delete
-- or a corrected session left the totals permanently too high (R-26), which
-- is exactly the drift recompute_gamification_stats() now removes. Their
-- functions are kept (service_role only) so 20260920000200 stays applicable
-- and the capture test still finds them; only the triggers go.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS, guarded CREATE TRIGGER.

-- ---------------------------------------------------------------------------
-- 1. last_workout_at — the device-owned conflict key
-- ---------------------------------------------------------------------------
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS last_workout_at timestamptz;
ALTER TABLE public.rpg_attributes
  ADD COLUMN IF NOT EXISTS last_workout_at timestamptz;

COMMENT ON COLUMN public.gamification_stats.last_workout_at IS
  'Last-workout date carried by the write that set the device-owned columns '
  '(current_streak). Derived by mobile-sync-push from the pushed sessions; '
  'NULL means the write carried no session. Conflict key for '
  'upsert_gamification_stats_lww — updated_at is a server stamp, not a clock '
  'to compare (F-070).';
COMMENT ON COLUMN public.rpg_attributes.last_workout_at IS
  'Last-workout date carried by the write that set this row. Conflict key for '
  'upsert_rpg_attributes_lww (F-070).';

COMMENT ON COLUMN public.gamification_stats.pr_count IS
  'SERVER-DERIVED: count(personal_records WHERE deleted_at IS NULL), '
  'maintained by recompute_gamification_stats(). Devices do not push it.';
COMMENT ON COLUMN public.gamification_stats.best_streak IS
  'Monotonic duplicate of longest_streak kept for get_profile_stats. '
  'GREATEST(existing, incoming) — a stale device can never lower it.';

-- ---------------------------------------------------------------------------
-- 2. recompute_gamification_stats — the single derivation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_gamification_stats(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total_workouts bigint;
  v_total_volume   numeric;
  v_total_time     bigint;
  v_total_reps     bigint;
  v_pr_count       integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*),
         COALESCE(sum(ws.total_volume), 0),
         COALESCE(sum(ws.duration_seconds), 0)
    INTO v_total_workouts, v_total_volume, v_total_time
    FROM public.workout_sessions ws
   WHERE ws.user_id = p_user_id;

  -- Reps live on the sets, reached through the session so a deleted session
  -- (ON DELETE CASCADE) drops its reps with it.
  SELECT COALESCE(sum(s.actual_reps), 0)
    INTO v_total_reps
    FROM public.sets s
    JOIN public.exercises e ON e.id = s.exercise_id
    JOIN public.workout_sessions ws ON ws.id = e.session_id
   WHERE ws.user_id = p_user_id;

  SELECT count(*)
    INTO v_pr_count
    FROM public.personal_records pr
   WHERE pr.user_id = p_user_id
     AND pr.deleted_at IS NULL;

  UPDATE public.gamification_stats gs
     SET total_workouts     = v_total_workouts,
         total_volume_kg    = v_total_volume,
         total_time_seconds = v_total_time,
         total_reps         = v_total_reps,
         pr_count           = v_pr_count,
         updated_at         = now()
   WHERE gs.user_id = p_user_id
     AND (gs.total_workouts, gs.total_volume_kg, gs.total_time_seconds,
          gs.total_reps, gs.pr_count)
         IS DISTINCT FROM
         (v_total_workouts, v_total_volume, v_total_time,
          v_total_reps, v_pr_count);

  IF FOUND THEN
    RETURN;
  END IF;

  -- Either the row is already exact (nothing to do) or it does not exist yet
  -- (the counter triggers used to create it). Never touch a row that belongs
  -- to a user that is being deleted: the caller checks auth.users first.
  INSERT INTO public.gamification_stats AS gs (
    user_id, total_workouts, total_volume_kg, total_time_seconds,
    total_reps, pr_count, updated_at
  )
  SELECT p_user_id, v_total_workouts, v_total_volume, v_total_time,
         v_total_reps, v_pr_count, now()
   WHERE NOT EXISTS (
     SELECT 1 FROM public.gamification_stats existing
      WHERE existing.user_id = p_user_id
   )
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_gamification_stats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_gamification_stats(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_gamification_stats(uuid) TO service_role;

COMMENT ON FUNCTION public.recompute_gamification_stats(uuid) IS
  'Recomputes the server-derived gamification_stats counters for one user '
  'from workout_sessions, sets and personal_records. Called at the end of '
  'every mobile-sync-push and by the delete triggers below.';

-- ---------------------------------------------------------------------------
-- 3. Recompute after a session or PR disappears
--
--    Statement-level triggers with transition tables so every delete path is
--    covered (Edge, service-role tooling, account deletion cascade). The
--    function is SECURITY DEFINER because auth.users deletion cascades run as
--    supabase_auth_admin, which has no rights in public. Deleting a trigger
--    function is not an EXECUTE call, so the revokes below cost nothing and
--    keep the definer lockdown (20260920000100) green.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_gamification_stats_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR v_user_id IN
      SELECT DISTINCT n.user_id
        FROM new_rows n
        JOIN old_rows o ON o.id = n.id
       WHERE o.deleted_at IS DISTINCT FROM n.deleted_at
    LOOP
      IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user_id) THEN
        PERFORM public.recompute_gamification_stats(v_user_id);
      END IF;
    END LOOP;
  ELSE
    FOR v_user_id IN
      SELECT DISTINCT o.user_id FROM old_rows o WHERE o.user_id IS NOT NULL
    LOOP
      -- Skip users that no longer exist: during an account-deletion cascade
      -- the stats row is on its way out too, and inserting one would fail the
      -- FK to auth.users.
      IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user_id) THEN
        PERFORM public.recompute_gamification_stats(v_user_id);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_gamification_stats_after_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_gamification_stats_after_change() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_gamification_stats_after_change() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.workout_sessions'::regclass
       AND tgname = 'trg_recompute_gamification_on_session_delete'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_recompute_gamification_on_session_delete
      AFTER DELETE ON public.workout_sessions
      REFERENCING OLD TABLE AS old_rows
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.recompute_gamification_stats_after_change();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.personal_records'::regclass
       AND tgname = 'trg_recompute_gamification_on_record_delete'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_recompute_gamification_on_record_delete
      AFTER DELETE ON public.personal_records
      REFERENCING OLD TABLE AS old_rows
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.recompute_gamification_stats_after_change();
  END IF;

  -- Tombstones (deleted_at) are the mobile delete path for records.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.personal_records'::regclass
       AND tgname = 'trg_recompute_gamification_on_record_tombstone'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_recompute_gamification_on_record_tombstone
      AFTER UPDATE ON public.personal_records
      REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.recompute_gamification_stats_after_change();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Drop the add-only dashboard counter triggers (see header).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_update_profile_stats_on_workout ON public.workout_sessions;
DROP TRIGGER IF EXISTS trg_update_pr_count_on_record ON public.personal_records;

-- ---------------------------------------------------------------------------
-- 5. LWW RPCs: device-owned columns only, keyed on last_workout_at.
--    Same signatures; bodies start from their latest versions
--    (20260420191901 for stats, 20260420190710 for rpg) per KD-3 rule 3a.
--    Grants stay service_role-only (PR 10, 20260920001000).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_gamification_stats_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec          record;
  v_existing   timestamptz;
  v_has_row    boolean;
  v_accept     boolean;
  v_updated_at timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.gamification_stats, p_rows)
  LOOP
    SELECT gs.last_workout_at
      INTO v_existing
      FROM public.gamification_stats gs
      WHERE gs.user_id = rec.user_id
      FOR UPDATE;
    v_has_row := FOUND;

    -- Device-owned columns move only on a write that carries a last-workout
    -- date at least as recent as the stored one. A write with no date (older
    -- app versions, a stats-only push) has no opinion and is accepted.
    v_accept := NOT v_has_row
      OR v_existing IS NULL
      OR rec.last_workout_at IS NULL
      OR rec.last_workout_at >= v_existing;

    -- total_workouts, total_reps, total_volume_kg, total_time_seconds and
    -- pr_count are intentionally absent from both column lists: they are
    -- server-derived (recompute_gamification_stats) and are never taken from
    -- the device, whatever the payload claims.
    INSERT INTO public.gamification_stats AS gs (
      user_id, current_streak, longest_streak, best_streak,
      last_workout_at, updated_at
    ) VALUES (
      rec.user_id,
      COALESCE(rec.current_streak, 0),
      COALESCE(rec.longest_streak, 0),
      GREATEST(COALESCE(rec.best_streak, 0), COALESCE(rec.longest_streak, 0)),
      rec.last_workout_at,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      current_streak  = CASE WHEN v_accept THEN EXCLUDED.current_streak
                             ELSE gs.current_streak END,
      -- Best-ever values are monotonic by definition, so they are merged
      -- even from a write that lost the last-workout compare.
      longest_streak  = GREATEST(gs.longest_streak, EXCLUDED.longest_streak),
      best_streak     = GREATEST(gs.best_streak, EXCLUDED.best_streak),
      last_workout_at = CASE WHEN v_accept
                             THEN COALESCE(EXCLUDED.last_workout_at, gs.last_workout_at)
                             ELSE gs.last_workout_at END,
      updated_at      = now()
    RETURNING gs.updated_at INTO v_updated_at;

    RETURN QUERY SELECT rec.user_id::text, v_accept, v_updated_at;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_gamification_stats_lww(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_gamification_stats_lww(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_gamification_stats_lww(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_rpg_attributes_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec          record;
  v_existing   timestamptz;
  v_has_row    boolean;
  v_accept     boolean;
  v_updated_at timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.rpg_attributes, p_rows)
  LOOP
    SELECT ra.last_workout_at
      INTO v_existing
      FROM public.rpg_attributes ra
      WHERE ra.user_id = rec.user_id
      FOR UPDATE;
    v_has_row := FOUND;

    -- Every rpg_attributes column is device-owned (XP, level, attributes):
    -- nothing here is derivable from server rows.
    v_accept := NOT v_has_row
      OR v_existing IS NULL
      OR rec.last_workout_at IS NULL
      OR rec.last_workout_at >= v_existing;

    INSERT INTO public.rpg_attributes AS ra (
      user_id, strength, power, stamina, consistency, mastery, level,
      experience_points, character_class, last_workout_at, updated_at
    ) VALUES (
      rec.user_id,
      COALESCE(rec.strength, 0),
      COALESCE(rec.power, 0),
      COALESCE(rec.stamina, 0),
      COALESCE(rec.consistency, 0),
      COALESCE(rec.mastery, 0),
      COALESCE(rec.level, 1),
      COALESCE(rec.experience_points, 0),
      rec.character_class,
      rec.last_workout_at,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      strength          = CASE WHEN v_accept THEN EXCLUDED.strength ELSE ra.strength END,
      power             = CASE WHEN v_accept THEN EXCLUDED.power ELSE ra.power END,
      stamina           = CASE WHEN v_accept THEN EXCLUDED.stamina ELSE ra.stamina END,
      consistency       = CASE WHEN v_accept THEN EXCLUDED.consistency ELSE ra.consistency END,
      mastery           = CASE WHEN v_accept THEN EXCLUDED.mastery ELSE ra.mastery END,
      level             = CASE WHEN v_accept THEN EXCLUDED.level ELSE ra.level END,
      experience_points = CASE WHEN v_accept THEN EXCLUDED.experience_points
                               ELSE ra.experience_points END,
      character_class   = CASE WHEN v_accept THEN EXCLUDED.character_class
                               ELSE ra.character_class END,
      last_workout_at   = CASE WHEN v_accept
                               THEN COALESCE(EXCLUDED.last_workout_at, ra.last_workout_at)
                               ELSE ra.last_workout_at END,
      updated_at        = now()
    RETURNING ra.updated_at INTO v_updated_at;

    RETURN QUERY SELECT rec.user_id::text, v_accept, v_updated_at;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rpg_attributes_lww(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_rpg_attributes_lww(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_rpg_attributes_lww(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. One-time reconciliation of the drift the add-only triggers left behind
--    (R-26). Every user that has a stats row or any session is recomputed, so
--    leaderboards and PR 56's snapshots read derived values immediately
--    instead of waiting for each user's next push.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN
    SELECT u.id
      FROM auth.users u
     WHERE EXISTS (SELECT 1 FROM public.gamification_stats gs WHERE gs.user_id = u.id)
        OR EXISTS (SELECT 1 FROM public.workout_sessions ws WHERE ws.user_id = u.id)
  LOOP
    PERFORM public.recompute_gamification_stats(v_user_id);
  END LOOP;
END
$$;
