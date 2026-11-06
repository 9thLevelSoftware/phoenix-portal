-- Data sharing (outbound webhooks), 20261106120000.
--
-- What must hold, by axiom:
--   FP-1  a change to one user's data is only ever enqueued for that user's
--         own endpoints, and a delivery cannot name another user's endpoint;
--   FP-2  an endpoint whose owner is below FLAME is paused by the claim, with
--         a reason, and stops enqueuing;
--   FP-3  every write path is captured (parent row, children rewritten by
--         replace_session_children, child-only edits, hard and soft deletes)
--         and rapid edits coalesce into one pending delivery;
--   FP-5  no browser role can read or write the secrets table;
--   FP-6  account deletion removes endpoints, secrets and deliveries;
--   FP-8  a dead delivery or a 410 switches the endpoint off with a reason.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-tables-rls-and-grants');

SELECT ok(
    (SELECT bool_and(c.relrowsecurity) FROM pg_class c
      WHERE c.oid IN ('public.webhook_endpoints'::regclass,
                      'public.webhook_endpoint_secrets'::regclass,
                      'public.webhook_deliveries'::regclass)),
    'RLS is enabled on all three webhook tables'
);

SELECT ok(has_table_privilege('authenticated', 'public.webhook_endpoints', 'SELECT'),
    'authenticated can SELECT webhook_endpoints (owner policy filters rows)');
SELECT ok(has_table_privilege('authenticated', 'public.webhook_deliveries', 'SELECT'),
    'authenticated can SELECT webhook_deliveries (owner policy filters rows)');

SELECT is(
    (SELECT count(*)::int
       FROM (VALUES ('public.webhook_endpoints'), ('public.webhook_endpoint_secrets'),
                    ('public.webhook_deliveries')) AS t(rel)
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
      CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
      WHERE has_table_privilege(r.role, t.rel, p.priv)),
    0,
    'no browser role can write any webhook table'
);

SELECT is(
    (SELECT count(*)::int
       FROM (VALUES ('anon'), ('authenticated')) AS r(role)
      WHERE has_table_privilege(r.role, 'public.webhook_endpoint_secrets', 'SELECT')),
    0,
    'no browser role can read webhook_endpoint_secrets'
);

SELECT ok(NOT has_table_privilege('anon', 'public.webhook_endpoints', 'SELECT'),
    'anon cannot SELECT webhook_endpoints');
SELECT ok(NOT has_table_privilege('anon', 'public.webhook_deliveries', 'SELECT'),
    'anon cannot SELECT webhook_deliveries');

SELECT is(
    (SELECT count(*)::int
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
      WHERE ((n.nspname = 'public' AND p.proname IN (
                'create_webhook_endpoint', 'rotate_webhook_signing_secret',
                'set_webhook_endpoint_header', 'claim_webhook_deliveries',
                'complete_webhook_delivery', 'enqueue_webhook_backfill'))
          OR (n.nspname = 'private' AND p.proname IN (
                'enqueue_webhook_deliveries', 'prune_webhook_deliveries',
                'schedule_webhook_jobs')))
        AND has_function_privilege(r.role, p.oid, 'EXECUTE')),
    0,
    'no browser role can execute any webhook function'
);

SELECT is(
    (SELECT count(*)::int
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
              'create_webhook_endpoint', 'rotate_webhook_signing_secret',
              'set_webhook_endpoint_header', 'claim_webhook_deliveries',
              'complete_webhook_delivery', 'enqueue_webhook_backfill')
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')),
    6,
    'service_role can execute the six public webhook RPCs'
);

SELECT is(
    (SELECT count(*)::int
       FROM private.webhook_entity_sources s
      WHERE (SELECT count(*) FROM pg_trigger t
              WHERE t.tgrelid = format('public.%I', s.source_table)::regclass
                AND t.tgname IN ('webhook_capture_insert', 'webhook_capture_update',
                                 'webhook_capture_delete')) <> 3),
    0,
    'every entity source table has its insert, update and delete capture trigger'
);

