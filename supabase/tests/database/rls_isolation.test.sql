-- Cross-user RLS isolation.
--
-- Users A and B are both FLAME, so every owner write policy (including the
-- FLAME-gated ones from 20260920000900) has a positive control; C has no
-- subscription row (FREE). A owns one fixture row in every private
-- user-owned relation listed in rls_cases. Tier denials live in
-- trust_plane.test.sql (EMBER) and tier_matrix.test.sql (FLAME).
-- Users A and B are both EMBER; C has no subscription row (FREE). A owns one
-- fixture row in every private user-owned relation listed in rls_cases.
--
-- Coverage guard: every public table must have RLS enabled, and every public
-- relation with a user_id column must be either in rls_cases or on the
-- commented exemption list below, so a new user-owned table fails this file
-- until someone classifies it.
--
-- Per relation:
--   * owner positive control: A sees its own row, and can UPDATE / DELETE it
--     where an owner policy for that command exists, so dropping an owner
--     policy turns this file red instead of passing vacuously. Service-only
--     relations expect "at most 0" (0 rows or a 42501 privilege refusal), so
--     revoking client grants later does not break the file;
--   * B cannot SELECT A's row (keyed probe);
--   * B and anon cannot UPDATE / DELETE A's row. These write probes are
--     BLIND: no WHERE, no RETURNING and a constant SET, so only the
--     UPDATE / DELETE policies filter them (a WHERE or RETURNING would also
--     apply the SELECT policy and mask a permissive UPDATE/DELETE policy).
--     Inside this transaction B and anon own no rows at all, so any affected
--     row is a cross-user write;
--   * anon cannot read A's row.
-- Write-side spoofing: B cannot INSERT rows owned by A or under A's parents,
-- and cannot re-parent its own rows to A (WITH CHECK is exercised).
-- Subscriptions: A cannot INSERT or UPDATE them or raise its own tier.
--
-- Every write probe runs inside a subtransaction that is always rolled back.
-- A refusal with 42501 (privilege or RLS) is reported as -1 / '42501', so a
-- later privilege hardening keeps these assertions green.
--
-- Fixtures are inserted as postgres (bypassing the tier-gated INSERT
-- policies, which trust_plane.test.sql and tier_matrix.test.sql cover).
-- Fixtures are inserted as postgres (bypassing the EMBER-gated INSERT
-- policies, which trust_plane.test.sql covers).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

