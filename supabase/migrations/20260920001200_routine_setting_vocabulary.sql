-- Store routine-exercise advanced settings in mobile's vocabulary.
--
-- Problem: the portal routine builder wrote its own vocabulary:
--   eccentric_load    light | moderate | heavy
--   echo_level        low | medium | high
--   rep_count_timing  free text (placeholder "2-0-2")
--   stop_at_position  free text (placeholder "Lockout")
--   superset_color    hex (#6366F1 / #EC4899 / #10B981 / #F59E0B, the only
--                     four the portal ever wrote)
-- The phone (Project-Phoenix-MP) reads them as:
--   eccentric_load    PortalPullAdapter.kt:396-403 parseEccentricLoad: case-
--                     sensitive removePrefix("LOAD_") then toLongOrNull, else
--                     100%; no trimming. The Long is later read with toInt(),
--                     coerceIn(0,150) and the nearest EccentricLoad
--                     (SqlDelightWorkoutRepository.kt:449-482).
--   echo_level        PortalPullAdapter.kt:409-415: uppercase() (no trim) must
--                     be HARD|HARDER|HARDEST|EPIC, else HARDER.
--   rep_count_timing  RepCountTiming.valueOf, case-sensitive TOP|BOTTOM, else
--                     TOP (SqlDelightSyncRepository.kt:2346, 1092-1098).
--   stop_at_position  stops only for exactly 'TOP' (SqlDelightSyncRepository.kt:2345).
--   superset_color    lowercase() (no trim) must be indigo|pink|green|amber,
--                     else toLongOrNull as a colour index, else the superset's
--                     order index (SqlDelightSyncRepository.kt:2236-2248).
-- So every legacy portal value already trained as the phone's default.
--
-- Fix: public.normalize_* functions compute "what the phone does with this
-- value" and store that:
--   * a value the phone replaces with its default -> NULL;
--   * a value the phone uses -> its canonical enum name (e.g. 'hard' -> 'HARD',
--     '120' / 'LOAD_+120' -> 'LOAD_120', 'Indigo' / '2' -> 'indigo' / 'green');
--   * eccentric numbers that are not an enum percentage ('LOAD_25', '999')
--     and colour indexes outside 0-3 are kept verbatim: the phone rounds /
--     uses them itself, and a newer build may mean something by them;
--   * the four legacy portal hex colours -> their names (a deliberate remap:
--     the phone used the order-index fallback for them; exact match is the
--     nearest named colour because the portal wrote no other hex values).
--   * stop_at_position keeps only 'TOP' ('BOTTOM' never stopped anything).
-- They mirror supabase/functions/_shared/workoutModes.ts
-- (normalizeEccentricLoad, toEchoLevel, toRepCountTiming, toStopAtPosition,
-- toSupersetColorName); tests pin both with the same cases
-- (tests/contract/routine-setting-vocabulary.test.ts,
-- supabase/tests/database/routine_setting_vocabulary.test.sql).
--
-- A BEFORE INSERT/UPDATE trigger applies them to every writer, so community
-- imports of snapshots published before this migration
-- (insert_routine_exercises_from_snapshot), stale SPA tabs and Edge pushes
-- all store the same vocabulary. It never rejects a row. For values mobile
-- itself writes (enum names, PortalSyncAdapter.kt:586-615) it is a no-op.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and the backfill
-- only touches rows that still change.
--
-- routines.updated_at is deliberately NOT bumped, for the reasons given in
-- 20260920001100_normalize_routine_exercise_modes.sql. In addition every
-- rewrite here maps a value to what the phone already did with it, so a
-- device holding the old value trains identically; only a legacy hex colour
-- changes a superset's colour index, which is cosmetic.
--
-- Operator pre-check (read-only). First look at what is actually stored:
--   SELECT eccentric_load, echo_level, rep_count_timing, stop_at_position,
--          superset_color, count(*)
--   FROM public.routine_exercises
--   GROUP BY 1, 2, 3, 4, 5 ORDER BY count(*) DESC;
-- Rows per column that the backfill will change (run after this migration's
-- functions exist, e.g. inside a transaction that is rolled back):
--   SELECT
--     count(*) FILTER (WHERE eccentric_load IS DISTINCT FROM public.normalize_eccentric_load(eccentric_load)) AS eccentric_load,
--     count(*) FILTER (WHERE echo_level IS DISTINCT FROM public.normalize_echo_level(echo_level)) AS echo_level,
--     count(*) FILTER (WHERE rep_count_timing IS DISTINCT FROM public.normalize_rep_count_timing(rep_count_timing)) AS rep_count_timing,
--     count(*) FILTER (WHERE stop_at_position IS DISTINCT FROM public.normalize_stop_at_position(stop_at_position)) AS stop_at_position,
--     count(*) FILTER (WHERE superset_color IS DISTINCT FROM public.normalize_superset_color(superset_color)) AS superset_color
--   FROM public.routine_exercises;
-- Post-check: the same query must return 0 in every column. Values outside
-- the enum lists that remain are the intentionally kept ones (eccentric
-- off-list numbers, colour indexes > 3):
--   SELECT count(*) FILTER (WHERE eccentric_load IS NOT NULL AND eccentric_load NOT IN
--       ('LOAD_0','LOAD_50','LOAD_75','LOAD_100','LOAD_110','LOAD_120','LOAD_130','LOAD_140','LOAD_150')) AS eccentric_kept,
--     count(*) FILTER (WHERE superset_color IS NOT NULL AND superset_color NOT IN
--       ('indigo','pink','green','amber')) AS colour_index_kept
--   FROM public.routine_exercises;