-- ---------------------------------------------------------------------------
-- Fixtures: A and B are FLAME, C has no subscription (FREE).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES
    ('d0d0d0d0-0000-4000-8000-00000000000a'::uuid, 'webhook-a@example.test'),
    ('d0d0d0d0-0000-4000-8000-00000000000b'::uuid, 'webhook-b@example.test'),
    ('d0d0d0d0-0000-4000-8000-00000000000c'::uuid, 'webhook-c@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.subscriptions (id, user_id, tier, status, current_period_end)
VALUES
    ('d0d0d0d0-5555-4000-8000-00000000000a', 'd0d0d0d0-0000-4000-8000-00000000000a',
     'FLAME', 'active', now() + interval '30 days'),
    ('d0d0d0d0-5555-4000-8000-00000000000b', 'd0d0d0d0-0000-4000-8000-00000000000b',
     'FLAME', 'active', now() + interval '30 days')
ON CONFLICT (user_id) DO UPDATE
    SET tier = EXCLUDED.tier, status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end;

CREATE TEMP TABLE wh_ids (name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

-- Marks everything finished so the next assertion sees only new rows.
CREATE FUNCTION pg_temp.settle() RETURNS void LANGUAGE sql AS $$
    UPDATE public.webhook_deliveries
    SET status = 'delivered', finished_at = now()
    WHERE status IN ('pending', 'delivering');
$$;

CREATE FUNCTION pg_temp.pending(p_endpoint text, p_entity text) RETURNS integer
LANGUAGE sql AS $$
    SELECT count(*)::int
    FROM public.webhook_deliveries d
    WHERE d.endpoint_id = (SELECT id FROM wh_ids WHERE name = p_endpoint)
      AND d.entity = p_entity
      AND d.status = 'pending';
$$;

-- ---------------------------------------------------------------------------
-- Before any endpoint exists a write enqueues nothing.
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-capture-inert-without-endpoints');

INSERT INTO public.routines (id, user_id, name)
VALUES ('d0d0d0d0-0001-4000-8000-00000000000a', 'd0d0d0d0-0000-4000-8000-00000000000a', 'Before');

SELECT is(
    (SELECT count(*)::int FROM public.webhook_deliveries
      WHERE user_id IN ('d0d0d0d0-0000-4000-8000-00000000000a',
                        'd0d0d0d0-0000-4000-8000-00000000000b')),
    0,
    'a write with no endpoint registered enqueues nothing'
);

-- ---------------------------------------------------------------------------
-- create_webhook_endpoint
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-endpoint-create-and-limit');

INSERT INTO wh_ids
SELECT 'a', public.create_webhook_endpoint(
    'd0d0d0d0-0000-4000-8000-00000000000a', 'A main', 'https://hooks.example.test/a',
    ARRAY['workouts', 'routines', 'personal_records', 'external_activities'],
    'enc:v1:a-secret', 'aaaa');

INSERT INTO wh_ids
SELECT 'b', public.create_webhook_endpoint(
    'd0d0d0d0-0000-4000-8000-00000000000b', 'B main', 'https://hooks.example.test/b',
    ARRAY['routines'], 'enc:v1:b-secret', 'bbbb', 'Authorization', 'enc:v1:b-header');

SELECT is(
    (SELECT s.signing_secret_enc FROM public.webhook_endpoint_secrets s
      WHERE s.endpoint_id = (SELECT id FROM wh_ids WHERE name = 'a')),
    'enc:v1:a-secret',
    'create stores the secret row with the endpoint'
);

SELECT is(
    (SELECT e.custom_header_name || '|' || s.custom_header_value_enc
       FROM public.webhook_endpoints e
       JOIN public.webhook_endpoint_secrets s ON s.endpoint_id = e.id
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'b')),
    'Authorization|enc:v1:b-header',
    'create stores the header name and its encrypted value together'
);

SELECT throws_ok(
    $q$SELECT public.create_webhook_endpoint(
        'd0d0d0d0-0000-4000-8000-00000000000a', 'x', 'https://hooks.example.test/x',
        ARRAY['workouts'], 'enc:v1:x', 'xxxx', 'Authorization', NULL)$q$,
    '22023', 'webhook_endpoint_header_incomplete',
    'a header name without a value is refused'
);

SELECT throws_ok(
    $q$SELECT public.create_webhook_endpoint(
        'd0d0d0d0-0000-4000-8000-00000000000a', 'x', 'http://hooks.example.test/x',
        ARRAY['workouts'], 'enc:v1:x', 'xxxx')$q$,
    '23514', NULL,
    'a non-https URL is refused by the table constraint'
);

SELECT throws_ok(
    $q$SELECT public.create_webhook_endpoint(
        'd0d0d0d0-0000-4000-8000-00000000000a', 'x', 'https://hooks.example.test/x',
        ARRAY['workouts', 'telemetry'], 'enc:v1:x', 'xxxx')$q$,
    '23514', NULL,
    'an unknown scope is refused by the table constraint'
);

SELECT lives_ok(
    $q$SELECT public.create_webhook_endpoint(
        'd0d0d0d0-0000-4000-8000-00000000000b', 'B two', 'https://hooks.example.test/b2',
        ARRAY['goals'], 'enc:v1:b2', 'b222');
       SELECT public.create_webhook_endpoint(
        'd0d0d0d0-0000-4000-8000-00000000000b', 'B three', 'https://hooks.example.test/b3',
        ARRAY['goals'], 'enc:v1:b3', 'b333')$q$,
    'a user can register three endpoints'
);

SELECT throws_ok(
    $q$SELECT public.create_webhook_endpoint(
        'd0d0d0d0-0000-4000-8000-00000000000b', 'B four', 'https://hooks.example.test/b4',
        ARRAY['goals'], 'enc:v1:b4', 'b444')$q$,
    'P0001', 'webhook_endpoint_limit',
    'a fourth endpoint is refused'
);

-- ---------------------------------------------------------------------------
-- Capture: workouts (parent row, coalescing, children, scope, isolation)
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-capture-workouts');

INSERT INTO public.workout_sessions (id, user_id)
VALUES ('d0d0d0d0-0002-4000-8000-00000000000a', 'd0d0d0d0-0000-4000-8000-00000000000a');

SELECT is(pg_temp.pending('a', 'workout'), 1,
    'inserting a session enqueues one workout delivery for the owner''s endpoint');

SELECT is(
    (SELECT d.entity_id || '|' || d.user_id::text FROM public.webhook_deliveries d
      WHERE d.endpoint_id = (SELECT id FROM wh_ids WHERE name = 'a') AND d.entity = 'workout'),
    'd0d0d0d0-0002-4000-8000-00000000000a|d0d0d0d0-0000-4000-8000-00000000000a',
    'the delivery names the session and carries the owner''s user id'
);

SELECT ok(
    (SELECT d.next_attempt_at > now() + interval '10 seconds'
       FROM public.webhook_deliveries d
      WHERE d.endpoint_id = (SELECT id FROM wh_ids WHERE name = 'a') AND d.entity = 'workout'),
    'a new delivery waits for the write to settle before it is due'
);

SELECT is(
    (SELECT count(*)::int FROM public.webhook_deliveries d
      WHERE d.user_id = 'd0d0d0d0-0000-4000-8000-00000000000b'),
    0,
    'user A''s session enqueues nothing for user B''s endpoints'
);

UPDATE public.workout_sessions SET notes = 'one'
WHERE id = 'd0d0d0d0-0002-4000-8000-00000000000a';
UPDATE public.workout_sessions SET notes = 'two'
WHERE id = 'd0d0d0d0-0002-4000-8000-00000000000a';

SELECT is(pg_temp.pending('a', 'workout'), 1,
    'two further edits coalesce into the one pending delivery');

SELECT pg_temp.settle();

-- replace_session_children never touches workout_sessions: without the
-- exercises trigger a re-pushed set list would go unnoticed.
SELECT lives_ok(
    $q$SELECT public.replace_session_children(
        'd0d0d0d0-0000-4000-8000-00000000000a'::uuid,
        ARRAY['d0d0d0d0-0002-4000-8000-00000000000a'::uuid],
        jsonb_build_array(jsonb_build_object(
            'id', 'd0d0d0d0-0003-4000-8000-00000000000a',
            'session_id', 'd0d0d0d0-0002-4000-8000-00000000000a',
            'user_id', 'd0d0d0d0-0000-4000-8000-00000000000a',
            'name', 'Row', 'muscle_group', 'Back', 'order_index', 0)),
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$,
    'replace_session_children runs with the capture triggers in place'
);

SELECT is(pg_temp.pending('a', 'workout'), 1,
    'rewriting a session''s children enqueues a workout delivery');

SELECT pg_temp.settle();

-- B shares routines only.
INSERT INTO public.workout_sessions (id, user_id)
VALUES ('d0d0d0d0-0002-4000-8000-00000000000b', 'd0d0d0d0-0000-4000-8000-00000000000b');

SELECT is(
    (SELECT count(*)::int FROM public.webhook_deliveries d WHERE d.status = 'pending'
        AND d.user_id IN ('d0d0d0d0-0000-4000-8000-00000000000a',
                          'd0d0d0d0-0000-4000-8000-00000000000b')),
    0,
    'a session is not enqueued for an endpoint without the workouts scope'
);

-- ---------------------------------------------------------------------------
-- Capture: routines (child-only edit through the parent, hard delete)
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-capture-routines');

INSERT INTO public.routines (id, user_id, name)
VALUES ('d0d0d0d0-0004-4000-8000-00000000000a', 'd0d0d0d0-0000-4000-8000-00000000000a', 'Push');

SELECT is(pg_temp.pending('a', 'routine'), 1, 'inserting a routine enqueues a routine delivery');
SELECT is(pg_temp.pending('b', 'routine'), 0,
    'user A''s routine is not enqueued for user B''s routines endpoint');

SELECT pg_temp.settle();

INSERT INTO public.routine_exercises (id, routine_id, name)
VALUES ('d0d0d0d0-0005-4000-8000-00000000000a', 'd0d0d0d0-0004-4000-8000-00000000000a', 'Press');

SELECT is(pg_temp.pending('a', 'routine'), 1,
    'adding a routine exercise enqueues its parent routine');
SELECT is(
    (SELECT d.entity_id FROM public.webhook_deliveries d
      WHERE d.endpoint_id = (SELECT id FROM wh_ids WHERE name = 'a')
        AND d.entity = 'routine' AND d.status = 'pending'),
    'd0d0d0d0-0004-4000-8000-00000000000a',
    'the child edit is recorded under the routine id, not the child id'
);

SELECT pg_temp.settle();

DELETE FROM public.routines WHERE id = 'd0d0d0d0-0004-4000-8000-00000000000a';

SELECT is(pg_temp.pending('a', 'routine'), 1,
    'hard-deleting a routine enqueues a routine delivery');

SELECT pg_temp.settle();

-- ---------------------------------------------------------------------------
-- Capture: personal records (soft delete) and external activities (Strava)
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-capture-records-and-external');

INSERT INTO public.personal_records (id, user_id, exercise_name, value)
VALUES ('d0d0d0d0-0006-4000-8000-00000000000a', 'd0d0d0d0-0000-4000-8000-00000000000a', 'Row', 100);
SELECT pg_temp.settle();

UPDATE public.personal_records SET deleted_at = now()
WHERE id = 'd0d0d0d0-0006-4000-8000-00000000000a';

SELECT is(pg_temp.pending('a', 'personal_record'), 1,
    'soft-deleting a personal record enqueues a delivery');

SELECT pg_temp.settle();

INSERT INTO public.external_activities (id, user_id, external_id, provider, name, started_at)
VALUES ('d0d0d0d0-0007-4000-8000-00000000000a', 'd0d0d0d0-0000-4000-8000-00000000000a',
        'wh-strava-1', 'strava', 'Ride', now());

SELECT is(pg_temp.pending('a', 'external_activity'), 0,
    'a Strava-sourced activity is never enqueued');

INSERT INTO public.external_activities (id, user_id, external_id, provider, name, started_at)
VALUES ('d0d0d0d0-0008-4000-8000-00000000000a', 'd0d0d0d0-0000-4000-8000-00000000000a',
        'wh-hevy-1', 'hevy', 'Lift', now());

SELECT is(pg_temp.pending('a', 'external_activity'), 1,
    'a non-Strava activity is enqueued');

DELETE FROM public.external_activities WHERE id = 'd0d0d0d0-0007-4000-8000-00000000000a';

SELECT is(pg_temp.pending('a', 'external_activity'), 1,
    'deleting a Strava-sourced activity enqueues nothing either');

SELECT pg_temp.settle();

-- ---------------------------------------------------------------------------
-- A paused endpoint captures nothing.
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-capture-paused-endpoint');

UPDATE public.webhook_endpoints
SET status = 'paused', disabled_reason = 'user_paused'
WHERE id = (SELECT id FROM wh_ids WHERE name = 'a');

UPDATE public.workout_sessions SET notes = 'while paused'
WHERE id = 'd0d0d0d0-0002-4000-8000-00000000000a';

SELECT is(pg_temp.pending('a', 'workout'), 0, 'a paused endpoint enqueues nothing');

UPDATE public.webhook_endpoints
SET status = 'active', disabled_reason = NULL
WHERE id = (SELECT id FROM wh_ids WHERE name = 'a');

-- ---------------------------------------------------------------------------
-- Structural isolation: a delivery cannot pair A's endpoint with B's user id.
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-delivery-owner-fk');

SELECT throws_ok(
    format(
        $q$INSERT INTO public.webhook_deliveries (endpoint_id, user_id, entity, entity_id)
           VALUES (%L, 'd0d0d0d0-0000-4000-8000-00000000000b', 'workout', 'x')$q$,
        (SELECT id FROM wh_ids WHERE name = 'a')),
    '23503', NULL,
    'a delivery whose user_id is not the endpoint owner violates the composite FK'
);

-- ---------------------------------------------------------------------------
-- Claim
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-claim');

UPDATE public.workout_sessions SET notes = 'claim me'
WHERE id = 'd0d0d0d0-0002-4000-8000-00000000000a';

SELECT is(
    (SELECT count(*)::int FROM public.claim_webhook_deliveries(100, 30, 180)
      WHERE delivery_user_id = 'd0d0d0d0-0000-4000-8000-00000000000a'),
    0,
    'a delivery still inside its settle delay is not claimed'
);

UPDATE public.webhook_deliveries SET next_attempt_at = now() - interval '1 second'
WHERE status = 'pending' AND user_id = 'd0d0d0d0-0000-4000-8000-00000000000a';

CREATE TEMP TABLE wh_claim ON COMMIT DROP AS
SELECT * FROM public.claim_webhook_deliveries(100, 30, 180)
WHERE delivery_user_id = 'd0d0d0d0-0000-4000-8000-00000000000a';

SELECT is((SELECT count(*)::int FROM wh_claim), 1, 'a due delivery is claimed');
SELECT is((SELECT delivery_attempt FROM wh_claim), 1, 'the first claim is attempt 1');
SELECT is(
    (SELECT d.status FROM public.webhook_deliveries d
      WHERE d.id = (SELECT delivery_id FROM wh_claim)),
    'delivering',
    'a claimed delivery is marked delivering'
);

SELECT is(
    (SELECT count(*)::int FROM public.claim_webhook_deliveries(100, 30, 180)
      WHERE delivery_user_id = 'd0d0d0d0-0000-4000-8000-00000000000a'),
    0,
    'a delivery under a live lease is not claimed twice'
);

UPDATE public.webhook_deliveries SET claimed_at = now() - interval '10 minutes'
WHERE id = (SELECT delivery_id FROM wh_claim);

SELECT is(
    (SELECT delivery_attempt FROM public.claim_webhook_deliveries(100, 30, 180)
      WHERE delivery_id = (SELECT delivery_id FROM wh_claim)),
    2,
    'an expired lease is reclaimed as the next attempt'
);

-- ---------------------------------------------------------------------------
-- Completion
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-complete');

SELECT is(
    public.complete_webhook_delivery((SELECT delivery_id FROM wh_claim), 1, 'delivered'),
    NULL,
    'a worker holding a superseded claim cannot complete the delivery'
);

SELECT throws_ok(
    format($q$SELECT public.complete_webhook_delivery(%L, 2, 'exploded')$q$,
           (SELECT delivery_id FROM wh_claim)),
    '22023', 'webhook_delivery_outcome_invalid',
    'an unknown outcome is refused'
);

SELECT is(
    public.complete_webhook_delivery(
        (SELECT delivery_id FROM wh_claim), 2, 'failed', 'workout.updated', 503, 'http_error', 120),
    'pending',
    'a failed attempt goes back to pending'
);

SELECT ok(
    (SELECT d.next_attempt_at > now() + interval '3 minutes'
            AND d.last_status_code = 503
            AND d.last_error_code = 'http_error'
            AND d.claimed_at IS NULL
       FROM public.webhook_deliveries d WHERE d.id = (SELECT delivery_id FROM wh_claim)),
    'the retry is scheduled with backoff and records the status and error code'
);

SELECT is(
    (SELECT e.consecutive_failures FROM public.webhook_endpoints e
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'a')),
    1,
    'a failed attempt counts against the endpoint'
);

-- Honour Retry-After, capped at one hour.
UPDATE public.webhook_deliveries
SET status = 'delivering', attempt_count = 1, claimed_at = now()
WHERE id = (SELECT delivery_id FROM wh_claim);

SELECT is(
    public.complete_webhook_delivery(
        (SELECT delivery_id FROM wh_claim), 1, 'failed', NULL, 429, 'http_error', 5, 99999),
    'pending',
    'a 429 is rescheduled'
);

SELECT ok(
    (SELECT d.next_attempt_at BETWEEN now() + interval '59 minutes' AND now() + interval '61 minutes'
       FROM public.webhook_deliveries d WHERE d.id = (SELECT delivery_id FROM wh_claim)),
    'Retry-After is honoured but capped at one hour'
);

UPDATE public.webhook_deliveries
SET status = 'delivering', attempt_count = 3, claimed_at = now()
WHERE id = (SELECT delivery_id FROM wh_claim);

SELECT is(
    public.complete_webhook_delivery(
        (SELECT delivery_id FROM wh_claim), 3, 'delivered', 'workout.updated', 200, NULL, 80),
    'delivered',
    'a successful attempt is marked delivered'
);

SELECT ok(
    (SELECT e.consecutive_failures = 0 AND e.last_success_at IS NOT NULL
       FROM public.webhook_endpoints e
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'a')),
    'a success resets the endpoint failure count'
);

