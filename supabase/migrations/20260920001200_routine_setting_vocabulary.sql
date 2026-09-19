-- Store routine-exercise advanced settings in mobile's vocabulary.
--
-- Problem: the portal routine builder wrote its own vocabulary, which the
-- phone does not understand:
--   eccentric_load    light | moderate | heavy
--   echo_level        low | medium | high
--   rep_count_timing  free text (placeholder "2-0-2")
--   stop_at_position  free text (placeholder "Lockout")
--   superset_color    hex (#6366F1 / #EC4899 / #10B981 / #F59E0B)
-- Mobile (Project-Phoenix-MP) parses these as:
--   eccentric_load    LOAD_<n> or a number, else 100%   (PortalPullAdapter.kt:396-403)
--   echo_level        HARD|HARDER|HARDEST|EPIC (uppercased), else HARDER
--                                                        (PortalPullAdapter.kt:409-415)
--   rep_count_timing  RepCountTiming.valueOf (case-sensitive TOP|BOTTOM), else TOP
--                                                        (SqlDelightSyncRepository.kt:2346, 1092-1098)
--   stop_at_position  stopAtTop only for exactly 'TOP'  (SqlDelightSyncRepository.kt:2345)
--   superset_color    indigo|pink|green|amber (lowercased), else the superset's
--                     order index                      (SqlDelightSyncRepository.kt:2236-2248)
-- So every legacy portal value already trained as the phone's default.
--
-- Fix: rewrite legacy values to what the machine actually did.
--   * eccentric_load: light/moderate/heavy (or blank) -> NULL (mobile default 100%);
--     enum names in another case -> upper case.
--   * echo_level: low/medium/high (or blank) -> NULL (mobile default HARDER);
--     enum names in another case -> upper case.
--   * rep_count_timing: NULL unless exactly 'TOP' or 'BOTTOM' (mobile default TOP).
--   * stop_at_position: NULL unless exactly 'TOP' or 'BOTTOM' (only 'TOP' stops).
--   * superset_color: the portal's four hex values -> their names (fixed table
--     below, in mobile's SupersetColors index order); names in another case ->
--     lower case. Any other value is left untouched (mobile falls back to the
--     superset's order index either way).
-- Values mobile itself writes (enum names, via PortalSyncAdapter.kt:586-615)
-- are never changed. Unknown eccentric/echo/colour values other than the legacy
-- portal ones are left alone and show up in the post-check.
--
-- The SPA writer (src/mutations/routines.ts) and reader (src/schemas/
-- transforms.ts) apply the same vocabulary via
-- supabase/functions/_shared/workoutModes.ts, so the SPA is correct whether
-- or not this migration has run yet.
--
-- Pure data backfill: no functions, triggers, or grants. Idempotent: every
-- UPDATE is guarded by IS DISTINCT FROM, so a re-run changes 0 rows.
--
-- routines.updated_at is deliberately NOT bumped, for the reasons given in
-- 20260920001100_normalize_routine_exercise_modes.sql. In addition, every
-- rewrite here maps a value to what the phone already parsed it to, so a
-- device holding the old value trains identically; only the superset colour
-- index can differ, which is cosmetic.
--
-- Operator pre-check (read-only; rows per column that this migration changes):
--   SELECT
--     count(*) FILTER (WHERE lower(btrim(eccentric_load)) IN ('light','moderate','heavy','')
--                         OR (upper(btrim(eccentric_load)) IN ('LOAD_0','LOAD_50','LOAD_75','LOAD_100','LOAD_110','LOAD_120','LOAD_130','LOAD_140','LOAD_150')
--                             AND eccentric_load <> upper(btrim(eccentric_load)))) AS eccentric_load,
--     count(*) FILTER (WHERE lower(btrim(echo_level)) IN ('low','medium','high','')
--                         OR (upper(btrim(echo_level)) IN ('HARD','HARDER','HARDEST','EPIC')
--                             AND echo_level <> upper(btrim(echo_level)))) AS echo_level,
--     count(*) FILTER (WHERE rep_count_timing IS NOT NULL
--                        AND rep_count_timing NOT IN ('TOP','BOTTOM')) AS rep_count_timing,
--     count(*) FILTER (WHERE stop_at_position IS NOT NULL
--                        AND stop_at_position NOT IN ('TOP','BOTTOM')) AS stop_at_position,
--     count(*) FILTER (WHERE upper(btrim(superset_color)) IN ('#6366F1','#EC4899','#10B981','#F59E0B')
--                         OR (lower(btrim(superset_color)) IN ('indigo','pink','green','amber')
--                             AND superset_color <> lower(btrim(superset_color)))) AS superset_color
--   FROM public.routine_exercises;
-- Post-check (expect 0 in every column unless the pre-check revealed values
-- outside both vocabularies, which are intentionally left alone):
--   SELECT
--     count(*) FILTER (WHERE eccentric_load IS NOT NULL AND eccentric_load NOT IN
--       ('LOAD_0','LOAD_50','LOAD_75','LOAD_100','LOAD_110','LOAD_120','LOAD_130','LOAD_140','LOAD_150')) AS eccentric_load,
--     count(*) FILTER (WHERE echo_level IS NOT NULL AND echo_level NOT IN
--       ('HARD','HARDER','HARDEST','EPIC')) AS echo_level,
--     count(*) FILTER (WHERE rep_count_timing IS NOT NULL
--                        AND rep_count_timing NOT IN ('TOP','BOTTOM')) AS rep_count_timing,
--     count(*) FILTER (WHERE stop_at_position IS NOT NULL
--                        AND stop_at_position NOT IN ('TOP','BOTTOM')) AS stop_at_position,
--     count(*) FILTER (WHERE superset_color IS NOT NULL AND superset_color NOT IN
--       ('indigo','pink','green','amber')) AS superset_color
--   FROM public.routine_exercises;

-- Eccentric load (Models.kt:313-323).
UPDATE public.routine_exercises
SET eccentric_load = CASE
    WHEN lower(btrim(eccentric_load)) IN ('light', 'moderate', 'heavy', '') THEN NULL
    ELSE upper(btrim(eccentric_load))
  END
WHERE eccentric_load IS NOT NULL
  AND (
    lower(btrim(eccentric_load)) IN ('light', 'moderate', 'heavy', '')
    OR (
      upper(btrim(eccentric_load)) IN (
        'LOAD_0', 'LOAD_50', 'LOAD_75', 'LOAD_100', 'LOAD_110',
        'LOAD_120', 'LOAD_130', 'LOAD_140', 'LOAD_150'
      )
      AND eccentric_load IS DISTINCT FROM upper(btrim(eccentric_load))
    )
  );

-- Echo level (Models.kt:302-307).
UPDATE public.routine_exercises
SET echo_level = CASE
    WHEN lower(btrim(echo_level)) IN ('low', 'medium', 'high', '') THEN NULL
    ELSE upper(btrim(echo_level))
  END
WHERE echo_level IS NOT NULL
  AND (
    lower(btrim(echo_level)) IN ('low', 'medium', 'high', '')
    OR (
      upper(btrim(echo_level)) IN ('HARD', 'HARDER', 'HARDEST', 'EPIC')
      AND echo_level IS DISTINCT FROM upper(btrim(echo_level))
    )
  );

-- Rep count timing (Models.kt:338-341): free text -> NULL (mobile default TOP).
UPDATE public.routine_exercises
SET rep_count_timing = NULL
WHERE rep_count_timing IS NOT NULL
  AND rep_count_timing NOT IN ('TOP', 'BOTTOM');

-- Stop-at position: free text -> NULL (only exactly 'TOP' stops on mobile).
UPDATE public.routine_exercises
SET stop_at_position = NULL
WHERE stop_at_position IS NOT NULL
  AND stop_at_position NOT IN ('TOP', 'BOTTOM');

-- Superset colour: fixed hex -> name table (the portal's only four colours,
-- RoutineBuilder.tsx SUPERSET_COLORS), plus lower-casing of names.
UPDATE public.routine_exercises AS re
SET superset_color = m.name
FROM (
  VALUES
    ('#6366F1', 'indigo'),
    ('#EC4899', 'pink'),
    ('#10B981', 'green'),
    ('#F59E0B', 'amber'),
    ('INDIGO', 'indigo'),
    ('PINK', 'pink'),
    ('GREEN', 'green'),
    ('AMBER', 'amber')
) AS m(stored_upper, name)
WHERE upper(btrim(re.superset_color)) = m.stored_upper
  AND re.superset_color IS DISTINCT FROM m.name;
