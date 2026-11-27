BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(18);

INSERT INTO auth.users (id, email) VALUES
  ('93a08a46-6419-4057-9ca7-b4c7a1d24101', 'catalog-sync-a@example.test'),
  ('93a08a46-6419-4057-9ca7-b4c7a1d24102', 'catalog-sync-b@example.test');

CREATE FUNCTION pg_temp.exercise_row(
  id text, name text, archived boolean, updated_at timestamptz
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'id', id, 'name', name, 'display_name', name,
    'muscle_group', 'General', 'equipment', '[]'::jsonb,
    'default_cable_config', 'DOUBLE', 'archived', archived,
    'created_at', '2025-12-01T00:00:00Z', 'updated_at', updated_at
  );
$$;

SELECT ok(NOT has_function_privilege('authenticated',
  'public.upsert_mobile_custom_exercises(uuid,jsonb)', 'EXECUTE'),
  'authenticated callers cannot choose the user ID of a mobile write');
SELECT ok(has_function_privilege('service_role',
  'public.upsert_mobile_custom_exercises(uuid,jsonb)', 'EXECUTE'),
  'the Edge service role can write');

SELECT throws_ok(
  $$ SELECT upsert_mobile_custom_exercises(NULL, jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-ownerless', 'Ownerless', false, NULL)
  )) $$,
  '22023', 'p_user_id is required', 'a missing owner rejects the mutation');
SELECT throws_ok(
  $$ SELECT upsert_mobile_custom_exercises('93a08a46-6419-4057-9ca7-b4c7a1d24101', NULL) $$,
  '22023', 'p_rows must be a JSON array', 'a SQL null batch rejects the mutation');
SELECT throws_ok(
  $$ SELECT upsert_mobile_custom_exercises('93a08a46-6419-4057-9ca7-b4c7a1d24101', 'null') $$,
  '22023', 'p_rows must be a JSON array', 'a JSON null batch rejects the mutation');
SELECT throws_ok(
  $$ SELECT upsert_mobile_custom_exercises('93a08a46-6419-4057-9ca7-b4c7a1d24101', '{}') $$,
  '22023', 'p_rows must be a JSON array', 'a non-array batch rejects the mutation');

SELECT ok(upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24101', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-b-own', 'Dated edit', false, '2026-01-01T00:00:02Z'),
    pg_temp.exercise_row('catalog-sync-d-legacy', 'Legacy exercise', false, NULL)
  )), 'new dated and undated rows are accepted');

SELECT ok((SELECT updated_at = '2026-01-01T00:00:02Z' AND sync_updated_at > updated_at
  FROM exercise_catalog WHERE id = 'catalog-sync-b-own'),
  'a backdated insertion is visible to a recent incremental pull');
SELECT ok((SELECT updated_at > '2026-01-01T00:00:02Z'
  FROM exercise_catalog WHERE id = 'catalog-sync-d-legacy'),
  'an undated insertion receives a server LWW timestamp');

CREATE TEMP TABLE first_catalog_clock AS
  SELECT sync_updated_at FROM exercise_catalog WHERE id = 'catalog-sync-b-own';

SELECT ok(upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24101', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-b-own', 'Equal delete', true, '2026-01-01T00:00:02Z')
  )), 'equal-time delete and edit can be replayed without a push failure');
SELECT ok((SELECT archived AND updated_at = '2026-01-01T00:00:02Z'
    AND sync_updated_at > (SELECT sync_updated_at FROM first_catalog_clock)
  FROM exercise_catalog WHERE id = 'catalog-sync-b-own'),
  'the equal-time delete wins and advances only the incremental clock');

TRUNCATE first_catalog_clock;
INSERT INTO first_catalog_clock
  SELECT sync_updated_at FROM exercise_catalog WHERE id = 'catalog-sync-b-own';

SELECT ok(upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24101', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-b-own', 'Older edit', false, '2026-01-01T00:00:01Z')
  )) AND upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24101', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-b-own', 'Equal edit', false, '2026-01-01T00:00:02Z')
  )) AND upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24101', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-b-own', 'Undated edit', false, NULL)
  )), 'older, equal, and undated edits can be acknowledged over a tombstone');
SELECT ok((SELECT archived AND name = 'Equal delete'
    AND sync_updated_at = (SELECT sync_updated_at FROM first_catalog_clock)
  FROM exercise_catalog WHERE id = 'catalog-sync-b-own'),
  'ignored edits leave the tombstone and server clock untouched');

SELECT ok(upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24101', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-b-own', 'Newer restore', false, '2026-01-01T00:00:03Z')
      || '{"created_at":"2026-01-01T00:00:03Z"}'
  )), 'a strictly newer restore is accepted');
SELECT ok((SELECT NOT archived AND name = 'Newer restore'
    AND created_at = '2025-12-01T00:00:00Z'
    AND updated_at = '2026-01-01T00:00:03Z'
  FROM exercise_catalog WHERE id = 'catalog-sync-b-own'),
  'a restore keeps the original created timestamp');

TRUNCATE first_catalog_clock;
INSERT INTO first_catalog_clock
  SELECT sync_updated_at FROM exercise_catalog WHERE id = 'catalog-sync-b-own';

UPDATE exercise_catalog
  SET name = 'Direct writer', sync_updated_at = '2020-01-01T00:00:00Z'
  WHERE id = 'catalog-sync-b-own';
SELECT ok((SELECT updated_at = '2026-01-01T00:00:03Z'
    AND sync_updated_at > (SELECT sync_updated_at FROM first_catalog_clock)
  FROM exercise_catalog WHERE id = 'catalog-sync-b-own'),
  'a direct writer advances the server clock even without updating the LWW clock');

INSERT INTO exercise_catalog (id, name, display_name, muscle_group)
VALUES ('catalog-sync-c-public', 'Public catalog', 'Public catalog', 'General');

SELECT ok(NOT upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24102', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-a-rolled-back', 'Prior row', false, NULL),
    pg_temp.exercise_row('catalog-sync-b-own', 'Foreign write', true, NULL)
  )) AND NOT upsert_mobile_custom_exercises(
  '93a08a46-6419-4057-9ca7-b4c7a1d24101', jsonb_build_array(
    pg_temp.exercise_row('catalog-sync-c-public', 'Public collision', true, NULL)
  )), 'the atomic batch reports both foreign ownership and library collisions');
SELECT ok(NOT EXISTS (SELECT 1 FROM exercise_catalog WHERE id = 'catalog-sync-a-rolled-back')
    AND EXISTS (SELECT 1 FROM exercise_catalog
      WHERE id = 'catalog-sync-b-own' AND name = 'Direct writer' AND NOT archived)
    AND EXISTS (SELECT 1 FROM exercise_catalog
      WHERE id = 'catalog-sync-c-public' AND NOT is_custom AND NOT archived),
  'a rejected batch changes neither protected IDs nor earlier rows');

SELECT * FROM finish();
ROLLBACK;