-- Superseded: the entity changed again while an attempt was in flight.
INSERT INTO public.webhook_deliveries (id, endpoint_id, user_id, entity, entity_id, status, attempt_count, claimed_at)
SELECT 'd0d0d0d0-0009-4000-8000-00000000000a', id, 'd0d0d0d0-0000-4000-8000-00000000000a',
       'workout', 'd0d0d0d0-0002-4000-8000-00000000000a', 'delivering', 1, now()
FROM wh_ids WHERE name = 'a';

UPDATE public.workout_sessions SET notes = 'changed mid-flight'
WHERE id = 'd0d0d0d0-0002-4000-8000-00000000000a';

SELECT is(
    public.complete_webhook_delivery('d0d0d0d0-0009-4000-8000-00000000000a', 1, 'failed', NULL, 500, 'http_error'),
    'skipped',
    'a failed attempt with a newer pending delivery waiting is closed, not retried'
);

SELECT is(
    (SELECT d.last_error_code FROM public.webhook_deliveries d
      WHERE d.id = 'd0d0d0d0-0009-4000-8000-00000000000a'),
    'superseded',
    'the closed attempt is labelled superseded'
);

SELECT pg_temp.settle();

-- Out of attempts: dead, and the endpoint is switched off with a reason.
INSERT INTO public.webhook_deliveries (id, endpoint_id, user_id, entity, entity_id, status, attempt_count, claimed_at)
SELECT 'd0d0d0d0-000a-4000-8000-00000000000a', id, 'd0d0d0d0-0000-4000-8000-00000000000a',
       'workout', 'd0d0d0d0-0002-4000-8000-00000000000a', 'delivering', 9, now()
