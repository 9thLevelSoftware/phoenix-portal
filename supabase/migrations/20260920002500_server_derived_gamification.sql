-- Server-derived gamification counters (F-070, F-094, R-12, R-26).
--
-- WHAT THIS BUYS, STATED ACCURATELY (review round 1, R-7/R-25):
--   The counters below always equal the rows the server stores, and they are
--   never taken from the gamification_stats payload. A delete lowers them.
--   They are NOT bounded: `workout_sessions.total_volume` and
--   `duration_seconds` are still copied verbatim from the pushed session
--   (mobile-sync-push/index.ts), and `personal_records` rows are device
--   authored, so a crafted push CAN still inflate total_volume_kg /
--   total_time_seconds / pr_count one layer down. Bounding the ingress rows
--   is a recorded follow-up (see exec/new-findings.md NF-20); do not read the
--   header below as saying otherwise.
--
-- SCOPE: gamification_stats and rpg_attributes are ACCOUNT-WIDE. They have no
--   local_profile_id, while workout_sessions and personal_records do, so every
--   derived value is the sum over ALL local profiles of the account. On a
--   shared/household account the figure is the household total. Pre-existing
--   (the dropped add-only triggers had the same scope), recorded here because
--   PR 67 publishes this table as the ownership contract (R-14).
--
-- Column ownership after this migration:
--
--   SERVER-DERIVED (recomputed from stored rows; a device value is ignored):
--     gamification_stats.total_workouts     count(workout_sessions)
--     gamification_stats.total_volume_kg    sum(workout_sessions.total_volume)
--                                           (per cable as stored, KD-8 — never doubled)
--     gamification_stats.total_time_seconds sum(workout_sessions.duration_seconds)
--     gamification_stats.total_reps         sum(sets.actual_reps) over the
--                                           user's sessions (sets -> exercises
--                                           -> workout_sessions)
--     gamification_stats.pr_count           count(personal_records
--                                           WHERE deleted_at IS NULL)
--     gamification_stats.current_streak     consecutive UTC workout days ending
--                                           today (or yesterday if today is
--                                           empty) — the same rule as
--                                           public.workout_current_streak and
--                                           the SPA's useStreak (PR 41: UTC on
--                                           both sides)
--     gamification_stats.longest_streak     longest run of consecutive UTC
--                                           workout days
--     gamification_stats.best_streak        = longest_streak (prod duplicate
--                                           read by get_profile_stats)
--
--     Review round 1 reversed the original plan here: the streaks are NOT
--     "non-derivable" — public.workout_current_streak(uuid) already derives
--     one — and the GREATEST(existing, incoming) ratchet that shipped in the
--     first draft was one-way, ran even on a REJECTED write, and fed PR 56's
--     leaderboard, so one crafted push pinned a public board with no
--     correction path (R-4, R-12, R-23). The ratchet is gone.
--
--   DEVICE-REPORTED SHADOW COLUMNS (device_*, portal never displays them):
--     device_total_workouts, device_total_reps, device_total_volume_kg,
--     device_total_time_seconds, device_current_streak, device_longest_streak
--
--     These hold verbatim what the phone last pushed, and mobile-sync-pull
--     serves THEM as totalWorkouts/totalReps/totalVolumeKg/totalTimeSeconds/
--     currentStreak/longestStreak. Reason (R-10, critical): the installed app
--     merges a pulled gamification_stats row with an unconditional
--     server-wins INSERT OR REPLACE — no max(), no gate — and the two sides do
--     not mean the same thing by these words (the server counts grouped portal
--     sessions where the phone counts its own profile's sessions with
--     workingReps > 0, and stored volume is per cable where the phone's local
--     aggregate is the machine total, so a derived value served to the phone
--     HALVES lifetime volume for dual-cable users and shifts badge progress).
--     There is no app-version field in the push payload, so no server-side
--     gate on build is possible. Keeping a shadow copy means nothing the
--     installed app reads changes meaning, while the portal and the
--     leaderboards read the derived columns.
--
--   DEVICE-OWNED (not derivable from server rows; taken from whichever write
--   carries the later last-workout date, see last_workout_at below):
--     rpg_attributes.strength/power/stamina/consistency/mastery
--     rpg_attributes.character_class/level/experience_points
--
--   SERVER BOOKKEEPING:
--     *.updated_at        server stamp of the last row change. It is the
--                         delta-sync cursor mobile-sync-pull filters on
--                         (`.gt('updated_at', lastSync)`), NOT the conflict
--                         key any more (F-070: comparing a server stamp made
--                         every push win against itself). Deliberately NOT
--                         bumped by recompute_gamification_stats and NOT
--                         bumped by a rejected LWW write: neither changes
--                         anything mobile-sync-pull serves, and re-delivering
--                         the row would make the phone's value flap.
--     *.last_workout_at   the last-workout date the write carried, CLAMPED to
--                         now() (R-2/R-11/R-24: it is attacker-chosen, and an
--                         unclamped 2099 value pinned every device-owned
--                         column against all later honest pushes). NULL when
--                         the push carried no session; a NULL key is accepted
--                         only when no key is stored yet — it is NOT consent
--                         to overwrite a newer device (R-3/R-11: a stale
--                         device sends exactly that shape, `sessions: []`).
--
-- The two dashboard counter triggers captured by 20260920000200
-- (trg_update_profile_stats_on_workout, trg_update_pr_count_on_record) are
-- dropped here: they only ever ADDED to the counters, so a re-push, a delete
-- or a corrected session left the totals permanently too high (R-26), which
-- is exactly the drift recompute_gamification_stats() now removes. Their
-- functions are kept (service_role only) so 20260920000200 stays applicable
-- and the capture test still finds them; only the triggers go.
--
-- !! HAZARD (R-13/R-26): 20260920000200 section 3 re-CREATEs both triggers
--    whenever they are missing. Re-running 20260920000200 ALONE after this
--    migration resurrects them and restarts the double-counting drift until
--    the next recompute. A clean ordered apply is fine. Any reconciliation
--    migration that replays 000200 must drop them again afterwards.
--
-- !! DEPLOY ORDER: this migration must be applied BEFORE mobile-sync-push AND
--    mobile-sync-pull are deployed. Edge-first is a total push outage (the
--    handler calls recompute_gamification_stats, which would not exist) and
--    the pull would select device_* columns that do not exist yet.
--
-- The one-time reconciliation of pre-existing drift lives in the separate,
-- re-runnable 20260920002501 so a slow backfill cannot roll back this schema
-- change (R-6). The operator preview query is in that file's header (R-30).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS, guarded CREATE TRIGGER, one-shot seed keyed on IS NULL.