-- Kotlin String.toLongOrNull for ASCII input (sign, digits, Long range; no
-- whitespace). Returns NUMERIC so the Long range can be checked.
CREATE OR REPLACE FUNCTION public.kotlin_to_long_or_null(p_value TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_number NUMERIC;
BEGIN
  IF p_value IS NULL OR p_value !~ '^[+-]?[0-9]+$' THEN
    RETURN NULL;
  END IF;
  v_number := p_value::NUMERIC;
  IF v_number < -9223372036854775808 OR v_number > 9223372036854775807 THEN
    RETURN NULL;
  END IF;
  RETURN v_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_eccentric_load(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_long NUMERIC;
  v_int NUMERIC;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  -- Case-sensitive removePrefix("LOAD_") (left() compares exactly).
  v_long := public.kotlin_to_long_or_null(
    CASE WHEN left(p_value, 5) = 'LOAD_' THEN substr(p_value, 6) ELSE p_value END
  );
  IF v_long IS NULL THEN
    RETURN NULL;  -- mobile default (100%)
  END IF;
  -- Long.toInt(): low 32 bits, two's complement.
  v_int := mod(mod(v_long + 2147483648, 4294967296) + 4294967296, 4294967296)
           - 2147483648;
  IF v_int IN (0, 50, 75, 100, 110, 120, 130, 140, 150) THEN
    RETURN 'LOAD_' || v_int::INT;
  END IF;
  RETURN p_value;  -- off-list number: the phone rounds it itself
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_echo_level(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN upper(p_value) IN ('HARD', 'HARDER', 'HARDEST', 'EPIC') THEN upper(p_value)
  END
$$;

CREATE OR REPLACE FUNCTION public.normalize_rep_count_timing(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE WHEN p_value IN ('TOP', 'BOTTOM') THEN p_value END
$$;

CREATE OR REPLACE FUNCTION public.normalize_stop_at_position(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE WHEN p_value = 'TOP' THEN 'TOP' END
$$;

CREATE OR REPLACE FUNCTION public.normalize_superset_color(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_index NUMERIC;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  IF lower(p_value) IN ('indigo', 'pink', 'green', 'amber') THEN
    RETURN lower(p_value);
  END IF;
  -- The portal's four legacy hex values (its only colours), in SupersetColors order.
  CASE upper(p_value)
    WHEN '#6366F1' THEN RETURN 'indigo';
    WHEN '#EC4899' THEN RETURN 'pink';
    WHEN '#10B981' THEN RETURN 'green';
    WHEN '#F59E0B' THEN RETURN 'amber';
    ELSE NULL;
  END CASE;
  v_index := public.kotlin_to_long_or_null(p_value);
  IF v_index IS NULL THEN
    RETURN NULL;  -- mobile falls back to the superset's order index
  END IF;
  IF v_index BETWEEN 0 AND 3 THEN
    RETURN (ARRAY['indigo', 'pink', 'green', 'amber'])[v_index::INT + 1];
  END IF;
  RETURN p_value;  -- other colour index: mobile uses it as-is
END;
$$;

-- Pure helpers, called at row time by the trigger below, whose body runs as
-- the writing role (authenticated via RLS, service_role from Edge), so both
-- need EXECUTE. anon never writes routine_exercises.
DO $$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.kotlin_to_long_or_null(TEXT)',
    'public.normalize_eccentric_load(TEXT)',
    'public.normalize_echo_level(TEXT)',
    'public.normalize_rep_count_timing(TEXT)',
    'public.normalize_stop_at_position(TEXT)',
    'public.normalize_superset_color(TEXT)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.routine_exercises_normalize_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.eccentric_load := public.normalize_eccentric_load(NEW.eccentric_load);
  NEW.echo_level := public.normalize_echo_level(NEW.echo_level);
  NEW.rep_count_timing := public.normalize_rep_count_timing(NEW.rep_count_timing);
  NEW.stop_at_position := public.normalize_stop_at_position(NEW.stop_at_position);
  NEW.superset_color := public.normalize_superset_color(NEW.superset_color);
  RETURN NEW;
END;
$$;

-- Only the trigger executes this (EXECUTE is checked at CREATE TRIGGER time).
REVOKE ALL ON FUNCTION public.routine_exercises_normalize_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.routine_exercises_normalize_settings() FROM anon;
REVOKE ALL ON FUNCTION public.routine_exercises_normalize_settings() FROM authenticated;

-- Backfill. On a first apply the trigger does not exist yet; on a re-run it
-- does and applies the same idempotent mapping.
UPDATE public.routine_exercises
SET eccentric_load = public.normalize_eccentric_load(eccentric_load),
    echo_level = public.normalize_echo_level(echo_level),
    rep_count_timing = public.normalize_rep_count_timing(rep_count_timing),
    stop_at_position = public.normalize_stop_at_position(stop_at_position),
    superset_color = public.normalize_superset_color(superset_color)
WHERE eccentric_load IS DISTINCT FROM public.normalize_eccentric_load(eccentric_load)
   OR echo_level IS DISTINCT FROM public.normalize_echo_level(echo_level)
   OR rep_count_timing IS DISTINCT FROM public.normalize_rep_count_timing(rep_count_timing)
   OR stop_at_position IS DISTINCT FROM public.normalize_stop_at_position(stop_at_position)
   OR superset_color IS DISTINCT FROM public.normalize_superset_color(superset_color);

DROP TRIGGER IF EXISTS routine_exercises_normalize_settings ON public.routine_exercises;
CREATE TRIGGER routine_exercises_normalize_settings
BEFORE INSERT OR UPDATE OF
  eccentric_load, echo_level, rep_count_timing, stop_at_position, superset_color
ON public.routine_exercises
FOR EACH ROW EXECUTE FUNCTION public.routine_exercises_normalize_settings();
