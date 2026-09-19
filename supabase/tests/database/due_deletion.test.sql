-- Due account deletion pgTAP (KD-11, PR 35; 20260920003500):
--   * deletion_requests: the 'executing' claim status, claimed_at,
--     needs_support_reason; one status CHECK;
--   * the claim is conditional and the user's cancel is refused while claimed;
--   * public.sweep_deleted_account_residue: definer, search_path pinned,
--     service_role only; removes FK-less rows of missing users only and
--     lists their avatar folders;
--   * private.schedule_due_deletion_job: owner-only; with pg_cron installed
--     in this transaction, schedules `delete-due-accounts` hourly once and
--     repairs a drifted job in place.
--
-- Run locally with `supabase test db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

SELECT diag('database:due-deletion-schema');

SELECT has_column('public', 'deletion_requests', 'claimed_at', 'deletion_requests.claimed_at exists');
SELECT col_type_is('public', 'deletion_requests', 'claimed_at', 'timestamp with time zone',
    'claimed_at is timestamptz');
SELECT has_column('public', 'deletion_requests', 'needs_support_reason',
    'deletion_requests.needs_support_reason exists');

SELECT is(
    (SELECT count(*)::int FROM pg_constraint
     WHERE conrelid = 'public.deletion_requests'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ '\mstatus\M'),
    1,
    'exactly one status CHECK (the original unnamed one was replaced)'
);
SELECT ok(
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conrelid = 'public.deletion_requests'::regclass
       AND conname = 'deletion_requests_status_valid') ~ 'executing',
    'the status CHECK allows executing'
);

INSERT INTO auth.users (id, email) VALUES
    ('35353535-0000-4000-8000-000000000001'::uuid, 'due-deletion-a@example.test'),
    ('35353535-0000-4000-8000-000000000002'::uuid, 'due-deletion-b@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.deletion_requests (id, user_id)
VALUES ('35350000-0000-4000-8000-000000000001', '35353535-0000-4000-8000-000000000001');

SELECT throws_ok(
    $$ UPDATE public.deletion_requests SET status = 'bogus'
       WHERE id = '35350000-0000-4000-8000-000000000001' $$,
    '23514',
    NULL,
    'an unknown status is rejected'
);

SELECT diag('database:due-deletion-claim');

-- The claim the Edge handler issues (without its scheduled_for <= now()
-- filter: the grace trigger refuses to seed a due request).
UPDATE public.deletion_requests
SET status = 'executing', claimed_at = '2026-01-01T00:00:00Z'
WHERE id = '35350000-0000-4000-8000-000000000001' AND status = 'pending';
SELECT is(
    (SELECT status FROM public.deletion_requests
     WHERE id = '35350000-0000-4000-8000-000000000001'),
    'executing',
    'the first claim takes the request'
);
UPDATE public.deletion_requests
SET status = 'executing', claimed_at = '2026-02-02T00:00:00Z'
WHERE id = '35350000-0000-4000-8000-000000000001' AND status = 'pending';
SELECT is(
    (SELECT claimed_at FROM public.deletion_requests
     WHERE id = '35350000-0000-4000-8000-000000000001'),
    '2026-01-01T00:00:00Z'::timestamptz,
    'a second claim gets nothing'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"35353535-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
UPDATE public.deletion_requests SET status = 'cancelled', cancelled_at = now()
WHERE id = '35350000-0000-4000-8000-000000000001';
SELECT throws_ok(
    $$ UPDATE public.deletion_requests SET needs_support_reason = NULL
       WHERE id = '35350000-0000-4000-8000-000000000001' $$,
    '42501',
    NULL,
    'the user cannot write needs_support_reason'
);
RESET ROLE;
SELECT is(
    (SELECT status FROM public.deletion_requests
     WHERE id = '35350000-0000-4000-8000-000000000001'),
    'executing',
    'the user cannot cancel a claimed (executing) request'
);

-- Released (needs support): pending again, so the user can cancel.
UPDATE public.deletion_requests
SET status = 'pending', claimed_at = NULL, needs_support_reason = 'billing_subscription_not_found'
WHERE id = '35350000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"35353535-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);
UPDATE public.deletion_requests SET status = 'cancelled', cancelled_at = now()
WHERE id = '35350000-0000-4000-8000-000000000001';
RESET ROLE;
SELECT is(
    (SELECT status FROM public.deletion_requests
     WHERE id = '35350000-0000-4000-8000-000000000001'),
    'cancelled',
    'a released request (even one waiting on support) is cancellable'
);

SELECT diag('database:due-deletion-sweep-privileges');

SELECT ok(
    (SELECT prosecdef FROM pg_proc
     WHERE oid = 'public.sweep_deleted_account_residue(integer)'::regprocedure),
    'sweep_deleted_account_residue is SECURITY DEFINER'
);
SELECT ok(
    (SELECT proconfig FROM pg_proc
     WHERE oid = 'public.sweep_deleted_account_residue(integer)'::regprocedure)
      @> ARRAY['search_path=""'],
    'sweep_deleted_account_residue pins search_path'
);
SELECT ok(
    has_function_privilege('service_role', 'public.sweep_deleted_account_residue(integer)', 'EXECUTE'),
    'service_role can run the sweep'
);
SELECT ok(
    NOT has_function_privilege('anon', 'public.sweep_deleted_account_residue(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.sweep_deleted_account_residue(integer)', 'EXECUTE'),
    'anon and authenticated cannot run the sweep'
);
SELECT ok(
    NOT EXISTS (
        SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
        WHERE has_function_privilege(r.rolname, 'private.schedule_due_deletion_job()', 'EXECUTE')
    ),
    'schedule_due_deletion_job is owner-only'
);

SELECT diag('database:due-deletion-sweep');

-- A deleted user's residue (no auth.users row) and a live user's rows.
INSERT INTO public.sync_tombstones (user_id, entity, entity_id) VALUES
    ('35353535-0000-4000-8000-0000000000dd', 'routine', gen_random_uuid()),
    ('35353535-0000-4000-8000-000000000002', 'routine', gen_random_uuid());
INSERT INTO public.rate_limit_tracking (provider, key, user_id) VALUES
    ('due-deletion-app-wide', 'due-deletion-app-wide', NULL);
INSERT INTO public.paddle_webhook_events (event_type, user_id, payload) VALUES
    ('due-deletion-orphan', '35353535-0000-4000-8000-0000000000dd', '{}'::jsonb),
    ('due-deletion-live', '35353535-0000-4000-8000-000000000002', '{}'::jsonb),
    ('due-deletion-null', NULL, '{}'::jsonb),
    ('due-deletion-payload-orphan', NULL,
     '{"data":{"custom_data":{"user_id":"35353535-0000-4000-8000-0000000000dd"}}}'::jsonb),
    ('due-deletion-payload-live', NULL,
     '{"data":{"custom_data":{"user_id":"35353535-0000-4000-8000-000000000002"}}}'::jsonb),
    ('due-deletion-payload-junk', NULL,
     '{"data":{"custom_data":{"user_id":"not-a-uuid"}}}'::jsonb);
INSERT INTO public.subscription_events (user_id, operation, row_snapshot) VALUES
    ('35353535-0000-4000-8000-0000000000dd', 'DELETE', '{}'::jsonb);
INSERT INTO storage.objects (bucket_id, name) VALUES
    ('avatars', '35353535-0000-4000-8000-0000000000dd/avatar.png'),
    ('avatars', '35353535-0000-4000-8000-000000000002/avatar.png'),
    ('avatars', 'not-a-user-folder/file.png');

CREATE TEMP TABLE sweep_result AS
SELECT public.sweep_deleted_account_residue(100) AS r;

SELECT is(
    (SELECT (r->'deleted'->>'sync_tombstones')::int FROM sweep_result) >= 1
    AND (SELECT (r->'deleted'->>'paddle_webhook_events')::int FROM sweep_result) >= 1
    AND (SELECT (r->'deleted'->>'subscription_events')::int FROM sweep_result) >= 1,
    true,
    'the sweep reports what it deleted per table'
);
SELECT ok(
    (SELECT r->'orphan_avatar_folders' FROM sweep_result)
      @> '["35353535-0000-4000-8000-0000000000dd"]'::jsonb
    AND NOT (SELECT r->'orphan_avatar_folders' FROM sweep_result)
      @> '["35353535-0000-4000-8000-000000000002"]'::jsonb
    AND NOT (SELECT r->'orphan_avatar_folders' FROM sweep_result)
      @> '["not-a-user-folder"]'::jsonb,
    'only avatar folders of missing users are listed'
);
SELECT is(
    (SELECT count(*)::int FROM public.sync_tombstones
     WHERE user_id = '35353535-0000-4000-8000-0000000000dd'),
    0,
    'a missing user''s tombstones are deleted'
);
SELECT is(
    (SELECT count(*)::int FROM public.sync_tombstones
     WHERE user_id = '35353535-0000-4000-8000-000000000002'),
    1,
    'a live user''s tombstones stay'
);
SELECT set_eq(
    $$ SELECT event_type FROM public.paddle_webhook_events WHERE event_type LIKE 'due-deletion-%' $$,
    $$ VALUES ('due-deletion-live'), ('due-deletion-null'), ('due-deletion-payload-live'),
              ('due-deletion-payload-junk') $$,
    'only webhook rows naming a missing user (column or checkout custom data) are deleted'
);
SELECT is(
    (SELECT count(*)::int FROM public.subscription_events
     WHERE user_id = '35353535-0000-4000-8000-0000000000dd'),
    0,
    'a missing user''s subscription_events rows are deleted'
);
SELECT is(
    (SELECT count(*)::int FROM public.rate_limit_tracking WHERE key = 'due-deletion-app-wide'),
    1,
    'app-wide limiter rows (NULL user_id) stay'
);

SELECT diag('database:due-deletion-cron-job');

-- pg_cron is not installed by the clean apply (prod has it). Install it for
-- this transaction so the job assertions always execute.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT lives_ok(
    $$ SELECT private.schedule_due_deletion_job() $$,
    'schedule_due_deletion_job runs with pg_cron installed'
);
SELECT results_eq(
    $$ SELECT schedule, command FROM cron.job WHERE jobname = 'delete-due-accounts' $$,
    $$ VALUES ('17 * * * *'::text,
               'SELECT private.invoke_edge_function(''delete-account'', ''{"mode":"process_due"}''::jsonb)'::text) $$,
    'delete-due-accounts runs hourly through private.invoke_edge_function with mode process_due'
);

CREATE TEMP TABLE due_jobid AS SELECT jobid FROM cron.job WHERE jobname = 'delete-due-accounts';
SELECT cron.alter_job(
    (SELECT jobid FROM due_jobid), schedule := '0 0 * * *', active := false
);
SELECT private.schedule_due_deletion_job();
SELECT results_eq(
    $$ SELECT jobid, schedule, active FROM cron.job WHERE jobname = 'delete-due-accounts' $$,
    $$ SELECT jobid, '17 * * * *'::text, false FROM due_jobid $$,
    're-running keeps one job, repairs its schedule in place and keeps it paused'
);

SELECT * FROM finish();
ROLLBACK;