-- ---------------------------------------------------------------------------
-- 1. last_workout_at — the device-owned conflict key
-- ---------------------------------------------------------------------------
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS last_workout_at timestamptz;
ALTER TABLE public.rpg_attributes
  ADD COLUMN IF NOT EXISTS last_workout_at timestamptz;

COMMENT ON COLUMN public.gamification_stats.last_workout_at IS
  'Last-workout date carried by the write that set the device-reported '
  'columns. Derived by mobile-sync-push from the pushed sessions (max '
  'started_at) and clamped to now(). NULL means the write carried no session, '
  'which is accepted only when nothing is stored yet. Conflict key for '
  'upsert_gamification_stats_lww — updated_at is a server stamp, not a clock '
  'to compare (F-070).';
COMMENT ON COLUMN public.rpg_attributes.last_workout_at IS
  'Last-workout date carried by the write that set this row, clamped to '
  'now(). Conflict key for upsert_rpg_attributes_lww (F-070).';

-- ---------------------------------------------------------------------------
-- 1b. Device-reported shadow columns (R-10). See the header.
-- ---------------------------------------------------------------------------
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS device_total_workouts integer;
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS device_total_reps integer;
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS device_total_volume_kg numeric;
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS device_total_time_seconds integer;
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS device_current_streak integer;
ALTER TABLE public.gamification_stats
  ADD COLUMN IF NOT EXISTS device_longest_streak integer;

