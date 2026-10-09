-- Issue #883 (Project-Phoenix-MP): portal carries the mobile belt-squat seed's stable IDs.
--
-- Architecture review condition A for Project-Phoenix-MP#883: exercise_catalog must hold
-- the same stable belt-squat ids (Belt_Squat / Sumo_Belt_Squat / Belt_Squat_Pulses) with
-- BELT equipment before the mobile release. exercise_catalog is the FK target for
-- exercise_id and mobile-sync-push resolves incoming ids through resolveCatalogExerciseId,
-- writing NULL when id and normalized name are both absent — so a mobile-only id would
-- silently push exercise_id=NULL and re-break issue #404 exercise identity.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:belt-squat-supplemental-catalog-seed');

SELECT results_eq(
    $$
      SELECT id, equipment, archived, is_custom
      FROM exercise_catalog
      WHERE id IN ('Belt_Squat', 'Sumo_Belt_Squat', 'Belt_Squat_Pulses')
      ORDER BY id
    $$,
    $$
      VALUES
        ('Belt_Squat', ARRAY['BELT']::text[], FALSE, FALSE),
        ('Belt_Squat_Pulses', ARRAY['BELT']::text[], FALSE, FALSE),
        ('Sumo_Belt_Squat', ARRAY['BELT']::text[], FALSE, FALSE)
    $$,
    'the three supplemental belt-squat ids exist as active library rows with BELT equipment'
);

SELECT ok(
    NOT EXISTS (
      SELECT 1 FROM exercise_catalog
      WHERE id = 'wger_1935' AND equipment && ARRAY['BELT']::text[]
    ),
    'the additive seed did not relabel the pre-existing wger_1935 Belt Squat row'
);

SELECT ok(
    NOT EXISTS (
      SELECT 1 FROM exercise_catalog
      WHERE name = 'Barbell Squat' AND equipment && ARRAY['BELT']::text[]
    ),
    'no barbell squat row carries BELT equipment (no false belt matches)'
);

SELECT * FROM finish();
ROLLBACK;