FROM wh_ids WHERE name = 'a';

SELECT is(
    public.complete_webhook_delivery('d0d0d0d0-000a-4000-8000-00000000000a', 9, 'failed', NULL, NULL, 'connection_failed'),
    'dead',
    'the ninth failed attempt is dead'
);

SELECT is(
    (SELECT e.status || '|' || e.disabled_reason FROM public.webhook_endpoints e
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'a')),
    'disabled|too_many_failures',
    'a dead delivery disables the endpoint with a reason the owner can read'
);

UPDATE public.workout_sessions SET notes = 'after disable'
WHERE id = 'd0d0d0d0-0002-4000-8000-00000000000a';

SELECT is(pg_temp.pending('a', 'workout'), 0, 'a disabled endpoint enqueues nothing');

-- 410 Gone on B's endpoint: off at once.
INSERT INTO public.webhook_deliveries (id, endpoint_id, user_id, entity, entity_id, status, attempt_count, claimed_at)
SELECT 'd0d0d0d0-000b-4000-8000-00000000000b', id, 'd0d0d0d0-0000-4000-8000-00000000000b',
       'routine', 'gone-probe', 'delivering', 1, now()
FROM wh_ids WHERE name = 'b';

SELECT is(
    public.complete_webhook_delivery('d0d0d0d0-000b-4000-8000-00000000000b', 1, 'gone', NULL, 410, 'http_error'),
    'dead',
    'a 410 response is dead on the first attempt'
);