COMMENT ON COLUMN public.gamification_stats.device_total_workouts IS
  'Verbatim device-reported lifetime workout count. mobile-sync-pull serves '
  'THIS as totalWorkouts, never the derived column: the installed app merges '
  'server-wins with no gate, and the two definitions differ (R-10).';
COMMENT ON COLUMN public.gamification_stats.device_total_volume_kg IS
  'Verbatim device-reported lifetime volume (machine total as the phone '
  'aggregates it, NOT per-cable). Served by mobile-sync-pull as totalVolumeKg.';
COMMENT ON COLUMN public.gamification_stats.total_workouts IS
  'SERVER-DERIVED: count(workout_sessions), account-wide. Read by the portal '
  'and the leaderboards. Devices neither write nor read it.';
COMMENT ON COLUMN public.gamification_stats.pr_count IS
  'SERVER-DERIVED: count(personal_records WHERE deleted_at IS NULL), '
  'maintained by recompute_gamification_stats(). Devices do not push it.';
COMMENT ON COLUMN public.gamification_stats.best_streak IS
  'SERVER-DERIVED duplicate of longest_streak kept for get_profile_stats. The '
  'GREATEST ratchet was removed in review round 1 (R-4/R-12/R-23).';

-- One-shot seed: the pre-existing canonical values ARE what the device last
-- reported (they were written verbatim by the old upsert), so copying them
-- into the shadow columns before 20260920002501 recomputes means the first
-- pull after this change hands every installed phone back exactly the numbers
-- it already had. Safe to re-run: every row written after this point gets its
-- shadow columns from upsert_gamification_stats_lww (never NULL), and
-- recompute_gamification_stats never INSERTs, so `IS NULL` can only ever match
-- a row that predates this migration.
UPDATE public.gamification_stats
   SET device_total_workouts     = total_workouts,
       device_total_reps         = total_reps,
       device_total_volume_kg    = total_volume_kg,
       device_total_time_seconds = total_time_seconds,
       device_current_streak     = current_streak,
       device_longest_streak     = longest_streak
 WHERE device_total_workouts IS NULL;

