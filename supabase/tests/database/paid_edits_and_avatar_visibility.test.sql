BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

CREATE FUNCTION pg_temp.denied(statement_sql text, expected_state text, label text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement_sql;
  RETURN extensions.ok(false, label);
EXCEPTION WHEN OTHERS THEN
  RETURN extensions.is(SQLSTATE, expected_state, label);
END;
$$;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-4000-8000-000000000009', 'paid-free@example.test'),
  ('b0000000-0000-4000-8000-000000000009', 'paid-ember@example.test'),
  ('c0000000-0000-4000-8000-000000000009', 'paid-flame@example.test');
INSERT INTO public.subscriptions (user_id, tier, status, current_period_end) VALUES
  ('a0000000-0000-4000-8000-000000000009', 'EMBER', 'active', now() + interval '1 day'),
  ('b0000000-0000-4000-8000-000000000009', 'EMBER', 'active', now() + interval '1 day'),
  ('c0000000-0000-4000-8000-000000000009', 'FLAME', 'active', now() + interval '1 day');

-- Existing rows retained after downgrade. Seeding as postgres avoids conflating
-- authorization of an edit with the separate creation/activation goal cap.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, status)
VALUES ('a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000009', 'frequency', 3, 'workouts', 'active');
DELETE FROM public.subscriptions WHERE user_id = 'a0000000-0000-4000-8000-000000000009';
INSERT INTO public.external_activities (user_id, external_id, provider, name, started_at)
VALUES ('a0000000-0000-4000-8000-000000000009', 'retained', 'strong', 'Retained', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
SELECT pg_temp.denied($sql$ INSERT INTO public.external_activities (user_id, external_id, provider, name, started_at) VALUES ('a0000000-0000-4000-8000-000000000009', 'free', 'strong', 'Free', now()) $sql$, '42501', 'FREE cannot insert activity');
WITH edited AS (UPDATE public.external_activities SET name = 'Bypass' RETURNING 1)
SELECT is(count(*)::int, 0, 'FREE cannot update retained activity') FROM edited;

SELECT pg_temp.denied(format('UPDATE public.user_goals SET %s WHERE id = %L', field_edit, 'a0000000-0000-4000-8000-000000000010'), '42501', 'FREE cannot edit ' || field_edit)
FROM (VALUES ('target_value = 100'), ('target_unit = ''other'''), ('deadline = now()'), ('period = ''monthly'''), ('exercise_name = ''Other'''), ('exercise_id = ''c0000000-0000-4000-8000-000000000010'''), ('completed_at = now()'), ('status = ''completed''')) AS fields(field_edit);
SELECT pg_temp.denied($sql$ UPDATE public.user_goals SET status = 'archived', target_value = 100 WHERE id = 'a0000000-0000-4000-8000-000000000010' $sql$, '42501', 'FREE cannot smuggle protected edits in archive');
SELECT lives_ok($sql$ UPDATE public.user_goals SET status = 'archived', updated_at = now() WHERE id = 'a0000000-0000-4000-8000-000000000010' $sql$, 'FREE may archive unchanged goal');
SELECT is((SELECT target_value FROM public.user_goals WHERE id = 'a0000000-0000-4000-8000-000000000010'), 3::numeric, 'archive preserved target');
SELECT lives_ok($sql$ DELETE FROM public.user_goals WHERE id = 'a0000000-0000-4000-8000-000000000010' $sql$, 'FREE can delete own goal');
SELECT lives_ok($sql$ DELETE FROM public.external_activities WHERE external_id = 'retained' $sql$, 'FREE can delete retained activity');

SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
SELECT pg_temp.denied($sql$ INSERT INTO public.external_activities (user_id, external_id, provider, name, started_at) VALUES ('b0000000-0000-4000-8000-000000000009', 'ember', 'hevy', 'Ember', now()) $sql$, '42501', 'EMBER cannot insert activity');
SELECT lives_ok($sql$ INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit) VALUES ('b0000000-0000-4000-8000-000000000010', 'b0000000-0000-4000-8000-000000000009', 'frequency', 3, 'workouts') $sql$, 'EMBER can create goal');
SELECT lives_ok($sql$ UPDATE public.user_goals SET target_value = 4, deadline = now() WHERE id = 'b0000000-0000-4000-8000-000000000010' $sql$, 'EMBER can edit goal');

SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
SELECT lives_ok($sql$ INSERT INTO public.external_activities (user_id, external_id, provider, name, started_at) VALUES ('c0000000-0000-4000-8000-000000000009', 'flame', 'strong', 'Flame', now()) ON CONFLICT (user_id, provider, external_id) DO UPDATE SET name = EXCLUDED.name $sql$, 'FLAME can upsert own activity');
SELECT lives_ok($sql$ UPDATE public.external_activities SET name = 'Updated' WHERE external_id = 'flame' $sql$, 'FLAME can update own activity');
SELECT pg_temp.denied($sql$ INSERT INTO public.external_activities (user_id, external_id, provider, name, started_at) VALUES ('b0000000-0000-4000-8000-000000000009', 'foreign', 'strong', 'Foreign', now()) $sql$, '42501', 'FLAME cannot insert for another owner');
SET LOCAL ROLE service_role;
SELECT lives_ok($sql$ INSERT INTO public.external_activities (user_id, external_id, provider, name, started_at) VALUES ('a0000000-0000-4000-8000-000000000009', 'service', 'strava', 'Service sync', now()) $sql$, 'provider service sync remains allowed');
RESET ROLE;

-- Outside the existing 48-hour renewal grace; evaluate the server helper,
-- never the caller's claimed tier.
UPDATE public.subscriptions SET current_period_end = now() - interval '3 days' WHERE user_id = 'b0000000-0000-4000-8000-000000000009';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000009","role":"authenticated","app_metadata":{"tier":"INFERNO"}}', true);
SELECT pg_temp.denied($sql$ UPDATE public.user_goals SET target_value = 5 WHERE id = 'b0000000-0000-4000-8000-000000000010' $sql$, '42501', 'expired paid user cannot edit despite forged tier claim');
SELECT lives_ok($sql$ UPDATE public.user_goals SET status = 'archived' WHERE id = 'b0000000-0000-4000-8000-000000000010' $sql$, 'expired user can archive unchanged goal');
SELECT pg_temp.denied($sql$ UPDATE public.user_goals SET status = 'active', target_value = 5 WHERE id = 'b0000000-0000-4000-8000-000000000010' $sql$, 'P0001', 'expired reactivation preserves cap denial even with a protected edit');
SELECT is((SELECT target_value FROM public.user_goals WHERE id = 'b0000000-0000-4000-8000-000000000010'), 4::numeric, 'failed reactivation preserves the archived target');

-- Raw profile PATCH is the stored-tracking boundary.
SELECT pg_temp.denied(format('UPDATE public.profiles SET avatar_url = %L WHERE id = %L', source, 'b0000000-0000-4000-8000-000000000009'), '23514', 'reject stored tracking source ' || source)
FROM (VALUES
  ('https://attacker.supabase.co/storage/v1/object/public/avatars/b0000000-0000-4000-8000-000000000009/avatar.png'),
  ('https://api.phoenix-portal.com/storage/v1/object/public/avatars/a0000000-0000-4000-8000-000000000009/avatar.png'),
  ('https://api.phoenix-portal.com/storage/v1/object/public/avatars/b0000000-0000-4000-8000-000000000009/avatar%2epng'),
  ('https://api.phoenix-portal.com/storage/v1/object/public/avatars/b0000000-0000-4000-8000-000000000009/avatar.png?url=https://attacker.test')
) AS sources(source);
SELECT lives_ok($sql$ UPDATE public.profiles SET avatar_url = 'https://api.phoenix-portal.com/storage/v1/object/public/avatars/b0000000-0000-4000-8000-000000000009/avatar.png?t=123', profile_visible = true WHERE id = 'b0000000-0000-4000-8000-000000000009' $sql$, 'owner can set exact Phoenix avatar source and opt in');
SELECT lives_ok($sql$ INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'b0000000-0000-4000-8000-000000000009/avatar.png'), ('avatars', 'b0000000-0000-4000-8000-000000000009/old.png') $sql$, 'owner upload remains allowed');
RESET ROLE;

-- Exercise phase-3 bucket state transactionally; no deployment is performed.
UPDATE storage.buckets SET public = false WHERE id = 'avatars';
SELECT is((SELECT public FROM storage.buckets WHERE id = 'avatars'), false, 'phase-3 bucket state is private');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
SELECT set_config('storage.operation', 'storage.object.get_authenticated', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE 'b0000000-0000-4000-8000-000000000009/%'), 1, 'viewer can read only current opted-in avatar');
SELECT set_config('storage.operation', 'storage.object.sign', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE 'b0000000-0000-4000-8000-000000000009/%'), 0, 'viewer cannot mint a signed URL that survives opt-out');
SELECT set_config('storage.operation', 'storage.object.list', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE 'b0000000-0000-4000-8000-000000000009/%'), 0, 'viewer cannot list the profile folder');
SELECT set_config('storage.operation', 'storage.object.get_authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
UPDATE public.profiles SET profile_visible = false WHERE id = 'b0000000-0000-4000-8000-000000000009';
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE 'b0000000-0000-4000-8000-000000000009/%'), 2, 'owner can read private current and old avatars for export');
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000009","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE 'b0000000-0000-4000-8000-000000000009/%'), 0, 'opt-out immediately denies new object reads');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'avatars'), 0, 'anonymous cannot read private avatar objects');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