SELECT is(
    (SELECT e.status || '|' || e.disabled_reason FROM public.webhook_endpoints e
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'b')),
    'disabled|endpoint_gone',
    'a 410 response disables the endpoint as endpoint_gone'
);

-- ---------------------------------------------------------------------------
-- Tier: a lapsed owner's endpoint is paused by the claim (FP-2).
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-claim-pauses-lapsed-owner');

INSERT INTO wh_ids
SELECT 'c', public.create_webhook_endpoint(
    'd0d0d0d0-0000-4000-8000-00000000000c', 'C main', 'https://hooks.example.test/c',
    ARRAY['routines'], 'enc:v1:c-secret', 'cccc');

INSERT INTO public.routines (id, user_id, name)
VALUES ('d0d0d0d0-0004-4000-8000-00000000000c', 'd0d0d0d0-0000-4000-8000-00000000000c', 'C routine');

SELECT is(pg_temp.pending('c', 'routine'), 1, 'the lapsed owner''s write is enqueued while the endpoint is active');

UPDATE public.webhook_deliveries SET next_attempt_at = now() - interval '1 second'
WHERE user_id = 'd0d0d0d0-0000-4000-8000-00000000000c' AND status = 'pending';

SELECT is(
    (SELECT count(*)::int FROM public.claim_webhook_deliveries(100, 30, 180)
      WHERE delivery_user_id = 'd0d0d0d0-0000-4000-8000-00000000000c'),
    0,
    'nothing is claimed for an owner below FLAME'
);

