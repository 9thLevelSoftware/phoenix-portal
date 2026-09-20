-- KD-5 (PR 21, review round 1): follow-up to 20260920002100.
--
-- R-4 (major, data loss). 002100 made every accepted push write
--   updated_at = now() (the server write clock) so a slow device clock can
--   no longer hide a row from another device's delta pull (NF-12). The
--   sessions pull, however, reported that same server clock to the device as
--   the session's `updatedAt`. Mobile's mergeSessionsLww accepts an incoming
--   row when incomingTs >= existingTs, and SyncManager stamps each pushed
--   session with its own currentTimeMillis() right after the push. On a
--   device whose clock trails the DB by more than the push latency, the pull
--   that follows in the same sync handed back a *newer-looking* copy of the
--   session the device had just pushed, and the device overwrote its own
--   rich local row with the lossy pull projection (warmupReps = 0,
--   workingReps = totalReps, averaged duration, first-set target reps, lossy
--   mode map, and progressionKg / isJustLift / stopAtTop / eccentricLoad /
--   echoLevel / routineId falling back to constructor defaults).
--   Fix, portal-only (no mobile prerequisite; installed store builds must be
--   safe without an app update): the sessions pull reports the LWW key
--   (client_updated_at, falling back to updated_at) as the DTO's updatedAt,
--   so a device compares device time against device time for its own rows,
--   while the pull CURSOR and ordering stay on the server-owned updated_at.
--   get_sessions_excluding_ids therefore has to return client_updated_at;
--   its return type changes, so it is dropped and recreated (KD-3 rule 3).
--
-- R-13 (security). The session/routine LWW upserts did not compare
--   user_id on the ON CONFLICT path, so cross-user protection rested
--   entirely on the Edge `assertRowsOwnedByUser` pre-check one round trip
--   earlier (a TOCTOU window; exploiting it needs a victim UUID guessed
--   before the victim pushes it). merge_training_cycles_from_push already
--   guards this. Both upserts now require ws.user_id = EXCLUDED.user_id,
--   and the rejection reports server_updated_at = NULL for a row owned by
--   somebody else instead of leaking the victim's LWW key.
--
-- R-1 / R-7 (the DTO omitted updatedAt). One rule, both SYNC_LWW_ENABLED
--   values, all three entities: an undated push is dated at the moment the
--   server receives it. The Edge substitutes its own now() into
--   client_updated_at before the upsert/RPC, and these functions keep the
--   COALESCE(..., NOW()) belt-and-braces fallback for an older Edge
--   deployment. Consequences, deliberately accepted:
--     * A stored LWW key (including a portal edit's stamp) is never
--       overwritten with NULL, so the key stays correct the day the flag
--       flips (this was the R-1 bug in the LWW-off PostgREST upsert).
--     * Under LWW-on an undated push WINS against a portal edit made
--       earlier, because "when it arrived" is the only date the server has.
--       The "a portal edit beats an earlier mobile version" guarantee
--       therefore only holds for builds that send updatedAt. Rejecting
--       undated pushes instead would strand the edits of any build that
--       omits the field, which is the worse failure.
--
-- R-3 / R-6 (rejection clock). `rejections[].serverUpdatedAt` in the push
--   response now means ONE thing for every entity: the stored LWW key of
--   the row that beat the push. Sessions and routines already returned it.
--   merge_training_cycles_from_push has to keep returning the server-clock
--   updated_at for accepted cycles (the push response's cycleVersions hands
--   it back as the device's baseUpdatedAt, which is compared with
--   portal_edited_at — the same clock), so it gains a separate
--   client_updated_at output column that the Edge reports in rejections.
--   Another return-type change, so it too is dropped and recreated.
--
-- R-2 (clock-skew window, cycles only). A device 10 minutes behind that has
--   already pulled a portal edit made at S and edits the cycle at real time
--   S+1min sends updated_at = S-9min, and the LWW gate rejected it even
--   though the device demonstrably knew about the portal edit. For cycles
--   the payload carries base_updated_at, so the case is distinguishable: a
--   push whose base is at or after the portal edit that produced the stored
--   key is not stale, and is no longer rejected on the clock. Sessions and
--   routines carry no base and keep the window (documented on the RPCs).
--
-- R-5 (pull cursor is not commit-ordered) is NOT fixed here; see the note
--   on the pull cursor below and pr-21-summary.md.
--
-- No wire change. Deploy this migration before the Edge Function (the pull
-- reads client_updated_at from the sessions RPC; the push reads the merge's
-- client_updated_at output).
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- get_sessions_excluding_ids: return the LWW key as well (R-4)
-- ---------------------------------------------------------------------------
-- Starts from 20260917185323 (the latest body). Only change: the enumerated
-- return columns gain client_updated_at. The filter, the cursor comparison
-- and ORDER BY all stay on updated_at — the server write clock — so delta
-- pulls and pagination are unaffected.
--
-- R-5 (unfixed, pre-existing): updated_at is the push transaction's start
-- time, not its commit time, and the pull's syncTime is the Edge host's
-- clock. A push that starts before a pull's syncTime and commits after that
-- pull's read is invisible to it and is never returned in since-mode
-- afterwards. Parity mode still recovers new ids, but not updates to rows
-- the device already knows. Mitigation would be to hand back a syncTime with
-- a safety margin (the merges are idempotent, so re-delivery is harmless) or
-- to compute syncTime in the DB.
DROP FUNCTION IF EXISTS public.get_sessions_excluding_ids(uuid, uuid[], text, timestamptz, uuid, int);
DROP FUNCTION IF EXISTS public.get_sessions_excluding_ids(uuid, uuid[], text, timestamptz, uuid, int, timestamptz);

CREATE FUNCTION public.get_sessions_excluding_ids(
    p_user_id UUID,
    p_known_ids UUID[] DEFAULT '{}',
    p_profile_id TEXT DEFAULT NULL,
    p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 76,
    p_last_sync_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    name TEXT,
    started_at TIMESTAMPTZ,
    duration_seconds INT,
    total_volume NUMERIC,
    set_count INT,
    exercise_count INT,
    pr_count INT,
    routine_name TEXT,
    workout_mode TEXT,
    routine_session_id TEXT,
    notes TEXT,
    updated_at TIMESTAMPTZ,
    client_updated_at TIMESTAMPTZ,
    avg_velocity_mps REAL,
    avg_asymmetry_pct REAL,
    velocity_loss_pct REAL,
    dominant_side TEXT,
    strength_profile TEXT,
    form_score INT,
    deload_warnings INT,
    rom_violations INT,
    spotter_activations INT,
    peak_force_n REAL,
    estimated_calories REAL,
    heaviest_lift_kg REAL,
    eccentric_load INT,
    echo_level INT,
    warmup_reps INT,
    working_reps INT,
    local_profile_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ws.id,
        ws.user_id,
        ws.name,
        ws.started_at,
        ws.duration_seconds,
        ws.total_volume,
        ws.set_count,
        ws.exercise_count,
        ws.pr_count,
        ws.routine_name,
        ws.workout_mode,
        ws.routine_session_id,
        ws.notes,
        ws.updated_at,
        ws.client_updated_at,
        ws.avg_velocity_mps,
        ws.avg_asymmetry_pct,
        ws.velocity_loss_pct,
        ws.dominant_side,
        ws.strength_profile,
        ws.form_score,
        ws.deload_warnings,
        ws.rom_violations,
        ws.spotter_activations,
        ws.peak_force_n,
        ws.estimated_calories,
        ws.heaviest_lift_kg,
        ws.eccentric_load,
        ws.echo_level,
        ws.warmup_reps,
        ws.working_reps,
        ws.local_profile_id
    FROM workout_sessions ws
    WHERE ws.user_id = p_user_id
      -- NEW (not in known IDs) or STALE (updated/started since last sync)
      AND (
          array_length(p_known_ids, 1) IS NULL
          OR ws.id != ALL(p_known_ids)
          OR (
              p_last_sync_at IS NOT NULL
              AND (
                  ws.updated_at > p_last_sync_at
                  OR ws.started_at > p_last_sync_at
              )
          )
      )
      AND (
          p_profile_id IS NULL
          OR (p_profile_id = 'default' AND ws.local_profile_id IS NULL)
          OR ws.local_profile_id = p_profile_id
      )
      AND (
          p_cursor_updated_at IS NULL
          OR ws.updated_at > p_cursor_updated_at
          OR (ws.updated_at = p_cursor_updated_at AND ws.id > p_cursor_id)
      )
    ORDER BY ws.updated_at ASC, ws.id ASC
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.get_sessions_excluding_ids(uuid, uuid[], text, timestamptz, uuid, int, timestamptz) IS
'Fetches workout sessions not in the provided ID list OR updated/started since last sync. Uses POST body via RPC to bypass URL length limits. Returns both clocks: updated_at (server write clock, the pull cursor and ordering key) and client_updated_at (the LWW key the pull reports to the device as updatedAt, KD-5 / R-4).';

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_sessions_excluding_ids'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- upsert_workout_session_lww (starts from 20260920002100; KD-3 3a)
-- ---------------------------------------------------------------------------
-- Changes from 002100:
--   * R-13: the ON CONFLICT guard also requires ws.user_id = EXCLUDED.user_id,
--     and a row owned by somebody else is reported rejected with a NULL key.
--   * Documents the undated-push rule (R-1/R-7) and the skew window (R-2).
--
-- Incoming key: client_updated_at, else updated_at (an Edge deployment older
-- than 002100 sends only that), else NOW() — the undated-push rule: a push
-- that carries no device timestamp is dated at the moment the server
-- receives it, identically under both SYNC_LWW_ENABLED values. Such a push
-- therefore beats a portal edit made earlier; "a portal edit beats an
-- earlier mobile version" holds only for builds that send updatedAt.
--
-- R-2 skew window (accepted limitation, sessions and routines): a device
-- whose clock trails the server by more than the age of the last portal edit
-- has its genuinely newer edit rejected under LWW-on until that edit falls
-- outside the skew window. The user sees their phone-side edit to an
-- already-synced session/routine silently reverted to the portal version on
-- the next pull. Sessions and routines carry no base_updated_at, so the
-- server cannot tell that case apart from a genuinely stale push; cycles can and do
-- (see merge_training_cycles_from_push).
--
-- The upsert's WHERE is the only gate, so a concurrent newer write makes it
-- update nothing and the row is reported rejected. updated_at (pull cursor)
-- is always the server clock, on INSERT too (NF-12).
CREATE OR REPLACE FUNCTION public.upsert_workout_session_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  v_incoming timestamptz;
  v_stored timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.workout_sessions, p_rows)
  LOOP
    v_incoming := COALESCE(rec.client_updated_at, rec.updated_at, NOW());

    INSERT INTO public.workout_sessions AS ws (
      id, user_id, local_profile_id, name, notes, started_at, duration_seconds,
      total_volume, set_count, exercise_count, pr_count, routine_name,
      routine_session_id, workout_mode, warmup_reps, working_reps,
      avg_velocity_mps, avg_asymmetry_pct, velocity_loss_pct, dominant_side,
      strength_profile, form_score, deload_warnings, rom_violations,
      spotter_activations, peak_force_n, estimated_calories, heaviest_lift_kg,
      eccentric_load, echo_level, updated_at, client_updated_at
    ) VALUES (
      rec.id, rec.user_id, rec.local_profile_id, rec.name, rec.notes,
      COALESCE(rec.started_at, NOW()),
      COALESCE(rec.duration_seconds, 0),
      COALESCE(rec.total_volume, 0),
      COALESCE(rec.set_count, 0),
      COALESCE(rec.exercise_count, 0),
      COALESCE(rec.pr_count, 0),
      rec.routine_name, rec.routine_session_id, rec.workout_mode,
      rec.warmup_reps, rec.working_reps, rec.avg_velocity_mps,
      rec.avg_asymmetry_pct, rec.velocity_loss_pct, rec.dominant_side,
      rec.strength_profile, rec.form_score, rec.deload_warnings,
      rec.rom_violations, rec.spotter_activations, rec.peak_force_n,
      rec.estimated_calories, rec.heaviest_lift_kg, rec.eccentric_load,
      rec.echo_level, NOW(), v_incoming
    )
    ON CONFLICT (id) DO UPDATE SET
      name              = EXCLUDED.name,
      notes             = EXCLUDED.notes,
      started_at        = EXCLUDED.started_at,
      duration_seconds  = EXCLUDED.duration_seconds,
      total_volume      = EXCLUDED.total_volume,
      set_count         = EXCLUDED.set_count,
      exercise_count    = EXCLUDED.exercise_count,
      pr_count          = EXCLUDED.pr_count,
      routine_name      = EXCLUDED.routine_name,
      routine_session_id = EXCLUDED.routine_session_id,
      workout_mode      = EXCLUDED.workout_mode,
      warmup_reps       = EXCLUDED.warmup_reps,
      working_reps      = EXCLUDED.working_reps,
      avg_velocity_mps  = EXCLUDED.avg_velocity_mps,
      avg_asymmetry_pct = EXCLUDED.avg_asymmetry_pct,
      velocity_loss_pct = EXCLUDED.velocity_loss_pct,
      dominant_side     = EXCLUDED.dominant_side,
      strength_profile  = EXCLUDED.strength_profile,
      form_score        = EXCLUDED.form_score,
      deload_warnings   = EXCLUDED.deload_warnings,
      rom_violations    = EXCLUDED.rom_violations,
      spotter_activations = EXCLUDED.spotter_activations,
      peak_force_n      = EXCLUDED.peak_force_n,
      estimated_calories = EXCLUDED.estimated_calories,
      heaviest_lift_kg  = EXCLUDED.heaviest_lift_kg,
      eccentric_load    = EXCLUDED.eccentric_load,
      echo_level        = EXCLUDED.echo_level,
      updated_at        = NOW(),
      client_updated_at = EXCLUDED.client_updated_at
    -- R-13: never write across owners, whatever the Edge pre-check saw.
    WHERE ws.user_id = EXCLUDED.user_id
      AND (COALESCE(ws.client_updated_at, ws.updated_at) IS NULL
           OR COALESCE(ws.client_updated_at, ws.updated_at) <= EXCLUDED.client_updated_at)
    RETURNING ws.client_updated_at INTO v_stored;

    IF FOUND THEN
      RETURN QUERY SELECT rec.id::text, TRUE, v_stored;
    ELSE
      RETURN QUERY
        SELECT rec.id::text, FALSE,
               CASE WHEN ws.user_id = rec.user_id
                    THEN COALESCE(ws.client_updated_at, ws.updated_at) END
          FROM public.workout_sessions ws WHERE ws.id = rec.id;
    END IF;
  END LOOP;
END;
$$;

-- Caller-rights RPC: service_role only (mobile push). Browser roles could
-- otherwise forge rows (PR 10 R-1); the SPA never calls it.
REVOKE ALL ON FUNCTION public.upsert_workout_session_lww(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workout_session_lww(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- upsert_routine_lww (starts from 20260920002100; KD-3 3a)
-- ---------------------------------------------------------------------------
-- Same two changes as the session RPC: the R-13 ownership guard and the
-- undated-push rule documented above.
CREATE OR REPLACE FUNCTION public.upsert_routine_lww(p_rows jsonb)
RETURNS TABLE(id text, accepted boolean, server_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
  v_incoming timestamptz;
  v_stored timestamptz;
BEGIN
  FOR rec IN
    SELECT * FROM jsonb_populate_recordset(NULL::public.routines, p_rows)
  LOOP
    v_incoming := COALESCE(rec.client_updated_at, rec.updated_at, NOW());

    INSERT INTO public.routines AS r (
      id, user_id, local_profile_id, name, description, estimated_duration,
      exercise_count, is_favorite, last_used_at, tags, times_completed,
      created_at, updated_at, client_updated_at
    ) VALUES (
      rec.id, rec.user_id, rec.local_profile_id, rec.name,
      COALESCE(rec.description, ''),
      COALESCE(rec.estimated_duration, 0),
      COALESCE(rec.exercise_count, 0),
      COALESCE(rec.is_favorite, FALSE),
      rec.last_used_at, rec.tags,
      COALESCE(rec.times_completed, 0),
      COALESCE(rec.created_at, NOW()),
      NOW(),
      v_incoming
    )
    ON CONFLICT (id) DO UPDATE SET
      name               = EXCLUDED.name,
      description        = EXCLUDED.description,
      estimated_duration = EXCLUDED.estimated_duration,
      exercise_count     = EXCLUDED.exercise_count,
      is_favorite        = EXCLUDED.is_favorite,
      last_used_at       = EXCLUDED.last_used_at,
      tags               = EXCLUDED.tags,
      times_completed    = EXCLUDED.times_completed,
      updated_at         = NOW(),
      client_updated_at  = EXCLUDED.client_updated_at
    -- R-13: never write across owners, whatever the Edge pre-check saw.
    WHERE r.user_id = EXCLUDED.user_id
      AND (COALESCE(r.client_updated_at, r.updated_at) IS NULL
           OR COALESCE(r.client_updated_at, r.updated_at) <= EXCLUDED.client_updated_at)
    RETURNING r.client_updated_at INTO v_stored;

    IF FOUND THEN
      RETURN QUERY SELECT rec.id::text, TRUE, v_stored;
    ELSE
      RETURN QUERY
        SELECT rec.id::text, FALSE,
               CASE WHEN r.user_id = rec.user_id
                    THEN COALESCE(r.client_updated_at, r.updated_at) END
          FROM public.routines r WHERE r.id = rec.id;
    END IF;
  END LOOP;
END;
$$;

-- Caller-rights RPC: service_role only (mobile push). Browser roles could
-- otherwise forge rows (PR 10 R-1); the SPA never calls it.
REVOKE ALL ON FUNCTION public.upsert_routine_lww(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_routine_lww(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- merge_training_cycles_from_push (starts from 20260920002100; KD-3 3a)
-- ---------------------------------------------------------------------------
-- Changes from the 002100 body (which itself starts from PR 19's 001901 and
-- keeps every PR 19 progression rule):
--   * R-3/R-6: a fourth output column, client_updated_at — the stored LWW
--     key. server_updated_at keeps its KD-6 meaning (the stored server-clock
--     updated_at that the push response hands back as the device's
--     baseUpdatedAt), and the Edge reports client_updated_at in
--     `rejections`, so rejections[].serverUpdatedAt means the same thing for
--     sessions, routines and cycles. The return type changes, so the
--     function is dropped and recreated (KD-3 rule 3); the
--     upsert_training_cycle_lww wrapper selects named columns and is
--     unaffected.
--   * R-2: the LWW gate is skipped when the push demonstrably knows about
--     the portal edit that produced the stored key — the stored key IS that
--     portal stamp (client_updated_at = portal_edited_at) and the push's
--     base_updated_at is at or after it (ms-truncated, matching the
--     staleness rule). That is the clock-skew window closing for cycles; a
--     genuinely stale push still has base < portal_edited_at and is still
--     rejected.
--   * Everything else is unchanged from 002100.
DROP FUNCTION IF EXISTS public.merge_training_cycles_from_push(UUID, JSONB, BOOLEAN);

CREATE FUNCTION public.merge_training_cycles_from_push(
  p_user_id UUID,
  p_cycles JSONB,
  p_use_lww BOOLEAN
)
RETURNS TABLE(
  id TEXT,
  accepted BOOLEAN,
  server_updated_at TIMESTAMPTZ,
  structure_applied BOOLEAN,
  client_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_item JSONB;
  v_day JSONB;
  rec public.training_cycles%ROWTYPE;
  v_existing public.training_cycles%ROWTYPE;
  v_day_rec public.cycle_days%ROWTYPE;
  v_found BOOLEAN;
  v_inserted BOOLEAN;
  v_has_days BOOLEAN;
  v_day_count INT;
  v_derived_weeks INT;
  v_base TIMESTAMPTZ;
  v_has_base BOOLEAN;
  v_stale BOOLEAN;
  v_knows_portal_edit BOOLEAN;
  v_cycle_changed INT;
  v_days_changed INT;
  v_rows INT;
  v_day_numbers INT[];
  v_routine_id UUID;
  n_name TEXT;
  n_description TEXT;
  n_duration_weeks INT;
  n_workout_days INT;
  n_rest_days INT;
  n_current_week INT;
  n_status TEXT;
  n_progression JSONB;
  n_deload JSONB;
  n_template_id TEXT;
  -- Keys of the mobile CycleProgression DTO (Project-Phoenix-MP
  -- PortalSyncAdapter.toPortalTrainingCycle).
  c_mobile_progression_keys CONSTANT TEXT[] := ARRAY[
    'frequencyCycles', 'weightIncreasePercent', 'echoLevelIncrease',
    'eccentricLoadIncreasePercent'
  ];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'merge_training_cycles_from_push: p_user_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_cycles IS NULL OR jsonb_typeof(p_cycles) <> 'array' THEN
    RAISE EXCEPTION 'merge_training_cycles_from_push: p_cycles must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_cycles)
  LOOP
    rec := jsonb_populate_record(NULL::public.training_cycles, v_item);
    IF rec.id IS NULL THEN
      RAISE EXCEPTION 'merge_training_cycles_from_push: cycle id is required'
        USING ERRCODE = '22023';
    END IF;
    rec.user_id := p_user_id;

    v_has_days := jsonb_typeof(v_item -> 'days') = 'array';
    v_day_count := CASE WHEN v_has_days THEN jsonb_array_length(v_item -> 'days') END;
    v_derived_weeks := CASE
      WHEN NOT v_has_days THEN NULL
      WHEN v_day_count = 0 THEN 1
      ELSE ceil(v_day_count / 7.0)::INT
    END;

    v_base := NULL;
    IF jsonb_typeof(v_item -> 'base_updated_at') = 'string' THEN
      BEGIN
        v_base := (v_item ->> 'base_updated_at')::TIMESTAMPTZ;
      EXCEPTION WHEN others THEN
        -- Unparseable base: treat as absent (legacy rules).
        v_base := NULL;
      END;
    END IF;
    v_has_base := v_base IS NOT NULL;

    v_inserted := FALSE;
    SELECT c.* INTO v_existing FROM public.training_cycles c WHERE c.id = rec.id FOR UPDATE;
    v_found := FOUND;

    IF NOT v_found THEN
      INSERT INTO public.training_cycles AS c (
        id, user_id, local_profile_id, name, description, duration_weeks,
        workout_days, rest_days, current_week, status, started_at,
        last_used_at, progression_settings, deload_settings, template_id,
        updated_at, client_updated_at
      ) VALUES (
        rec.id, p_user_id, rec.local_profile_id, rec.name, COALESCE(rec.description, ''),
        COALESCE(rec.duration_weeks, 4),
        COALESCE(rec.workout_days, 0),
        COALESCE(rec.rest_days, 0),
        COALESCE(rec.current_week, 1),
        COALESCE(rec.status, 'draft'),
        rec.started_at, rec.last_used_at, rec.progression_settings,
        rec.deload_settings, rec.template_id, now(),
        COALESCE(rec.updated_at, now())
      )
      ON CONFLICT (id) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 1 THEN
        v_inserted := TRUE;
      ELSE
        -- Lost a race with a concurrent insert of the same id: merge into it.
        SELECT c.* INTO v_existing FROM public.training_cycles c WHERE c.id = rec.id FOR UPDATE;
        v_found := FOUND;
      END IF;
    END IF;

    v_stale := FALSE;
    IF NOT v_inserted THEN
      IF NOT v_found THEN
        -- Inserted and deleted concurrently; nothing to merge into.
        id := rec.id::TEXT; accepted := FALSE; server_updated_at := NULL;
        structure_applied := FALSE; client_updated_at := NULL;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_existing.user_id IS DISTINCT FROM p_user_id THEN
        id := rec.id::TEXT; accepted := FALSE; server_updated_at := NULL;
        structure_applied := FALSE; client_updated_at := NULL;
        RETURN NEXT;
        CONTINUE;
      END IF;

      -- R-2: the stored key is a portal stamp this push already knows about
      -- (its base is at or after that edit), so a device clock behind the
      -- server must not lose its genuinely newer edit.
      -- COALESCE is load-bearing: with client_updated_at NULL (a row the
      -- backfill never reached) the `=` yields NULL, and `IF p_use_lww AND
      -- NOT NULL AND ...` is NULL, which plpgsql treats as false — the
      -- rejection branch would be skipped and every stale push accepted.
      v_knows_portal_edit := COALESCE(
        v_has_base
          AND v_existing.portal_edited_at IS NOT NULL
          AND v_existing.client_updated_at = v_existing.portal_edited_at
          AND date_trunc('milliseconds', v_base)
              >= date_trunc('milliseconds', v_existing.portal_edited_at),
        FALSE);

      IF p_use_lww
         AND NOT v_knows_portal_edit
         AND NOT (COALESCE(v_existing.client_updated_at, v_existing.updated_at) IS NULL
                  OR COALESCE(v_existing.client_updated_at, v_existing.updated_at) <= rec.updated_at) THEN
        id := rec.id::TEXT; accepted := FALSE;
        server_updated_at := v_existing.updated_at; structure_applied := FALSE;
        client_updated_at := COALESCE(v_existing.client_updated_at, v_existing.updated_at);
        RETURN NEXT;
        CONTINUE;
      END IF;

      v_stale := v_has_base
        AND v_existing.portal_edited_at IS NOT NULL
        AND date_trunc('milliseconds', v_existing.portal_edited_at)
            > date_trunc('milliseconds', v_base);

      n_name := CASE WHEN v_stale THEN v_existing.name
                     ELSE COALESCE(rec.name, v_existing.name) END;
      n_description := CASE WHEN v_stale THEN v_existing.description
                            ELSE COALESCE(rec.description, v_existing.description) END;
      n_workout_days := CASE WHEN v_stale THEN v_existing.workout_days
                             ELSE COALESCE(rec.workout_days, v_existing.workout_days) END;
      n_rest_days := CASE WHEN v_stale THEN v_existing.rest_days
                          ELSE COALESCE(rec.rest_days, v_existing.rest_days) END;
      -- Keep a duration set on the portal against mobile's derived default
      -- only; otherwise (incl. cycles merely renamed/activated on the
      -- portal) the phone's value wins (review R-3, round 2).
      n_duration_weeks := CASE
        WHEN rec.duration_weeks IS NULL THEN v_existing.duration_weeks
        WHEN v_existing.portal_duration_set_at IS NOT NULL
             AND rec.duration_weeks = v_derived_weeks THEN v_existing.duration_weeks
        ELSE rec.duration_weeks
      END;
      n_current_week := COALESCE(rec.current_week, v_existing.current_week);
      n_status := COALESCE(rec.status, v_existing.status);
      -- Progression (PR 19 R-10). Only a current (non-stale) push with a
      -- non-null progression object is authoritative for the mobile keys:
      -- it replaces them, and a mobile key missing from it is removed
      -- (mobile encodes sparsely). A NULL incoming (older build, no local
      -- progression row, or a failed decode) and a stale push keep the
      -- stored settings unchanged. Portal-only keys always survive.
      IF v_stale OR rec.progression_settings IS NULL THEN
        n_progression := v_existing.progression_settings;
      ELSIF jsonb_typeof(rec.progression_settings) <> 'object'
            OR v_existing.progression_settings IS NULL
            OR jsonb_typeof(v_existing.progression_settings) <> 'object' THEN
        n_progression := rec.progression_settings;
      ELSE
        n_progression := (v_existing.progression_settings - c_mobile_progression_keys)
                         || rec.progression_settings;
      END IF;
      -- Same normalization the BEFORE trigger applies, so the no-op check
      -- below compares like with like.
      n_progression := public.normalize_cycle_progression_settings(n_progression);
      n_deload := COALESCE(rec.deload_settings, v_existing.deload_settings);
      n_template_id := COALESCE(rec.template_id, v_existing.template_id);

      -- updated_at is trigger-owned on UPDATE (cycles_updated_at). The LWW
      -- key follows every applied change but is not part of the no-op check.
      UPDATE public.training_cycles c SET
        local_profile_id     = rec.local_profile_id,
        name                 = n_name,
        description          = n_description,
        duration_weeks       = n_duration_weeks,
        workout_days         = n_workout_days,
        rest_days            = n_rest_days,
        current_week         = n_current_week,
        status               = n_status,
        started_at           = rec.started_at,
        last_used_at         = rec.last_used_at,
        progression_settings = n_progression,
        deload_settings      = n_deload,
        template_id          = n_template_id,
        client_updated_at    = COALESCE(rec.updated_at, now())
      WHERE c.id = rec.id
        AND c.user_id = p_user_id
        AND (
          c.local_profile_id, c.name, c.description, c.duration_weeks,
          c.workout_days, c.rest_days, c.current_week, c.status,
          c.started_at, c.last_used_at, c.progression_settings,
          c.deload_settings, c.template_id
        ) IS DISTINCT FROM (
          rec.local_profile_id, n_name, n_description, n_duration_weeks,
          n_workout_days, n_rest_days, n_current_week, n_status,
          rec.started_at, rec.last_used_at, n_progression,
          n_deload, n_template_id
        );
      GET DIAGNOSTICS v_cycle_changed = ROW_COUNT;
    ELSE
      v_cycle_changed := 1;
    END IF;

    -- Days: only when the push carries a day list and its structure applies.
    v_days_changed := 0;
    IF v_has_days AND NOT v_stale THEN
      v_day_numbers := ARRAY[]::INT[];
      FOR v_day IN SELECT value FROM jsonb_array_elements(v_item -> 'days')
      LOOP
        v_day_rec := jsonb_populate_record(NULL::public.cycle_days, v_day);
        IF v_day_rec.day_number IS NULL THEN
          RAISE EXCEPTION 'merge_training_cycles_from_push: day_number is required'
            USING ERRCODE = '22023';
        END IF;
        v_day_numbers := v_day_numbers || v_day_rec.day_number;

        -- Only the caller's own routines may be referenced; anything else
        -- (deleted meanwhile, missing, foreign) is stored as NULL, matching
        -- the FK's ON DELETE SET NULL.
        v_routine_id := NULL;
        IF v_day_rec.routine_id IS NOT NULL THEN
          SELECT r.id INTO v_routine_id
            FROM public.routines r
           WHERE r.id = v_day_rec.routine_id AND r.user_id = p_user_id;
        END IF;

        INSERT INTO public.cycle_days AS d (
          cycle_id, day_number, day_type, routine_id, weight_adjustment,
          rep_modifier, rest_override, rest_type, notes
        ) VALUES (
          rec.id, v_day_rec.day_number,
          COALESCE(v_day_rec.day_type, 'workout'),
          v_routine_id,
          COALESCE(v_day_rec.weight_adjustment, 0),
          COALESCE(v_day_rec.rep_modifier, 0),
          v_day_rec.rest_override, v_day_rec.rest_type, v_day_rec.notes
        )
        ON CONFLICT (cycle_id, day_number) DO UPDATE SET
          day_type          = EXCLUDED.day_type,
          routine_id        = EXCLUDED.routine_id,
          weight_adjustment = EXCLUDED.weight_adjustment,
          rep_modifier      = EXCLUDED.rep_modifier,
          rest_override     = EXCLUDED.rest_override,
          -- rest_type is kept on NULL only while the day type is unchanged.
          rest_type         = CASE WHEN EXCLUDED.day_type IS NOT DISTINCT FROM d.day_type
                                 THEN COALESCE(EXCLUDED.rest_type, d.rest_type)
                                 ELSE EXCLUDED.rest_type END,
          notes             = EXCLUDED.notes
        WHERE (
          d.day_type, d.routine_id, d.weight_adjustment, d.rep_modifier,
          d.rest_override, d.rest_type, d.notes
        ) IS DISTINCT FROM (
          EXCLUDED.day_type, EXCLUDED.routine_id, EXCLUDED.weight_adjustment,
          EXCLUDED.rep_modifier, EXCLUDED.rest_override,
          CASE WHEN EXCLUDED.day_type IS NOT DISTINCT FROM d.day_type
            THEN COALESCE(EXCLUDED.rest_type, d.rest_type)
            ELSE EXCLUDED.rest_type END,
          EXCLUDED.notes
        );
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_days_changed := v_days_changed + v_rows;
      END LOOP;

      IF v_has_base THEN
        DELETE FROM public.cycle_days d
         WHERE d.cycle_id = rec.id
           AND NOT (d.day_number = ANY (v_day_numbers));
      ELSE
        -- Legacy build: only days beyond the payload's highest day_number.
        DELETE FROM public.cycle_days d
         WHERE d.cycle_id = rec.id
           AND d.day_number > COALESCE(
             (SELECT max(x) FROM unnest(v_day_numbers) AS x), -1);
      END IF;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_days_changed := v_days_changed + v_rows;
    END IF;

    -- Day-only change on an existing cycle: advance the pull cursor.
    IF NOT v_inserted AND v_cycle_changed = 0 AND v_days_changed > 0 THEN
      UPDATE public.training_cycles c
         SET updated_at = now(), client_updated_at = COALESCE(rec.updated_at, now())
       WHERE c.id = rec.id;
    END IF;

    id := rec.id::TEXT;
    accepted := TRUE;
    SELECT c.updated_at, c.client_updated_at
      INTO server_updated_at, client_updated_at
      FROM public.training_cycles c WHERE c.id = rec.id;
    structure_applied := NOT v_stale;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_training_cycles_from_push(UUID, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_training_cycles_from_push(UUID, JSONB, BOOLEAN)
  TO service_role;

-- upsert_training_cycle_lww still delegates here. Its body selects the
-- merge's columns by name, and plpgsql resolves the call at runtime, so the
-- DROP/CREATE above needs no change to the wrapper (and its grants are left
-- exactly as they are).
