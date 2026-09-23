-- 20260924150000: sync state is saved only while the run owns its queue row.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(7);

INSERT INTO auth.users (id, email)
VALUES ('26262626-0000-4000-8000-000000000001'::uuid, 'sync-state-owned@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_integrations (user_id, provider, status)
VALUES ('26262626-0000-4000-8000-000000000001', 'liftosaur', 'disconnected');
INSERT INTO public.sync_queue (id, user_id, provider, sync_type, status) VALUES
  ('26262626-0000-4000-8000-0000000000a1', '26262626-0000-4000-8000-000000000001', 'liftosaur', 'incremental', 'cancelled');

SELECT ok(
    NOT has_function_privilege('authenticated', 'public.save_sync_state_if_queue_owned(uuid, text, uuid, jsonb, integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.save_sync_state_if_queue_owned(uuid, text, uuid, jsonb, integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.save_sync_state_if_queue_owned(uuid, text, uuid, jsonb, integer)', 'EXECUTE'),
    'service-role only'
);

SELECT is(
    public.save_sync_state_if_queue_owned('26262626-0000-4000-8000-000000000001', 'liftosaur',
      '26262626-0000-4000-8000-0000000000a1', '{"status":"connected","last_sync_at":"2026-09-20T00:00:00Z"}'),
    false,
    'a cancelled row is not owned'
);
SELECT is(
    (SELECT status || '/' || coalesce(last_sync_at::text, 'null') FROM public.user_integrations
      WHERE user_id = '26262626-0000-4000-8000-000000000001'),
    'disconnected/null',
    'and nothing is written: a disconnect is never undone'
);

UPDATE public.sync_queue SET status = 'processing'
 WHERE id = '26262626-0000-4000-8000-0000000000a1';
SELECT is(
    public.save_sync_state_if_queue_owned('26262626-0000-4000-8000-000000000001', 'liftosaur',
      '26262626-0000-4000-8000-0000000000a1',
      '{"status":"connected","backfill_before":"2026-01-01T00:00:00Z","backfill_after":null,"user_id":"ignored"}'),
    true,
    'a processing row is owned'
);
SELECT ok(
    (SELECT status = 'connected' AND backfill_before = '2026-01-01T00:00:00Z'::timestamptz
            AND backfill_after IS NULL AND user_id = '26262626-0000-4000-8000-000000000001'
       FROM public.user_integrations WHERE provider = 'liftosaur'
        AND user_id = '26262626-0000-4000-8000-000000000001'),
    'only the listed state keys are written, nulls included'
);
UPDATE public.sync_queue SET retry_count = 1
 WHERE id = '26262626-0000-4000-8000-0000000000a1';
SELECT is(
    public.save_sync_state_if_queue_owned('26262626-0000-4000-8000-000000000001', 'liftosaur',
      '26262626-0000-4000-8000-0000000000a1', '{"status":"error"}', 0),
    false,
    'a worker whose lease was reclaimed (older claim generation) is not the owner'
);
SELECT is(
    public.save_sync_state_if_queue_owned('26262626-0000-4000-8000-000000000001', 'liftosaur',
      NULL, '{"error_message":"x"}'),
    true,
    'a run without a queue row always saves'
);

SELECT * FROM finish();
ROLLBACK;