SELECT is(
    (SELECT e.status || '|' || e.disabled_reason FROM public.webhook_endpoints e
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'c')),
    'paused|subscription_lapsed',
    'the claim pauses the lapsed owner''s endpoint with a reason'
);

SELECT is(
    (SELECT d.status || '|' || d.last_error_code FROM public.webhook_deliveries d
      WHERE d.user_id = 'd0d0d0d0-0000-4000-8000-00000000000c'),
    'skipped|subscription_lapsed',
    'the lapsed owner''s waiting delivery is closed'
);

UPDATE public.routines SET name = 'C routine 2'
WHERE id = 'd0d0d0d0-0004-4000-8000-00000000000c';

SELECT is(pg_temp.pending('c', 'routine'), 0,
    'after the pause a further write enqueues nothing');

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-backfill');

UPDATE public.webhook_endpoints
SET status = 'active', disabled_reason = NULL
WHERE id = (SELECT id FROM wh_ids WHERE name = 'a');
SELECT pg_temp.settle();

SELECT is(
    public.enqueue_webhook_backfill(
        'd0d0d0d0-0000-4000-8000-00000000000b', (SELECT id FROM wh_ids WHERE name = 'a')),
    0,
    'a backfill requested with another user''s id enqueues nothing'
);

-- A has: one session, one routine ("Before"), one soft-deleted record (not
-- replayed) and one non-Strava activity.
SELECT is(
    public.enqueue_webhook_backfill(
        'd0d0d0d0-0000-4000-8000-00000000000a', (SELECT id FROM wh_ids WHERE name = 'a')),
    3,
    'a backfill enqueues every live entity in the endpoint''s scopes'
);