-- ---------------------------------------------------------------------------
-- Helpers (pg_temp, SECURITY INVOKER: they run with the caller's role).
-- ---------------------------------------------------------------------------

-- p_op:
--   select        count of rows with key_col = key visible to the caller
--   update_key    UPDATE ... SET <set> WHERE key_col = key   (owner control)
--   delete_key    DELETE ... WHERE key_col = key             (owner control)
--   update_blind  UPDATE ... SET <set>   (no WHERE, no RETURNING)
--   delete_blind  DELETE FROM ...        (no WHERE, no RETURNING)
-- Returns the row count, or -1 when refused with 42501.
CREATE FUNCTION pg_temp.rls_probe(
    p_table text,
    p_op text,
    p_key_col text,
    p_key text,
    p_set text
) RETURNS integer
LANGUAGE plpgsql
AS $probe$
DECLARE
    affected integer;
BEGIN
    IF p_op = 'select' THEN
        BEGIN
            EXECUTE format(
                'SELECT count(*)::integer FROM public.%I WHERE %I::text = $1',
                p_table,
                p_key_col
            ) INTO affected USING p_key;
            RETURN affected;
        EXCEPTION WHEN insufficient_privilege THEN
            RETURN -1;
        END;
    END IF;

    BEGIN
        IF p_op = 'update_key' THEN
            EXECUTE format(
                'UPDATE public.%I SET %s WHERE %I::text = $1',
                p_table, p_set, p_key_col
            ) USING p_key;
        ELSIF p_op = 'delete_key' THEN
            EXECUTE format(
                'DELETE FROM public.%I WHERE %I::text = $1',
                p_table, p_key_col
            ) USING p_key;
        ELSIF p_op = 'update_blind' THEN
            EXECUTE format('UPDATE public.%I SET %s', p_table, p_set);
        ELSIF p_op = 'delete_blind' THEN
            EXECUTE format('DELETE FROM public.%I', p_table);
        ELSE
            RAISE EXCEPTION 'rls_probe: unknown op %', p_op;
        END IF;
        GET DIAGNOSTICS affected = ROW_COUNT;
        -- Always undo the write; carry the count out in the message.
        RAISE EXCEPTION USING ERRCODE = 'P0R01', MESSAGE = affected::text;
    EXCEPTION
        WHEN SQLSTATE 'P0R01' THEN
            RETURN SQLERRM::integer;
        WHEN insufficient_privilege THEN
            RETURN -1;
    END;
END
$probe$;

-- Runs p_setup then p_sql, always rolled back. Returns 'ok' when p_sql
-- succeeded, else its SQLSTATE; 'setup:<sqlstate> <message>' when the setup
-- itself failed (a broken fixture, never a pass).
CREATE FUNCTION pg_temp.try_sql(p_setup text, p_sql text) RETURNS text
LANGUAGE plpgsql
AS $try$
DECLARE
    outcome text;
BEGIN
    BEGIN
        IF p_setup IS NOT NULL THEN
            BEGIN
                EXECUTE p_setup;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION USING
                    ERRCODE = 'P0R02',
                    MESSAGE = 'setup:' || SQLSTATE || ' ' || SQLERRM;
            END;
        END IF;
        BEGIN
            EXECUTE p_sql;
            outcome := 'ok';
        EXCEPTION WHEN OTHERS THEN
            outcome := SQLSTATE;
        END;
        RAISE EXCEPTION USING ERRCODE = 'P0R01', MESSAGE = outcome;
    EXCEPTION
        WHEN SQLSTATE 'P0R01' OR SQLSTATE 'P0R02' THEN
            RETURN SQLERRM;
    END;
END
$try$;

CREATE FUNCTION pg_temp.act_as(p_role text, p_user uuid) RETURNS void
LANGUAGE plpgsql
AS $act$
BEGIN
    IF p_role = 'anon' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    ELSE
        PERFORM set_config(
            'request.jwt.claims',
            json_build_object('sub', p_user, 'role', p_role)::text,
            true
        );
    END IF;
END
$act$;

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
    ('a1a1a1a1-0000-4000-8000-00000000000a'::uuid, 'rls-a@example.test'),
    ('b2b2b2b2-0000-4000-8000-00000000000b'::uuid, 'rls-b@example.test'),
    ('c3c3c3c3-0000-4000-8000-00000000000c'::uuid, 'rls-c@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- handle_new_user() creates a profile per auth user. A keeps its profile as
-- the fixture; B's and C's are removed so B/anon own no rows anywhere.
INSERT INTO public.profiles (id)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.profiles
WHERE id IN (
    'b2b2b2b2-0000-4000-8000-00000000000b',
    'c3c3c3c3-0000-4000-8000-00000000000c'
);

INSERT INTO public.subscriptions (id, user_id, tier, status, current_period_end)
VALUES
    (
        'a1a1a1a1-5555-4000-8000-00000000000a'::uuid,
        'a1a1a1a1-0000-4000-8000-00000000000a'::uuid,
        'FLAME', 'active', now() + INTERVAL '30 days'
        'EMBER', 'active', now() + INTERVAL '30 days'
    ),
    (
        'b2b2b2b2-5555-4000-8000-00000000000b'::uuid,
        'b2b2b2b2-0000-4000-8000-00000000000b'::uuid,
        'FLAME', 'active', now() + INTERVAL '30 days'
        'EMBER', 'active', now() + INTERVAL '30 days'
    );

INSERT INTO public.workout_sessions (id, user_id)
VALUES ('a1a1a1a1-0001-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-00000000000a');

INSERT INTO public.exercises (id, session_id, name, user_id)
VALUES (
    'a1a1a1a1-0002-4000-8000-00000000000a',
    'a1a1a1a1-0001-4000-8000-00000000000a',
    'Row',
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.sets (id, exercise_id, set_number, user_id)
VALUES (
    'a1a1a1a1-0003-4000-8000-00000000000a',
    'a1a1a1a1-0002-4000-8000-00000000000a',
    1,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.rep_summaries (id, set_id, rep_number, user_id)
VALUES (
    'a1a1a1a1-0004-4000-8000-00000000000a',
    'a1a1a1a1-0003-4000-8000-00000000000a',
    1,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.rep_telemetry (id, set_id, timestamp_ms, user_id)
VALUES (
    'a1a1a1a1-0005-4000-8000-00000000000a',
    'a1a1a1a1-0003-4000-8000-00000000000a',
    1000,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.routines (id, user_id, name)
VALUES (
    'a1a1a1a1-0006-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'A routine'
);

INSERT INTO public.routine_exercises (id, routine_id, name)
VALUES (
    'a1a1a1a1-0007-4000-8000-00000000000a',
    'a1a1a1a1-0006-4000-8000-00000000000a',
    'Row'
);

INSERT INTO public.training_cycles (id, user_id, name)
VALUES (
    'a1a1a1a1-0008-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'A cycle'
);

INSERT INTO public.cycle_days (id, cycle_id, day_number)
VALUES (
    'a1a1a1a1-0009-4000-8000-00000000000a',
    'a1a1a1a1-0008-4000-8000-00000000000a',
    1
);

INSERT INTO public.personal_records (id, user_id, exercise_name, value)
VALUES (
    'a1a1a1a1-0010-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'Row',
    100
);

INSERT INTO public.exercise_progress (id, user_id, exercise_name, session_id)
VALUES (
    'a1a1a1a1-0011-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'Row',
    'a1a1a1a1-0001-4000-8000-00000000000a'
);

-- enforce_goal_limit reads the tier of auth.uid(), so insert as A's JWT.
SELECT pg_temp.act_as('authenticated', 'a1a1a1a1-0000-4000-8000-00000000000a');
INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit)
VALUES (
    'a1a1a1a1-0012-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'frequency',
    3,
    'workouts'
);
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO public.oauth_tokens (id, user_id, provider)
VALUES (
    'a1a1a1a1-0013-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'strava'
);

INSERT INTO public.user_integrations (id, user_id, provider)
VALUES (
    'a1a1a1a1-0014-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'strava'
);

INSERT INTO public.deletion_requests (id, user_id)
VALUES (
    'a1a1a1a1-0015-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.challenges (id, name, challenge_type, target_value)
VALUES ('a1a1a1a1-0016-4000-8000-00000000000a', 'RLS challenge', 'volume', 1);

INSERT INTO public.challenge_participants (id, challenge_id, user_id)
VALUES (
    'a1a1a1a1-0017-4000-8000-00000000000a',
    'a1a1a1a1-0016-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.earned_badges (id, user_id, badge_id, badge_name)
VALUES (
    'a1a1a1a1-0018-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'rls-badge',
    'RLS badge'
);

INSERT INTO public.exercise_catalog (id, name, display_name, muscle_group, is_custom, user_id)
VALUES (
    'rls-custom-exercise-a',
    'rls custom',
    'RLS custom',
    'back',
    true,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.exercise_signatures (id, user_id, exercise_id)
VALUES (
    'a1a1a1a1-0019-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'rls-exercise'
);

INSERT INTO public.external_activities (id, user_id, external_id, provider, name, started_at)
VALUES (
    'a1a1a1a1-0020-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'rls-ext-1',
    'strava',
    'RLS ride',
    now()
);

INSERT INTO public.gamification_stats (user_id)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.goal_snapshots (id, user_id, goal_id)
VALUES (
    'a1a1a1a1-0021-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'a1a1a1a1-0012-4000-8000-00000000000a'
);

INSERT INTO public.local_profiles (user_id, id, name)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'rls-local-profile-a', 'RLS profile');

INSERT INTO public.local_profile_preferences (user_id, local_profile_id)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'rls-local-profile-a')
ON CONFLICT (user_id, local_profile_id) DO NOTHING;

INSERT INTO public.oauth_states (id, state_token, user_id, provider, expires_at)
VALUES (
    'a1a1a1a1-0022-4000-8000-00000000000a',
    'rls-state-token-a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'strava',
    now() + INTERVAL '10 minutes'
);

INSERT INTO public.overload_suggestions (
    id, user_id, exercise_name, suggestion_type, current_value,
    suggested_value, rationale, confidence
)
VALUES (
    'a1a1a1a1-0023-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'Row', 'deload', 100, 90, 'rls', 0.5
);

INSERT INTO public.paddle_webhook_events (id, payload, user_id)
VALUES (
    'a1a1a1a1-0024-4000-8000-00000000000a',
    '{}'::jsonb,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.rate_limit_tracking (id, provider, user_id)
VALUES (
    'a1a1a1a1-0025-4000-8000-00000000000a',
    'strava',
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.rpg_attributes (user_id)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.saved_community_items (id, user_id, shared_item_id, item_type)
VALUES (
    'a1a1a1a1-0026-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'a1a1a1a1-0027-4000-8000-00000000000a',
    'routine'
);

INSERT INTO public.session_phase_statistics (id, session_id, user_id)
VALUES (
    'a1a1a1a1-0028-4000-8000-00000000000a',
    'a1a1a1a1-0001-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.subscription_events (id, operation, row_snapshot, user_id)
VALUES (
    'a1a1a1a1-0029-4000-8000-00000000000a',
    'INSERT',
    '{}'::jsonb,
    'a1a1a1a1-0000-4000-8000-00000000000a'
);

INSERT INTO public.sync_queue (id, user_id, provider)
VALUES (
    'a1a1a1a1-0030-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'strava'
);

INSERT INTO public.sync_tombstones (user_id, entity, entity_id)
VALUES (
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'routine',
    'a1a1a1a1-0035-4000-8000-00000000000a'
);

INSERT INTO public.telemetry_analysis (id, set_id, user_id, analysis_type, result)
VALUES (
    'a1a1a1a1-0031-4000-8000-00000000000a',
    'a1a1a1a1-0003-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'rfd',
    '{}'::jsonb
);

INSERT INTO public.user_insights (id, user_id, insight_type, title, description)
VALUES (
    'a1a1a1a1-0032-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'info', 'RLS', 'RLS insight'
);

INSERT INTO public.user_onboarding (user_id)
VALUES ('a1a1a1a1-0000-4000-8000-00000000000a')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.vbt_assessments (id, user_id, exercise_id, estimated_1rm_kg)
VALUES (
    'a1a1a1a1-0033-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    'rls-exercise',
    100
);

INSERT INTO public.wearable_daily_summaries (id, user_id, summary_date, provider)
VALUES (
    'a1a1a1a1-0034-4000-8000-00000000000a',
    'a1a1a1a1-0000-4000-8000-00000000000a',
    current_date,
    'fitbit'
);

-- One row per private user-owned relation.
--   key_col / row_key: how the probe finds A's fixture row.
--   owner_select: rows A must see; NULL = service-only (expect <= 0).
--   owner_update / owner_delete: expected rows for A's keyed write, or NULL
--     when there is intentionally no owner policy for that command.
--   update_set: a CONSTANT assignment (never reads a column) on a column the
--     client roles may update, used by every UPDATE probe.
-- Owner-chain relations without user_id (routine_exercises, cycle_days) and
-- the security_invoker view telemetry_points are listed explicitly.
CREATE TEMP TABLE rls_cases (
    table_name text PRIMARY KEY,
    key_col text NOT NULL,
    row_key text NOT NULL,
    owner_select integer,
    owner_update integer,
    owner_delete integer,
    update_set text NOT NULL
) ON COMMIT DROP;

INSERT INTO rls_cases VALUES
    ('workout_sessions',          'id', 'a1a1a1a1-0001-4000-8000-00000000000a', 1, 1,    NULL, $s$notes = 'rls-probe'$s$),
    ('exercises',                 'id', 'a1a1a1a1-0002-4000-8000-00000000000a', 1, NULL, NULL, $s$name = 'rls-probe'$s$),
    ('sets',                      'id', 'a1a1a1a1-0003-4000-8000-00000000000a', 1, NULL, NULL, $s$set_number = 99$s$),
    ('rep_summaries',             'id', 'a1a1a1a1-0004-4000-8000-00000000000a', 1, NULL, NULL, $s$rep_number = 99$s$),
    ('rep_telemetry',             'id', 'a1a1a1a1-0005-4000-8000-00000000000a', 1, NULL, NULL, $s$timestamp_ms = 99$s$),
    ('telemetry_points',          'id', 'a1a1a1a1-0005-4000-8000-00000000000a', 1, NULL, NULL, $s$timestamp_ms = 99$s$),
    ('routines',                  'id', 'a1a1a1a1-0006-4000-8000-00000000000a', 1, 1,    1,    $s$name = 'rls-probe'$s$),
    ('routine_exercises',         'id', 'a1a1a1a1-0007-4000-8000-00000000000a', 1, 1,    1,    $s$name = 'rls-probe'$s$),
    ('training_cycles',           'id', 'a1a1a1a1-0008-4000-8000-00000000000a', 1, 1,    1,    $s$name = 'rls-probe'$s$),
    ('cycle_days',                'id', 'a1a1a1a1-0009-4000-8000-00000000000a', 1, 1,    1,    $s$day_number = 99$s$),
    ('personal_records',          'id', 'a1a1a1a1-0010-4000-8000-00000000000a', 1, NULL, NULL, $s$value = 99$s$),
    ('exercise_progress',         'id', 'a1a1a1a1-0011-4000-8000-00000000000a', 1, NULL, NULL, $s$exercise_name = 'rls-probe'$s$),
    ('user_goals',                'id', 'a1a1a1a1-0012-4000-8000-00000000000a', 1, 1,    1,    $s$target_value = 99$s$),
    ('subscriptions',             'id', 'a1a1a1a1-5555-4000-8000-00000000000a', 1, NULL, NULL, $s$tier = 'INFERNO'$s$),
    ('oauth_tokens',              'id', 'a1a1a1a1-0013-4000-8000-00000000000a', NULL, NULL, NULL, $s$provider = 'rls-probe'$s$),
    ('user_integrations',         'id', 'a1a1a1a1-0014-4000-8000-00000000000a', 1, 1,    1,    $s$last_sync_at = '2000-01-01T00:00:00Z'$s$),
    ('deletion_requests',         'id', 'a1a1a1a1-0015-4000-8000-00000000000a', 1, NULL, NULL, $s$cancelled_at = '2000-01-01T00:00:00Z'$s$),
    ('challenge_participants',    'id', 'a1a1a1a1-0017-4000-8000-00000000000a', 1, NULL, 1,    $s$completed_at = '2000-01-01T00:00:00Z'$s$),
    ('earned_badges',             'id', 'a1a1a1a1-0018-4000-8000-00000000000a', 1, NULL, 1,    $s$badge_name = 'rls-probe'$s$),
    ('exercise_catalog',          'id', 'rls-custom-exercise-a',                1, 1,    1,    $s$display_name = 'rls-probe'$s$),
    ('exercise_signatures',       'id', 'a1a1a1a1-0019-4000-8000-00000000000a', 1, NULL, NULL, $s$exercise_id = 'rls-probe'$s$),
    ('external_activities',       'id', 'a1a1a1a1-0020-4000-8000-00000000000a', 1, 1,    1,    $s$name = 'rls-probe'$s$),
    ('gamification_stats',        'user_id', 'a1a1a1a1-0000-4000-8000-00000000000a', 1, 1, NULL, $s$pr_count = 99$s$),
    ('gamification_stats',        'user_id', 'a1a1a1a1-0000-4000-8000-00000000000a', 1, NULL, NULL, $s$pr_count = 99$s$),
    ('goal_snapshots',            'id', 'a1a1a1a1-0021-4000-8000-00000000000a', 1, NULL, NULL, $s$progress_pct = 99$s$),
    -- Client DML is revoked; access goes through definer RPCs
    -- (profile_preferences.test.sql), so even the owner reads nothing here.
    ('local_profile_preferences', 'local_profile_id', 'rls-local-profile-a',    NULL, NULL, NULL, $s$body_weight_kg = 0$s$),
    ('local_profiles',            'id', 'rls-local-profile-a',                  1, 1,    1,    $s$name = 'rls-probe'$s$),
    ('oauth_states',              'id', 'a1a1a1a1-0022-4000-8000-00000000000a', NULL, NULL, NULL, $s$provider = 'rls-probe'$s$),
    ('overload_suggestions',      'id', 'a1a1a1a1-0023-4000-8000-00000000000a', 1, NULL, NULL, $s$rationale = 'rls-probe'$s$),
    ('paddle_webhook_events',     'id', 'a1a1a1a1-0024-4000-8000-00000000000a', NULL, NULL, NULL, $s$payload = '{}'::jsonb$s$),
    ('profiles',                  'id', 'a1a1a1a1-0000-4000-8000-00000000000a', 1, 1,    NULL, $s$display_name = 'rls-probe'$s$),
    ('rate_limit_tracking',       'id', 'a1a1a1a1-0025-4000-8000-00000000000a', NULL, NULL, NULL, $s$provider = 'rls-probe'$s$),
    ('rpg_attributes',            'user_id', 'a1a1a1a1-0000-4000-8000-00000000000a', 1, 1, NULL, $s$level = 99$s$),
    ('rpg_attributes',            'user_id', 'a1a1a1a1-0000-4000-8000-00000000000a', 1, NULL, NULL, $s$level = 99$s$),
    ('saved_community_items',     'id', 'a1a1a1a1-0026-4000-8000-00000000000a', 1, NULL, 1,    $s$item_type = 'cycle'$s$),
    ('session_phase_statistics',  'id', 'a1a1a1a1-0028-4000-8000-00000000000a', 1, NULL, NULL, $s$concentric_kg_avg = 99$s$),
    ('subscription_events',       'id', 'a1a1a1a1-0029-4000-8000-00000000000a', NULL, NULL, NULL, $s$operation = 'UPDATE'$s$),
    ('sync_queue',                'id', 'a1a1a1a1-0030-4000-8000-00000000000a', 1, NULL, NULL, $s$provider = 'rls-probe'$s$),
    ('sync_tombstones',           'entity_id', 'a1a1a1a1-0035-4000-8000-00000000000a', 1, NULL, NULL, $s$deleted_at = '2000-01-01T00:00:00Z'$s$),
    ('telemetry_analysis',        'id', 'a1a1a1a1-0031-4000-8000-00000000000a', 1, NULL, NULL, $s$result = '{}'::jsonb$s$),
    ('user_insights',             'id', 'a1a1a1a1-0032-4000-8000-00000000000a', 1, NULL, NULL, $s$title = 'rls-probe'$s$),
    ('user_onboarding',           'user_id', 'a1a1a1a1-0000-4000-8000-00000000000a', 1, 1, NULL, $s$version_seen = 'rls-probe'$s$),
    ('vbt_assessments',           'id', 'a1a1a1a1-0033-4000-8000-00000000000a', 1, NULL, NULL, $s$estimated_1rm_kg = 99$s$),
    ('wearable_daily_summaries',  'id', 'a1a1a1a1-0034-4000-8000-00000000000a', 1, NULL, NULL, $s$provider = 'rls-probe'$s$);

-- Public relations with a user_id column that are readable by design and
-- therefore not isolation cases:
--   community_comments, community_votes   community feed (authenticated read)
--   shared_routines, shared_cycles        published templates (authenticated read)
--   creator_stats, public_profiles        public aggregate / directory views
CREATE TEMP TABLE rls_exempt (table_name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO rls_exempt VALUES
    ('community_comments'),
    ('community_votes'),
    ('shared_routines'),
    ('shared_cycles'),
    ('creator_stats'),
    ('public_profiles');

-- Relations owned through a parent instead of a user_id column.
CREATE TEMP TABLE rls_owner_chain (table_name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO rls_owner_chain VALUES ('routine_exercises'), ('cycle_days');

-- Triggers create rows for every new auth user (e.g. a default local
-- profile). Remove B's and C's so that, during the blind probes, B and anon
-- own nothing in any case relation (B's subscription stays: it makes B FLAME).
-- own nothing in any case relation (B's subscription stays: it makes B EMBER).
DO $cleanup$
DECLARE
    rel text;
BEGIN
    FOR rel IN
        SELECT rc.table_name
        FROM rls_cases rc
        JOIN pg_class c ON c.oid = format('public.%I', rc.table_name)::regclass
        JOIN pg_attribute a
          ON a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
        WHERE c.relkind IN ('r', 'p')
          AND rc.table_name <> 'subscriptions'
    LOOP
        EXECUTE format(
            'DELETE FROM public.%I WHERE user_id IN (%L::uuid, %L::uuid)',
            rel,
            'b2b2b2b2-0000-4000-8000-00000000000b',
            'c3c3c3c3-0000-4000-8000-00000000000c'
        );
    END LOOP;
END
$cleanup$;

GRANT SELECT ON rls_cases TO anon, authenticated;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-coverage');
-- ---------------------------------------------------------------------------

SELECT is_empty(
    $sql$
        SELECT c.relname::text
        FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace
          AND c.relkind IN ('r', 'p')
          AND NOT c.relrowsecurity
    $sql$,
    'every public table has RLS enabled'
);

SELECT is_empty(
    $sql$
        SELECT c.relname::text
        FROM pg_class c
        JOIN pg_attribute a
          ON a.attrelid = c.oid
         AND a.attname = 'user_id'
         AND NOT a.attisdropped
        WHERE c.relnamespace = 'public'::regnamespace
          AND c.relkind IN ('r', 'p', 'v', 'm')
          AND c.relname NOT IN (SELECT table_name FROM rls_cases)
          AND c.relname NOT IN (SELECT table_name FROM rls_exempt)
    $sql$,
    'every public relation with user_id is an isolation case or explicitly exempt'
);

SELECT is_empty(
    $sql$
        SELECT t.table_name
        FROM (
            SELECT table_name FROM rls_cases
            UNION ALL SELECT table_name FROM rls_exempt
        ) t
        WHERE to_regclass('public.' || quote_ident(t.table_name)) IS NULL
    $sql$,
    'no stale names in the case / exemption lists'
);

SELECT is_empty(
    $sql$
        SELECT table_name FROM rls_owner_chain
        EXCEPT SELECT table_name FROM rls_cases
    $sql$,
    'owner-chain relations are isolation cases'
);

SELECT ok(
    CASE c.relkind
        WHEN 'v' THEN coalesce('security_invoker=true' = ANY (c.reloptions), false)
        ELSE c.relrowsecurity
    END,
    format(
        CASE c.relkind
            WHEN 'v' THEN 'view public.%s is security_invoker'
            ELSE 'RLS is enabled on public.%s'
        END,
        rc.table_name
    )
)
FROM rls_cases rc
JOIN pg_class c
  ON c.oid = format('public.%I', rc.table_name)::regclass
ORDER BY rc.table_name;

-- Fixture sanity (as postgres, RLS bypassed).
SELECT is(
    pg_temp.rls_probe(rc.table_name, 'select', rc.key_col, rc.row_key, NULL),
    1,
    format('fixture row exists in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

-- Blind probes are only meaningful if B, C and anon own nothing.
SELECT is(
    (
        SELECT count(*)::integer
        FROM rls_cases rc
        JOIN pg_attribute a
          ON a.attrelid = format('public.%I', rc.table_name)::regclass
         AND a.attname = 'user_id'
         AND NOT a.attisdropped
        CROSS JOIN LATERAL (
            SELECT (xpath(
                '/row/n/text()',
                query_to_xml(
                    format(
                        'SELECT count(*) AS n FROM public.%I WHERE user_id IN (%L::uuid, %L::uuid)',
                        rc.table_name,
                        'b2b2b2b2-0000-4000-8000-00000000000b',
                        'c3c3c3c3-0000-4000-8000-00000000000c'
                    ),
                    false, true, ''
                )
            ))[1]::text::integer AS n
        ) others
        WHERE others.n > 0
          -- B's subscription is needed for FLAME; no client UPDATE/DELETE
          -- B's subscription is needed for EMBER; no client UPDATE/DELETE
          -- policy may ever match it, so the blind probe still expects 0.
          AND rc.table_name <> 'subscriptions'
    ),
    0,
    'B and C own no rows in the case relations (blind probes are exact)'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM public.profiles
        WHERE id IN (
            'b2b2b2b2-0000-4000-8000-00000000000b',
            'c3c3c3c3-0000-4000-8000-00000000000c'
        )
    ),
    0,
    'B and C have no profile row (blind probes on profiles are exact)'
);

-- Capture the subscription state before any client attempt.
CREATE TEMP TABLE subscription_before ON COMMIT DROP AS
SELECT user_id, tier, status, current_period_end
FROM public.subscriptions
WHERE user_id IN (
    'a1a1a1a1-0000-4000-8000-00000000000a'::uuid,
    'b2b2b2b2-0000-4000-8000-00000000000b'::uuid
);

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-owner-positive-control');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'a1a1a1a1-0000-4000-8000-00000000000a');

SELECT is(
    pg_temp.rls_probe(rc.table_name, 'select', rc.key_col, rc.row_key, NULL),
    rc.owner_select,
    format('owner A sees its own row in public.%s', rc.table_name)
)
FROM rls_cases rc
WHERE rc.owner_select IS NOT NULL
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'select', rc.key_col, rc.row_key, NULL),
    '<=',
    0,
    format('public.%s is service-only: even the owner reads nothing', rc.table_name)
)
FROM rls_cases rc
WHERE rc.owner_select IS NULL
ORDER BY rc.table_name;

SELECT is(
    pg_temp.rls_probe(rc.table_name, 'update_key', rc.key_col, rc.row_key, rc.update_set),
    rc.owner_update,
    format('owner A can UPDATE own row in public.%s', rc.table_name)
)
FROM rls_cases rc
WHERE rc.owner_update IS NOT NULL
ORDER BY rc.table_name;

SELECT is(
    pg_temp.rls_probe(rc.table_name, 'delete_key', rc.key_col, rc.row_key, NULL),
    rc.owner_delete,
    format('owner A can DELETE own row in public.%s', rc.table_name)
)
FROM rls_cases rc
WHERE rc.owner_delete IS NOT NULL
ORDER BY rc.table_name;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-cross-user');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'b2b2b2b2-0000-4000-8000-00000000000b');

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'select', rc.key_col, rc.row_key, NULL),
    '<=',
    0,
    format('user B cannot SELECT A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'update_blind', rc.key_col, rc.row_key, rc.update_set),
    '<=',
    0,
    format('user B''s unfiltered UPDATE touches no row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'delete_blind', rc.key_col, rc.row_key, NULL),
    '<=',
    0,
    format('user B''s unfiltered DELETE removes no row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-anon');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;
SELECT pg_temp.act_as('anon', NULL);

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'select', rc.key_col, rc.row_key, NULL),
    '<=',
    0,
    format('anon cannot read A''s row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'update_blind', rc.key_col, rc.row_key, rc.update_set),
    '<=',
    0,
    format('anon''s unfiltered UPDATE touches no row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT cmp_ok(
    pg_temp.rls_probe(rc.table_name, 'delete_blind', rc.key_col, rc.row_key, NULL),
    '<=',
    0,
    format('anon''s unfiltered DELETE removes no row in public.%s', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-write-spoofing');
-- ---------------------------------------------------------------------------
-- B tries to create rows owned by A, or under A's parents, and to re-parent
-- its own rows to A. Setup rows are B's own and are rolled back with each
-- probe. Every attempt must be refused with 42501 (WITH CHECK or privilege).
-- Re-parenting UPDATEs are blind (no WHERE / RETURNING): with a WHERE clause
-- Postgres also checks the new row against the SELECT policy, which would
-- mask a permissive WITH CHECK. Without it only the UPDATE policy's WITH
-- CHECK decides. A blind UPDATE matching no row would return 'ok' and fail,
-- so each probe is known to have reached B's setup row.

CREATE TEMP TABLE spoof_cases (
    label text PRIMARY KEY,
    setup_sql text,
    attack_sql text NOT NULL
) ON COMMIT DROP;

INSERT INTO spoof_cases VALUES
    -- INSERT a row owned by A.
    ('workout_sessions: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.workout_sessions (user_id) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a')$q$),
    ('exercises: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.exercises (session_id, name, user_id) VALUES ('a1a1a1a1-0001-4000-8000-00000000000a', 'x', 'a1a1a1a1-0000-4000-8000-00000000000a')$q$),
    ('personal_records: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.personal_records (user_id, exercise_name, value) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'x', 1)$q$),
    ('rep_telemetry: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.rep_telemetry (set_id, timestamp_ms, user_id) VALUES ('a1a1a1a1-0003-4000-8000-00000000000a', 1, 'a1a1a1a1-0000-4000-8000-00000000000a')$q$),
    ('routines: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.routines (user_id, name) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'x')$q$),
    ('training_cycles: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.training_cycles (user_id, name) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'x')$q$),
    ('user_goals: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.user_goals (user_id, goal_type, target_value, target_unit) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'frequency', 1, 'x')$q$),
    ('user_integrations: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.user_integrations (user_id, provider) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'fitbit')$q$),
    ('external_activities: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.external_activities (user_id, external_id, provider, name, started_at) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'x', 'strava', 'x', now())$q$),
    ('local_profiles: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.local_profiles (user_id, id, name) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'rls-spoof', 'x')$q$),
    ('earned_badges: INSERT with user_id = A', NULL,
     $q$INSERT INTO public.earned_badges (user_id, badge_id, badge_name) VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'x', 'x')$q$),
    ('exercise_catalog: INSERT custom exercise for A', NULL,
     $q$INSERT INTO public.exercise_catalog (id, name, display_name, muscle_group, is_custom, user_id) VALUES ('rls-spoof', 'x', 'x', 'x', true, 'a1a1a1a1-0000-4000-8000-00000000000a')$q$),
    -- INSERT a child under A's parent.
    ('routine_exercises: INSERT under A''s routine', NULL,
     $q$INSERT INTO public.routine_exercises (routine_id, name) VALUES ('a1a1a1a1-0006-4000-8000-00000000000a', 'x')$q$),
    ('cycle_days: INSERT under A''s cycle', NULL,
     $q$INSERT INTO public.cycle_days (cycle_id, day_number) VALUES ('a1a1a1a1-0008-4000-8000-00000000000a', 2)$q$),
    -- Re-parent B's own row to A.
    ('workout_sessions: UPDATE own row to user_id = A',
     $q$INSERT INTO public.workout_sessions (id, user_id) VALUES ('b2b2b2b2-0001-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-00000000000b')$q$,
    -- Clients cannot INSERT sessions (server-written only) and may UPDATE
    -- only `notes`, so the user_id rewrite is refused by the column grant
    -- before any row is matched; no setup row is needed.
    ('workout_sessions: UPDATE own row to user_id = A',
     NULL,
     $q$UPDATE public.workout_sessions SET user_id = 'a1a1a1a1-0000-4000-8000-00000000000a'$q$),
    ('routines: UPDATE own row to user_id = A',
     $q$INSERT INTO public.routines (id, user_id, name) VALUES ('b2b2b2b2-0006-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-00000000000b', 'b')$q$,
     $q$UPDATE public.routines SET user_id = 'a1a1a1a1-0000-4000-8000-00000000000a'$q$),
    ('training_cycles: UPDATE own row to user_id = A',
     $q$INSERT INTO public.training_cycles (id, user_id, name) VALUES ('b2b2b2b2-0008-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-00000000000b', 'b')$q$,
     $q$UPDATE public.training_cycles SET user_id = 'a1a1a1a1-0000-4000-8000-00000000000a'$q$),
    ('user_goals: UPDATE own row to user_id = A',
     $q$INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit) VALUES ('b2b2b2b2-0012-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-00000000000b', 'frequency', 1, 'x')$q$,
     $q$UPDATE public.user_goals SET user_id = 'a1a1a1a1-0000-4000-8000-00000000000a'$q$),
    ('user_integrations: UPDATE own row to user_id = A',
     $q$INSERT INTO public.user_integrations (user_id, provider) VALUES ('b2b2b2b2-0000-4000-8000-00000000000b', 'garmin')$q$,
     $q$UPDATE public.user_integrations SET user_id = 'a1a1a1a1-0000-4000-8000-00000000000a'$q$),
    ('external_activities: UPDATE own row to user_id = A',
     $q$INSERT INTO public.external_activities (id, user_id, external_id, provider, name, started_at) VALUES ('b2b2b2b2-0020-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-00000000000b', 'b', 'strava', 'b', now())$q$,
     $q$UPDATE public.external_activities SET user_id = 'a1a1a1a1-0000-4000-8000-00000000000a'$q$),
    ('routine_exercises: move own row under A''s routine',
     $q$INSERT INTO public.routines (id, user_id, name) VALUES ('b2b2b2b2-0006-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-00000000000b', 'b');
        INSERT INTO public.routine_exercises (id, routine_id, name) VALUES ('b2b2b2b2-0007-4000-8000-00000000000b', 'b2b2b2b2-0006-4000-8000-00000000000b', 'b')$q$,
     $q$UPDATE public.routine_exercises SET routine_id = 'a1a1a1a1-0006-4000-8000-00000000000a'$q$),
    ('cycle_days: move own row under A''s cycle',
     $q$INSERT INTO public.training_cycles (id, user_id, name) VALUES ('b2b2b2b2-0008-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-00000000000b', 'b');
        INSERT INTO public.cycle_days (id, cycle_id, day_number) VALUES ('b2b2b2b2-0009-4000-8000-00000000000b', 'b2b2b2b2-0008-4000-8000-00000000000b', 5)$q$,
     $q$UPDATE public.cycle_days SET cycle_id = 'a1a1a1a1-0008-4000-8000-00000000000a'$q$);

GRANT SELECT ON spoof_cases TO authenticated;

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'b2b2b2b2-0000-4000-8000-00000000000b');

SELECT is(
    pg_temp.try_sql(sc.setup_sql, sc.attack_sql),
    '42501',
    'user B is refused: ' || sc.label
)
FROM spoof_cases sc
ORDER BY sc.label;

-- Positive control for the setups: B can create and edit its own rows, so a
-- refusal above comes from the cross-user part of the statement.
SELECT is(
    pg_temp.try_sql(
        sc.setup_sql,
        'SELECT 1'
    ),
    'ok',
    'setup for B''s own rows succeeds: ' || sc.label
)
FROM spoof_cases sc
WHERE sc.setup_sql IS NOT NULL
ORDER BY sc.label;

RESET ROLE;

-- A moving its own profile onto B's id.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'a1a1a1a1-0000-4000-8000-00000000000a');

SELECT is(
    pg_temp.try_sql(
        NULL,
        $q$UPDATE public.profiles SET id = 'b2b2b2b2-0000-4000-8000-00000000000b'$q$
    ),
    '42501',
    'user A cannot re-key its profile to another user'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
SELECT diag('database:rls-isolation-subscription-tier');
-- ---------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'a1a1a1a1-0000-4000-8000-00000000000a');

SELECT cmp_ok(
    pg_temp.rls_probe(
        'subscriptions',
        'update_key',
        'id',
        'a1a1a1a1-5555-4000-8000-00000000000a',
        $set$tier = 'INFERNO', current_period_end = now() + INTERVAL '10 years'$set$
    ),
    '<=',
    0,
    'A cannot UPDATE its own subscription (0 rows or refused)'
);

-- Not wrapped in rls_probe: a successful raise must stick so the invariant
-- checks below would see it. A privilege refusal also counts as blocked.
DO $attempt$
BEGIN
    UPDATE public.subscriptions
    SET tier = 'INFERNO'
    WHERE user_id = 'a1a1a1a1-0000-4000-8000-00000000000a';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END
$attempt$;

SELECT throws_ok(
    $sql$
        INSERT INTO public.subscriptions (user_id, tier, status)
        VALUES ('a1a1a1a1-0000-4000-8000-00000000000a', 'INFERNO', 'active')
        ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier
    $sql$,
    '42501',
    NULL,
    'A cannot upsert its own subscription to a higher tier'
);

SELECT is(
    public.user_has_min_tier('INFERNO'),
    false,
    'A still does not hold INFERNO after the attempts'
    public.user_has_min_tier('FLAME'),
    false,
    'A still does not hold FLAME after the attempts'
);

RESET ROLE;

-- C has no subscription row (FREE) and tries to grant itself one.
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as('authenticated', 'c3c3c3c3-0000-4000-8000-00000000000c');

SELECT throws_ok(
    $sql$
        INSERT INTO public.subscriptions (user_id, tier, status)
        VALUES ('c3c3c3c3-0000-4000-8000-00000000000c', 'INFERNO', 'active')
    $sql$,
    '42501',
    NULL,
    'a FREE user cannot INSERT a subscription for itself'
);

SELECT is(
    public.user_has_min_tier('EMBER'),
    false,
    'FREE user C is still below EMBER after the attempt'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT results_eq(
    $sql$
        SELECT user_id, tier, status, current_period_end
        FROM public.subscriptions
        WHERE user_id IN (
            'a1a1a1a1-0000-4000-8000-00000000000a'::uuid,
            'b2b2b2b2-0000-4000-8000-00000000000b'::uuid
        )
        ORDER BY user_id
    $sql$,
    $sql$
        SELECT user_id, tier, status, current_period_end
        FROM subscription_before
        ORDER BY user_id
    $sql$,
    'subscriptions are unchanged after every client write attempt'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM public.subscriptions
        WHERE user_id = 'c3c3c3c3-0000-4000-8000-00000000000c'
    ),
    0,
    'no subscription row was created for C'
);

-- Fixtures survived every probe (probes always roll back; B/anon wrote nothing).
SELECT is(
    pg_temp.rls_probe(rc.table_name, 'select', rc.key_col, rc.row_key, NULL),
    1,
    format('A''s row in public.%s is still present after all probes', rc.table_name)
)
FROM rls_cases rc
ORDER BY rc.table_name;

SELECT * FROM finish();

ROLLBACK;
