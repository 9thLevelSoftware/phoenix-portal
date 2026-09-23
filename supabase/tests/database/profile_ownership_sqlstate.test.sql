-- 20260924110000: guard_profile_ownership_update refuses under its own
-- SQLSTATE (P204D), and merge_training_cycles_from_push turns exactly that
-- refusal into a structured rejection. Any other P0001 still fails the merge.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(4);

INSERT INTO auth.users (id, email)
VALUES ('20420420-0000-4000-8000-000000000001'::uuid, 'profile-sqlstate@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.local_profiles (user_id, id, name)
VALUES ('20420420-0000-4000-8000-000000000001'::uuid, 'phone-b', 'Phone B');

-- A portal-created cycle: held by the default profile.
INSERT INTO public.training_cycles (id, user_id, name, updated_at, client_updated_at)
VALUES ('20420420-0000-4000-8000-0000000000c1'::uuid,
        '20420420-0000-4000-8000-000000000001'::uuid,
        'Portal cycle', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

SELECT throws_ok(
    $sql$
      UPDATE public.training_cycles SET local_profile_id = 'phone-b'
       WHERE id = '20420420-0000-4000-8000-0000000000c1'
    $sql$,
    'P204D',
    'profile_ownership_transfer_required',
    'moving a row to another local profile raises P204D'
);

SELECT results_eq(
    $sql$
      SELECT accepted, structure_applied, client_updated_at
        FROM public.merge_training_cycles_from_push(
          '20420420-0000-4000-8000-000000000001',
          jsonb_build_array(jsonb_build_object(
            'id', '20420420-0000-4000-8000-0000000000c1',
            'name', 'Renamed on phone B', 'local_profile_id', 'phone-b',
            'updated_at', '2026-09-02T00:00:00Z')),
          true)
    $sql$,
    $values$ VALUES (false, false, '2026-09-01T00:00:00Z'::timestamptz) $values$,
    'the merge reports the refusal as a rejection with the stored LWW key'
);

SELECT is(
    (SELECT name || '/' || coalesce(local_profile_id, 'default') FROM public.training_cycles
      WHERE id = '20420420-0000-4000-8000-0000000000c1'),
    'Portal cycle/default',
    'the rejected cycle keeps the stored copy and profile'
);

-- A different P0001 raised inside the merge is not swallowed.
CREATE FUNCTION pg_temp.raise_other_p0001() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'profile_ownership_transfer_required' USING ERRCODE = 'P0001';
END;
$$;
CREATE TRIGGER zz_raise_other_p0001 BEFORE UPDATE ON public.training_cycles
  FOR EACH ROW EXECUTE FUNCTION pg_temp.raise_other_p0001();

SELECT throws_ok(
    $sql$
      SELECT * FROM public.merge_training_cycles_from_push(
        '20420420-0000-4000-8000-000000000001',
        jsonb_build_array(jsonb_build_object(
          'id', '20420420-0000-4000-8000-0000000000c1',
          'name', 'Same profile edit',
          'updated_at', '2026-09-03T00:00:00Z')),
        true)
    $sql$,
    'P0001',
    NULL,
    'a P0001 with the same message but not from the guard still fails the merge'
);

SELECT * FROM finish();
ROLLBACK;