SELECT is(
    (SELECT count(*)::int FROM public.webhook_deliveries d
      WHERE d.endpoint_id = (SELECT id FROM wh_ids WHERE name = 'a')
        AND d.status = 'pending'
        AND d.user_id <> 'd0d0d0d0-0000-4000-8000-00000000000a'),
    0,
    'every backfilled delivery carries the endpoint owner''s user id'
);

SELECT is(
    public.enqueue_webhook_backfill(
        'd0d0d0d0-0000-4000-8000-00000000000a', (SELECT id FROM wh_ids WHERE name = 'a')),
    0,
    'a second backfill coalesces with the pending rows'
);

-- ---------------------------------------------------------------------------
-- Rotation and header
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-rotate-and-header');

SELECT ok(
    NOT public.rotate_webhook_signing_secret(
        'd0d0d0d0-0000-4000-8000-00000000000b', (SELECT id FROM wh_ids WHERE name = 'a'),
        'enc:v1:stolen', 'zzzz'),
    'another user cannot rotate the endpoint''s secret'
);

SELECT ok(
    public.rotate_webhook_signing_secret(
        'd0d0d0d0-0000-4000-8000-00000000000a', (SELECT id FROM wh_ids WHERE name = 'a'),
        'enc:v1:a-secret-2', 'a222'),
    'the owner can rotate the secret'
);