-- ---------------------------------------------------------------------------
-- 2. derive_gamification_stats — the single definition of every derived value
--
--    Factored out of the recompute so the operator preview in 20260920002501
--    and any drift check run EXACTLY the derivation the backfill applies,
--    rather than a hand-copied lookalike (R-30).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_gamification_stats(p_user_id uuid)
RETURNS TABLE(
  total_workouts     integer,
  total_reps         integer,
  total_volume_kg    numeric,
  total_time_seconds integer,
  pr_count           integer,
  current_streak     integer,
  longest_streak     integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH totals AS (
    SELECT count(*)::integer                                   AS total_workouts,
           COALESCE(sum(ws.total_volume), 0)::numeric          AS total_volume_kg,
           COALESCE(sum(ws.duration_seconds), 0)::integer      AS total_time_seconds
      FROM public.workout_sessions ws
     WHERE ws.user_id = p_user_id
  ),
  -- Reps live on the sets, reached through the session so a deleted session
  -- (ON DELETE CASCADE) drops its reps with it.
  reps AS (
    SELECT COALESCE(sum(s.actual_reps), 0)::integer AS total_reps
      FROM public.sets s
      JOIN public.exercises e ON e.id = s.exercise_id
      JOIN public.workout_sessions ws ON ws.id = e.session_id
     WHERE ws.user_id = p_user_id
  ),
  records AS (
    SELECT count(*)::integer AS pr_count
      FROM public.personal_records pr
     WHERE pr.user_id = p_user_id
       AND pr.deleted_at IS NULL
  ),
  -- Streaks: unique UTC workout dates, the same day rule as
  -- public.workout_current_streak(uuid) and the SPA's useStreak (PR 41 chose
  -- UTC on both sides). Inlined rather than PERFORMed, because
  -- workout_current_streak is SECURITY DEFINER behind an
  -- `auth.uid() IS NOT DISTINCT FROM p_user_id` guard and would silently
  -- return 0 for a service-role caller.
  days AS (
    SELECT DISTINCT (ws.started_at AT TIME ZONE 'UTC')::date AS d
      FROM public.workout_sessions ws
     WHERE ws.user_id = p_user_id
  ),
  anchor AS (
    SELECT CASE
             WHEN EXISTS (
               SELECT 1 FROM days
                WHERE days.d = (now() AT TIME ZONE 'UTC')::date
             )
             THEN (now() AT TIME ZONE 'UTC')::date
             ELSE ((now() AT TIME ZONE 'UTC')::date - 1)
           END AS start_day
  ),
  ranked AS (
    SELECT days.d,
           ROW_NUMBER() OVER (ORDER BY days.d DESC)      AS rn,
           ((SELECT start_day FROM anchor) - days.d)     AS expected_gap
      FROM days
     WHERE days.d <= (SELECT start_day FROM anchor)
  ),
  islands AS (
    SELECT days.d - (ROW_NUMBER() OVER (ORDER BY days.d))::integer AS island
      FROM days
  ),
  runs AS (
    SELECT count(*)::integer AS run_length FROM islands GROUP BY islands.island
  )
  SELECT totals.total_workouts,
         reps.total_reps,
         totals.total_volume_kg,
         totals.total_time_seconds,
         records.pr_count,
         COALESCE(
           (SELECT count(*)::integer FROM ranked WHERE ranked.expected_gap = ranked.rn - 1),
           0
         ) AS current_streak,
         COALESCE((SELECT max(runs.run_length) FROM runs), 0) AS longest_streak
    FROM totals, reps, records;
$$;

