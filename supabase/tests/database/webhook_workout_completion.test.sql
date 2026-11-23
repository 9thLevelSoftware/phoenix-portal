BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(10);

INSERT INTO auth.users (id, email) VALUES
  ('85000000-0000-4000-8000-000000000001', 'completion-a@example.test'),
  ('85000000-0000-4000-8000-000000000002', 'completion-b@example.test');

INSERT INTO public.webhook_endpoints (id, user_id, label, url, scopes, signing_key_hint) VALUES
  ('85100000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001',
   'Completed', 'https://example.test/completed', ARRAY['completed_workouts'], '0001'),
  ('85100000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001',
   'Snapshots', 'https://example.test/snapshots', ARRAY['workouts'], '0002'),
  ('85100000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000002',
   'Other user', 'https://example.test/other', ARRAY['completed_workouts'], '0003');

INSERT INTO public.workout_sessions (id, user_id, started_at, client_updated_at) VALUES
  ('85200000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001',
   '2026-11-23T12:00Z', '2026-11-23T13:00Z'),
  ('85200000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001',
   '2026-11-23T12:00Z', '2026-11-23T12:00Z');

CREATE FUNCTION pg_temp.finish_workout(p_clock timestamptz, p_finished_at timestamptz)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.replace_session_children_with_completion(
    '85000000-0000-4000-8000-000000000001',
    ARRAY['85200000-0000-4000-8000-000000000001'::uuid],
    '[{"id":"85300000-0000-4000-8000-000000000001",
       "session_id":"85200000-0000-4000-8000-000000000001",
       "user_id":"85000000-0000-4000-8000-000000000001",
       "name":"Row","muscle_group":"Back","order_index":0}]',
    '[{"id":"85400000-0000-4000-8000-000000000001",
       "exercise_id":"85300000-0000-4000-8000-000000000001",
       "user_id":"85000000-0000-4000-8000-000000000001",
       "set_number":1,"actual_reps":8,"weight_kg":40,"is_pr":false}]',
    '[]', '[]', '[]',
    jsonb_build_array(jsonb_build_object(
      'id', '85200000-0000-4000-8000-000000000001',
      'client_updated_at', p_clock, 'completed_at', p_finished_at
    ))
  )
$$;

SELECT is((SELECT count(*) FROM public.webhook_deliveries WHERE entity = 'workout_completion'),
  0::bigint, 'in-progress workouts enqueue no completion');
SELECT is(public.enqueue_webhook_backfill(
  '85000000-0000-4000-8000-000000000001', '85100000-0000-4000-8000-000000000001'),
  0, 'backfill omits workouts with no recorded completion');
SELECT throws_ok($$SELECT pg_temp.finish_workout('2026-11-23T12:59Z', '2026-11-23T13:00Z')$$,
  '40001', 'Workout completion parent changed during sync', 'stale final graph is rejected');
SELECT lives_ok($$SELECT pg_temp.finish_workout('2026-11-23T13:00Z', '2026-11-23T13:00Z')$$,
  'the final set graph and completion commit through the same RPC');
SELECT is(
  (SELECT actual_reps FROM public.sets WHERE id = '85400000-0000-4000-8000-000000000001'),
  8, 'the final set is saved');
SELECT results_eq(
  $$SELECT endpoint_id FROM public.webhook_deliveries WHERE entity = 'workout_completion'$$,
  $$VALUES ('85100000-0000-4000-8000-000000000001'::uuid)$$,
  'only the owner''s completed-workout endpoint receives the completion');

UPDATE public.webhook_deliveries SET status = 'delivered' WHERE entity = 'workout_completion';
SELECT lives_ok($$SELECT pg_temp.finish_workout('2026-11-23T13:00Z', '2026-11-23T13:01Z')$$,
  'replaying the graph succeeds after delivery');
SELECT is((SELECT completed_at FROM public.workout_sessions WHERE id = '85200000-0000-4000-8000-000000000001'),
  '2026-11-23T13:00Z'::timestamptz, 'the first completion time is retained');
SELECT is((SELECT count(*) FROM public.webhook_deliveries WHERE entity = 'workout_completion'),
  1::bigint, 'replaying the graph creates no new completion event');
SELECT is(public.enqueue_webhook_backfill(
  '85000000-0000-4000-8000-000000000001', '85100000-0000-4000-8000-000000000001'),
  1, 'explicit backfill replays the completed workout only');

SELECT * FROM finish();
ROLLBACK;