SELECT is(
    (SELECT s.signing_secret_enc || '|' || s.previous_signing_secret_enc
            || '|' || (s.previous_expires_at > now() + interval '23 hours')::text
       FROM public.webhook_endpoint_secrets s
      WHERE s.endpoint_id = (SELECT id FROM wh_ids WHERE name = 'a')),
    'enc:v1:a-secret-2|enc:v1:a-secret|true',
    'rotation keeps the old secret valid for the overlap'
);

SELECT is(
    (SELECT e.signing_key_hint FROM public.webhook_endpoints e
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'a')),
    'a222',
    'rotation updates the visible hint'
);

SELECT ok(
    NOT public.set_webhook_endpoint_header(
        'd0d0d0d0-0000-4000-8000-00000000000b', (SELECT id FROM wh_ids WHERE name = 'a'),
        'X-Api-Key', 'enc:v1:stolen'),
    'another user cannot set the endpoint''s header'
);

SELECT ok(
    public.set_webhook_endpoint_header(
        'd0d0d0d0-0000-4000-8000-00000000000a', (SELECT id FROM wh_ids WHERE name = 'a'),
        'X-Api-Key', 'enc:v1:a-header'),
    'the owner can set a header'
);

SELECT ok(
    public.set_webhook_endpoint_header(
        'd0d0d0d0-0000-4000-8000-00000000000a', (SELECT id FROM wh_ids WHERE name = 'a'), NULL, NULL),
    'the owner can clear the header'
);

SELECT is(
    (SELECT (e.custom_header_name IS NULL AND s.custom_header_value_enc IS NULL)
       FROM public.webhook_endpoints e
       JOIN public.webhook_endpoint_secrets s ON s.endpoint_id = e.id
      WHERE e.id = (SELECT id FROM wh_ids WHERE name = 'a')),
    true,
    'clearing removes both the name and the encrypted value'
);

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-retention');

INSERT INTO public.webhook_deliveries (id, endpoint_id, user_id, entity, entity_id, status, created_at, finished_at)
SELECT 'd0d0d0d0-000c-4000-8000-00000000000a', id, 'd0d0d0d0-0000-4000-8000-00000000000a',
       'workout', 'old', 'delivered', now() - interval '31 days', now() - interval '31 days'
FROM wh_ids WHERE name = 'a';

INSERT INTO public.webhook_deliveries (id, endpoint_id, user_id, entity, entity_id, status, created_at, finished_at)
SELECT 'd0d0d0d0-000d-4000-8000-00000000000a', id, 'd0d0d0d0-0000-4000-8000-00000000000a',
       'workout', 'recent', 'delivered', now() - interval '29 days', now() - interval '29 days'
FROM wh_ids WHERE name = 'a';

SELECT ok(private.prune_webhook_deliveries() >= 1, 'retention deletes finished deliveries');

SELECT is(
    (SELECT string_agg(d.entity_id, ',' ORDER BY d.entity_id) FROM public.webhook_deliveries d
      WHERE d.id IN ('d0d0d0d0-000c-4000-8000-00000000000a', 'd0d0d0d0-000d-4000-8000-00000000000a')),
    'recent',
    'only deliveries older than 30 days are deleted'
);

-- ---------------------------------------------------------------------------
-- Account deletion (FP-6). The capture triggers fire while the user's rows
-- cascade away; nothing may be left behind and nothing may abort the delete.
-- ---------------------------------------------------------------------------
SELECT diag('database:webhook-account-deletion-cascade');

SELECT lives_ok(
    $q$DELETE FROM auth.users WHERE id = 'd0d0d0d0-0000-4000-8000-00000000000a'$q$,
    'deleting a user with an active endpoint and pending deliveries succeeds'
);

SELECT is(
    (SELECT (SELECT count(*) FROM public.webhook_endpoints WHERE user_id = 'd0d0d0d0-0000-4000-8000-00000000000a')
          + (SELECT count(*) FROM public.webhook_endpoint_secrets WHERE user_id = 'd0d0d0d0-0000-4000-8000-00000000000a')
          + (SELECT count(*) FROM public.webhook_deliveries WHERE user_id = 'd0d0d0d0-0000-4000-8000-00000000000a'))::int,
    0,
    'the deleted user''s endpoints, secrets and deliveries are gone'
);

SELECT * FROM finish();
ROLLBACK;