REVOKE ALL ON FUNCTION public.derive_gamification_stats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.derive_gamification_stats(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_gamification_stats(uuid) TO service_role;

COMMENT ON FUNCTION public.derive_gamification_stats(uuid) IS
  'The single definition of every server-derived gamification value for one '
  'user. Read-only; recompute_gamification_stats() stores what it returns and '
  'the 20260920002501 operator preview diffs against it.';

-- ---------------------------------------------------------------------------
-- 3. recompute_gamification_stats — store what derive_ returns
--
--    UPDATE-only on purpose. It must never INSERT: a row whose shadow columns
--    are NULL is how mobile-sync-pull knows the device was never told a
--    number, and inserting an all-zero row for a user who pushed only routines
--    would make the pull hand the phone zeros over its own lifetime stats
--    (R-10). The row is created by upsert_gamification_stats_lww on the first
--    push that carries gamificationStats.
--
--    It also does NOT bump updated_at: nothing it writes is served by
--    mobile-sync-pull, so re-delivering the row would only make the phone's
--    displayed value flap. updated_at stays the pull cursor for the shadow
--    columns alone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_gamification_stats(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  d record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO d FROM public.derive_gamification_stats(p_user_id);

  UPDATE public.gamification_stats gs
     SET total_workouts     = d.total_workouts,
         total_volume_kg    = d.total_volume_kg,
         total_time_seconds = d.total_time_seconds,
         total_reps         = d.total_reps,
         pr_count           = d.pr_count,
         current_streak     = d.current_streak,
         longest_streak     = d.longest_streak,
         best_streak        = d.longest_streak
   WHERE gs.user_id = p_user_id
     AND (gs.total_workouts, gs.total_volume_kg, gs.total_time_seconds,
          gs.total_reps, gs.pr_count, gs.current_streak, gs.longest_streak,
          gs.best_streak)
         IS DISTINCT FROM
         (d.total_workouts, d.total_volume_kg, d.total_time_seconds,
          d.total_reps, d.pr_count, d.current_streak, d.longest_streak,
          d.longest_streak);
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_gamification_stats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_gamification_stats(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_gamification_stats(uuid) TO service_role;

COMMENT ON FUNCTION public.recompute_gamification_stats(uuid) IS
  'Stores derive_gamification_stats() into the server-derived '
  'gamification_stats columns for one user. UPDATE-only and does not touch '
  'updated_at. Called at the end of every mobile-sync-push (fail-open) and by '
  'the delete triggers below.';

-- ---------------------------------------------------------------------------
-- 4. Recompute after a session or PR disappears
--
--    Statement-level triggers with transition tables so every delete path is
--    covered (Edge, service-role tooling, account deletion cascade). The
--    function is SECURITY DEFINER because auth.users deletion cascades run as
--    supabase_auth_admin, which has no rights in public. Deleting a trigger
--    function is not an EXECUTE call, so the revokes below cost nothing and
--    keep the definer lockdown (20260920000100) green.
--
--    NOTE (R-5): INSERT and UPDATE of workout_sessions are deliberately NOT
--    covered by a trigger. A trigger would run inside the push's own write
--    transaction, so a statement timeout on a large history would fail the
--    write itself — the wedge that step 14a of mobile-sync-push was changed to
--    avoid. mobile-sync-push is the ONLY insert path today (PR 10's
--    20260920001000 revoked INSERT/UPDATE on workout_sessions and
--    personal_records from anon and authenticated, and no other Edge function
--    writes them), and gamification_stats.test.sql asserts that grant so a new
--    writer breaks loudly. Any future importer must call
--    recompute_gamification_stats(user_id) itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_gamification_stats_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
      -- the stats row is on its way out too.
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
-- 5. Drop the add-only dashboard counter triggers (see header, and the
--    20260920000200 replay hazard recorded there).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_update_profile_stats_on_workout ON public.workout_sessions;
DROP TRIGGER IF EXISTS trg_update_pr_count_on_record ON public.personal_records;

-- ---------------------------------------------------------------------------
-- 6. LWW RPCs: device-reported shadow columns only, keyed on last_workout_at.
--    Same signatures; bodies start from their latest versions
--    (20260420191901 for stats, 20260420190710 for rpg) per KD-3 rule 3a.
--    Grants stay service_role-only (PR 10, 20260920001000).
--
--    server_updated_at in the result now carries the STORED last_workout_at —
--    the value a rejected device must beat — not a fresh server clock. The
--    column name is kept so the signature (and the wire field
--    rejections.*[].serverUpdatedAt) is unchanged; the semantics change is
--    recorded in exec/integration-notes.md for PR 21's rejection note (R-8,
--    R-15).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_gamification_stats_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  rec          record;
  v_existing   timestamptz;
  v_has_row    boolean;
  v_accept     boolean;
  v_incoming   timestamptz;
  v_stored_key timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.gamification_stats, p_rows)
  LOOP
    -- Defence in depth against a skewed or crafted clock: a key in the
    -- server's future would otherwise pin every device-reported column
    -- against all later honest pushes (R-2/R-24). mobile-sync-push clamps
    -- too; this covers any other service-role caller.
    -- NB: LEAST() ignores NULLs, so a NULL key must be preserved explicitly
    -- or it would become now() and always win.
    v_incoming := CASE
                    WHEN rec.last_workout_at IS NULL THEN NULL
                    ELSE LEAST(rec.last_workout_at, now())
                  END;

    SELECT gs.last_workout_at
      INTO v_existing
      FROM public.gamification_stats gs
      WHERE gs.user_id = rec.user_id
      FOR UPDATE;
    v_has_row := FOUND;

    -- A write with no last-workout date is NOT consent to overwrite. A stale
    -- device sends exactly that shape (`sessions: []` with its stale local
    -- stats), so "no key" may win only when nothing is stored yet (R-3/R-11).
    v_accept := NOT v_has_row
      OR v_existing IS NULL
      OR (v_incoming IS NOT NULL AND v_incoming >= v_existing);

    IF NOT v_accept THEN
      -- Nothing to merge: every remaining column is either device-reported
      -- (rejected) or server-derived (never taken from a payload). Skipping
      -- the write keeps updated_at — the pull cursor — from dragging an
      -- unchanged row into the next delta pull.
      RETURN QUERY SELECT rec.user_id::text, false, v_existing;
      CONTINUE;
    END IF;

    -- total_workouts, total_reps, total_volume_kg, total_time_seconds,
    -- pr_count, current_streak, longest_streak and best_streak are
    -- intentionally absent from BOTH column lists: they are server-derived
    -- (recompute_gamification_stats) and are never taken from the device,
    -- whatever the payload claims. gamification_stats.test.sql pins this on
    -- the INSERT path and the ON CONFLICT path separately (R-17).
    INSERT INTO public.gamification_stats AS gs (
      user_id,
      device_total_workouts, device_total_reps, device_total_volume_kg,
      device_total_time_seconds, device_current_streak, device_longest_streak,
      last_workout_at, updated_at
    ) VALUES (
      rec.user_id,
      COALESCE(rec.device_total_workouts, 0),
      COALESCE(rec.device_total_reps, 0),
      COALESCE(rec.device_total_volume_kg, 0),
      COALESCE(rec.device_total_time_seconds, 0),
      COALESCE(rec.device_current_streak, 0),
      COALESCE(rec.device_longest_streak, 0),
      v_incoming,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      device_total_workouts     = EXCLUDED.device_total_workouts,
      device_total_reps         = EXCLUDED.device_total_reps,
      device_total_volume_kg    = EXCLUDED.device_total_volume_kg,
      device_total_time_seconds = EXCLUDED.device_total_time_seconds,
      device_current_streak     = EXCLUDED.device_current_streak,
      device_longest_streak     = EXCLUDED.device_longest_streak,
      last_workout_at           = COALESCE(EXCLUDED.last_workout_at, gs.last_workout_at),
      updated_at                = now()
    RETURNING gs.last_workout_at INTO v_stored_key;

    RETURN QUERY SELECT rec.user_id::text, true, v_stored_key;
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
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  rec          record;
  v_existing   timestamptz;
  v_has_row    boolean;
  v_accept     boolean;
  v_incoming   timestamptz;
  v_stored_key timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.rpg_attributes, p_rows)
  LOOP
    -- NB: LEAST() ignores NULLs, so a NULL key must be preserved explicitly
    -- or it would become now() and always win.
    v_incoming := CASE
                    WHEN rec.last_workout_at IS NULL THEN NULL
                    ELSE LEAST(rec.last_workout_at, now())
                  END;

    SELECT ra.last_workout_at
      INTO v_existing
      FROM public.rpg_attributes ra
      WHERE ra.user_id = rec.user_id
      FOR UPDATE;
    v_has_row := FOUND;

    -- Every rpg_attributes column is device-owned (XP, level, attributes):
    -- nothing here is derivable from server rows. Same null-key rule as above.
    v_accept := NOT v_has_row
      OR v_existing IS NULL
      OR (v_incoming IS NOT NULL AND v_incoming >= v_existing);

    IF NOT v_accept THEN
      RETURN QUERY SELECT rec.user_id::text, false, v_existing;
      CONTINUE;
    END IF;

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
      v_incoming,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      strength          = EXCLUDED.strength,
      power             = EXCLUDED.power,
      stamina           = EXCLUDED.stamina,
      consistency       = EXCLUDED.consistency,
      mastery           = EXCLUDED.mastery,
      level             = EXCLUDED.level,
      experience_points = EXCLUDED.experience_points,
      character_class   = EXCLUDED.character_class,
      last_workout_at   = COALESCE(EXCLUDED.last_workout_at, ra.last_workout_at),
      updated_at        = now()
    RETURNING ra.last_workout_at INTO v_stored_key;

    RETURN QUERY SELECT rec.user_id::text, true, v_stored_key;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rpg_attributes_lww(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_rpg_attributes_lww(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_rpg_attributes_lww(jsonb) TO service_role;
