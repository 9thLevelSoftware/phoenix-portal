-- KD-14 / PR 64 pgTAP: the scheduled generate-insights pass.
--
--   * replace_user_insights stamps expires_at = now() + 36h and stays
--     service-role only;
--   * private.insights_batch_state is unreachable for anon/authenticated
--     (and for service_role directly — it goes through the RPC);
--   * public.set_insights_batch_cursor writes/wraps the cursor, service role
--     only;
--   * public.insights_batch_candidates selects FLAME and past_due FLAME,
--     skips EMBER/FREE and users with no recent session, and honours the
--     keyset cursor and the limit;
--   * the pg_cron job `generate-insights` exists with the expected schedule
--     and command, and a re-apply of the scheduler function repairs drift
--     WITHOUT flipping `active` in either direction (PR 35's convention).
--
-- Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:insights-schedule-catalog');

SELECT has_table('private', 'insights_batch_state',
    'private.insights_batch_state exists');
SELECT has_function('public', 'set_insights_batch_cursor', ARRAY['uuid'],
    'public.set_insights_batch_cursor(uuid) exists');
SELECT has_function('public', 'insights_batch_candidates', ARRAY['uuid', 'integer'],
    'public.insights_batch_candidates(uuid, integer) exists');
SELECT has_function('private', 'schedule_generate_insights_job', ARRAY[]::text[],
    'private.schedule_generate_insights_job() exists');

SELECT ok(
    (SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_insights_batch_cursor(uuid)'::regprocedure),
    'set_insights_batch_cursor is SECURITY DEFINER'
);
SELECT ok(
    (SELECT proconfig FROM pg_proc WHERE oid = 'public.set_insights_batch_cursor(uuid)'::regprocedure)
      @> ARRAY['search_path='],
    'set_insights_batch_cursor pins an empty search_path'
);
SELECT ok(
    NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.insights_batch_candidates(uuid, integer)'::regprocedure),
    'insights_batch_candidates is SECURITY INVOKER (service_role bypasses RLS; no new definer)'
);

SELECT diag('database:insights-schedule-privileges');

SELECT ok(
    NOT has_function_privilege('anon', 'public.set_insights_batch_cursor(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.set_insights_batch_cursor(uuid)', 'EXECUTE'),
    'set_insights_batch_cursor is not executable by anon/authenticated'
);
SELECT ok(
    has_function_privilege('service_role', 'public.set_insights_batch_cursor(uuid)', 'EXECUTE'),
    'set_insights_batch_cursor is executable by service_role'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.insights_batch_candidates(uuid, integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.insights_batch_candidates(uuid, integer)', 'EXECUTE'),
    'insights_batch_candidates is not executable by anon/authenticated'
);
SELECT ok(
    has_function_privilege('service_role', 'public.insights_batch_candidates(uuid, integer)', 'EXECUTE'),
    'insights_batch_candidates is executable by service_role'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.replace_user_insights(uuid, text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.replace_user_insights(uuid, text, jsonb)', 'EXECUTE'),
    'replace_user_insights stays closed to anon/authenticated'
);

-- The cursor table itself is never touched directly by a browser role, and
-- not even by service_role: the only way in is the RPC.
SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname),
             (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
        WHERE has_table_privilege(r.rolname, 'private.insights_batch_state', p.priv)
    ),
    'private.insights_batch_state grants nothing to anon, authenticated or service_role'
);
SELECT ok(
    NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
    'the private schema is not usable by anon/authenticated'
);

SELECT diag('database:insights-schedule-behaviour');

-- Fixtures: four users, one profile row each is not needed (the RPCs under
-- test read subscriptions and workout_sessions only).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
FROM (VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'pr64-flame@test.local'),
    ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'pr64-ember@test.local'),
    ('cccccccc-0000-4000-8000-000000000003'::uuid, 'pr64-pastdue-flame@test.local'),
    ('dddddddd-0000-4000-8000-000000000004'::uuid, 'pr64-inactive-flame@test.local')
) AS u(id, email);

INSERT INTO public.subscriptions (user_id, tier, status, current_period_end)
VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001', 'FLAME', 'active', now() + interval '20 days'),
    ('bbbbbbbb-0000-4000-8000-000000000002', 'EMBER', 'active', now() + interval '20 days'),
    -- past_due is entitled (PR 8): Paddle is still retrying payment.
    ('cccccccc-0000-4000-8000-000000000003', 'FLAME', 'past_due', now() - interval '3 days'),
    ('dddddddd-0000-4000-8000-000000000004', 'FLAME', 'active', now() + interval '20 days');

INSERT INTO public.workout_sessions (id, user_id, started_at, total_volume, set_count)
VALUES
    (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '2 days', 1000, 10),
    (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000002', now() - interval '2 days', 1000, 10),
    (gen_random_uuid(), 'cccccccc-0000-4000-8000-000000000003', now() - interval '2 days', 1000, 10),
    -- FLAME, but the last session is outside the 30-day activity window.
    (gen_random_uuid(), 'dddddddd-0000-4000-8000-000000000004', now() - interval '90 days', 1000, 10);

SELECT set_eq(
    $$ SELECT user_id FROM public.insights_batch_candidates(NULL, 25) $$,
    $$ VALUES ('aaaaaaaa-0000-4000-8000-000000000001'::uuid),
              ('cccccccc-0000-4000-8000-000000000003'::uuid) $$,
    'candidates: FLAME and past_due FLAME are selected; EMBER and the inactive FLAME user are not'
);

SELECT results_eq(
    $$ SELECT user_id FROM public.insights_batch_candidates(NULL, 1) $$,
    $$ VALUES ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
    'candidates: the limit is honoured and rows come back in user_id order'
);

SELECT results_eq(
    $$ SELECT user_id FROM public.insights_batch_candidates('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 25) $$,
    $$ VALUES ('cccccccc-0000-4000-8000-000000000003'::uuid) $$,
    'candidates: the keyset cursor skips everything at or before it'
);

SELECT is_empty(
    $$ SELECT user_id FROM public.insights_batch_candidates('ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, 25) $$,
    'candidates: a cursor past the last eligible user returns nothing (the pass wraps)'
);

-- Cursor round trip.
SELECT lives_ok(
    $$ SELECT public.set_insights_batch_cursor('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
    'set_insights_batch_cursor writes'
);
SELECT results_eq(
    $$ SELECT next_cursor FROM private.insights_batch_state $$,
    $$ VALUES ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
    'the cursor was stored'
);
SELECT lives_ok(
    $$ SELECT public.set_insights_batch_cursor(NULL) $$,
    'set_insights_batch_cursor wraps to NULL'
);
SELECT results_eq(
    $$ SELECT next_cursor FROM private.insights_batch_state $$,
    $$ VALUES (NULL::uuid) $$,
    'the cursor wrapped to NULL'
);
SELECT is(
    (SELECT count(*)::int FROM private.insights_batch_state),
    1,
    'insights_batch_state stays a single row'
);

-- expires_at: the whole precedence rule in the portal hangs off this.
SELECT is(
    public.replace_user_insights(
        'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
        '30d',
        '[{"insight_type":"success","title":"t","description":"d"}]'::jsonb
    ),
    1,
    'replace_user_insights inserted the row'
);
SELECT ok(
    (SELECT bool_and(expires_at IS NOT NULL
                     AND expires_at > now() + interval '35 hours'
                     AND expires_at < now() + interval '37 hours')
     FROM public.user_insights
     WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
    'replace_user_insights stamps expires_at ~ now() + 36h'
);

SELECT diag('database:insights-schedule-cron');

-- pg_cron is not installed by the clean apply (prod has it). Install it for
-- this transaction; this fails loudly if the image cannot, so the job
-- assertions below always execute.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT lives_ok(
    $$ SELECT private.schedule_generate_insights_job() $$,
    'schedule_generate_insights_job runs with pg_cron installed'
);

SELECT is(
    (SELECT count(*)::int FROM cron.job WHERE jobname = 'generate-insights'),
    1,
    'the generate-insights job exists exactly once'
);
SELECT is(
    (SELECT schedule FROM cron.job WHERE jobname = 'generate-insights'),
    '*/15 * * * *',
    'the job runs every 15 minutes'
);
SELECT is(
    (SELECT command FROM cron.job WHERE jobname = 'generate-insights'),
    'SELECT private.invoke_edge_function(''generate-insights'', jsonb_build_object(''mode'', ''batch'', ''cursor'', (SELECT next_cursor FROM private.insights_batch_state WHERE id)))',
    'the job posts mode=batch with the stored cursor through invoke_edge_function'
);
SELECT ok(
    (SELECT active FROM cron.job WHERE jobname = 'generate-insights'),
    'the job is created ACTIVE (it is a cache refresh, not a destructive job)'
);

-- Re-apply semantics: repair drift, never touch `active`.
CREATE TEMP TABLE insights_jobid AS
SELECT jobid FROM cron.job WHERE jobname = 'generate-insights';

SELECT cron.alter_job(
    (SELECT jobid FROM insights_jobid),
    schedule := '0 4 * * *', active := false
);
SELECT lives_ok(
    $$ SELECT private.schedule_generate_insights_job() $$,
    're-running the scheduler over a drifted, deactivated job'
);
SELECT is(
    (SELECT schedule FROM cron.job WHERE jobname = 'generate-insights'),
    '*/15 * * * *',
    're-apply repairs a drifted schedule'
);
SELECT ok(
    NOT (SELECT active FROM cron.job WHERE jobname = 'generate-insights'),
    're-apply does NOT re-activate a job the operator paused'
);
SELECT is(
    (SELECT jobid FROM cron.job WHERE jobname = 'generate-insights'),
    (SELECT jobid FROM insights_jobid),
    're-apply keeps the same jobid'
);

SELECT cron.alter_job((SELECT jobid FROM insights_jobid), active := true);
SELECT lives_ok(
    $$ SELECT private.schedule_generate_insights_job() $$,
    're-running the scheduler over an in-sync, active job'
);
SELECT ok(
    (SELECT active FROM cron.job WHERE jobname = 'generate-insights'),
    're-apply does NOT deactivate an active job either'
);

SELECT * FROM finish();
ROLLBACK;
