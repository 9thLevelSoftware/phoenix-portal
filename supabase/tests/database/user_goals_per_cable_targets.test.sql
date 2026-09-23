BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(22);

-- ---------------------------------------------------------------------------
-- Shape after 20260920003000_user_goals_per_cable_targets.sql
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'user_goals', 'target_basis', 'user_goals.target_basis exists');
SELECT col_not_null('public', 'user_goals', 'target_basis', 'target_basis is NOT NULL');
-- No DEFAULT on purpose: a default would stamp an old client's doubled PR
-- target as per-cable. The BEFORE INSERT trigger fills it instead.
SELECT col_hasnt_default('public', 'user_goals', 'target_basis', 'target_basis has no column default');
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_goals_target_basis_check'
          AND conrelid = 'public.user_goals'::regclass
    ),
    'target_basis check constraint exists'
);
SELECT has_trigger(
    'public', 'user_goals', 'user_goals_default_target_basis',
    'the BEFORE INSERT basis trigger exists'
);

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-4000-8000-00000000f301', 'goals-pr30@example.test')
ON CONFLICT (id) DO NOTHING;

-- The goal-limit trigger depends on a subscription; it is not under test.
ALTER TABLE public.user_goals DISABLE TRIGGER enforce_goal_limit;

-- ---------------------------------------------------------------------------
-- Old clients after the migration: the BEFORE INSERT trigger.
-- A NULL basis means a pre-PR-30 client, whose PR target is a doubled total.
-- This is NOT deploy-order independence (the migration's own "Order-
-- independence trigger" header overstates it and, being an applied migration,
-- is left as is): the supported order is migration first. An SPA that ships
-- ahead of 20260920003000 fails its goal inserts with PGRST204, because the
-- target_basis column does not exist yet.
-- ---------------------------------------------------------------------------

-- New SPA: writes the basis explicitly. Nothing is halved.
INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, exercise_name, target_basis)
VALUES ('00000000-0000-4000-8000-00000000f311', '00000000-0000-4000-8000-00000000f301', 'pr', 60, 'kg', 'Bench Press', 'per_cable');

SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f311'),
    60::numeric,
    'an explicit per_cable PR target is left exactly as sent'
);
SELECT is(
    (SELECT target_basis FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f311'),
    'per_cable',
    'an explicit per_cable PR goal keeps its basis'
);

-- Old SPA: no basis at all. A PR target is a doubled total.
INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, exercise_name)
VALUES
    ('00000000-0000-4000-8000-00000000f331', '00000000-0000-4000-8000-00000000f301', 'pr', 80, 'kg', 'Overhead Press'),
    ('00000000-0000-4000-8000-00000000f332', '00000000-0000-4000-8000-00000000f301', 'volume', 5000, 'kg/week', NULL),
    ('00000000-0000-4000-8000-00000000f333', '00000000-0000-4000-8000-00000000f301', 'frequency', 3, 'workouts/week', NULL);

SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f331'),
    40::numeric,
    'a NULL-basis PR target (doubled total 80) is halved to 40 on insert'
);
SELECT is(
    (SELECT target_basis FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f331'),
    'per_cable',
    'a NULL-basis PR goal is stamped per_cable on insert'
);
SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f332'),
    5000::numeric,
    'a NULL-basis volume target is never halved'
);
SELECT is(
    (SELECT target_basis FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f332'),
    'per_cable',
    'a NULL-basis volume goal is stamped per_cable so NOT NULL holds'
);
SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f333'),
    3::numeric,
    'a NULL-basis frequency target is never halved'
);
SELECT is(
    (SELECT target_basis FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f333'),
    'per_cable',
    'a NULL-basis frequency goal is stamped per_cable so NOT NULL holds'
);

-- ---------------------------------------------------------------------------
-- One-shot backfill. Rebuild the pre-migration state (legacy rows have
-- target_basis NULL), then run the migration's data statements twice.
-- The statements below mirror the migration file exactly; keep them in sync.
-- The insert trigger is disabled here so the legacy rows really do land with
-- a NULL basis — otherwise the backfill would have nothing to match and
-- these assertions would pass vacuously.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_goals DISABLE TRIGGER user_goals_default_target_basis;
ALTER TABLE public.user_goals DROP CONSTRAINT user_goals_target_basis_check;
ALTER TABLE public.user_goals ALTER COLUMN target_basis DROP NOT NULL;

INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, exercise_name, target_basis)
VALUES
    ('00000000-0000-4000-8000-00000000f321', '00000000-0000-4000-8000-00000000f301', 'pr', 80, 'kg', 'Squat', NULL),
    ('00000000-0000-4000-8000-00000000f322', '00000000-0000-4000-8000-00000000f301', 'volume', 5000, 'kg/week', NULL, NULL),
    ('00000000-0000-4000-8000-00000000f323', '00000000-0000-4000-8000-00000000f301', 'frequency', 3, 'workouts/week', NULL, NULL);

-- Run 1 (mirrors the migration).
UPDATE public.user_goals
SET target_value = target_value / 2, target_basis = 'per_cable', updated_at = now()
WHERE target_basis IS NULL AND goal_type = 'pr';
UPDATE public.user_goals SET target_basis = 'per_cable' WHERE target_basis IS NULL;

SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f321'),
    40::numeric,
    'legacy PR goal target (doubled total 80) is halved to 40 per cable'
);
SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f311'),
    60::numeric,
    'an already per-cable PR goal is not halved'
);
SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f322'),
    5000::numeric,
    'volume goal target is left alone'
);
SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f323'),
    3::numeric,
    'frequency goal target is left alone'
);
SELECT is(
    (SELECT count(*)::int FROM public.user_goals WHERE target_basis IS DISTINCT FROM 'per_cable'),
    0,
    'every row is marked per_cable after the first run'
);

-- Run 2 (re-apply): nothing changes.
UPDATE public.user_goals
SET target_value = target_value / 2, target_basis = 'per_cable', updated_at = now()
WHERE target_basis IS NULL AND goal_type = 'pr';
UPDATE public.user_goals SET target_basis = 'per_cable' WHERE target_basis IS NULL;

SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f321'),
    40::numeric,
    're-running does not halve the legacy PR goal again'
);
SELECT is(
    (SELECT target_value FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f311'),
    60::numeric,
    're-running leaves the per-cable PR goal alone'
);

-- Restore the constraints the migration sets, and check they hold.
ALTER TABLE public.user_goals ENABLE TRIGGER user_goals_default_target_basis;
ALTER TABLE public.user_goals ALTER COLUMN target_basis SET NOT NULL;
ALTER TABLE public.user_goals
    ADD CONSTRAINT user_goals_target_basis_check CHECK (target_basis = 'per_cable');

SELECT throws_ok(
    $$UPDATE public.user_goals SET target_basis = 'total' WHERE id = '00000000-0000-4000-8000-00000000f311'$$,
    '23514',
    NULL,
    'target_basis only accepts per_cable'
);

SELECT throws_ok(
    $$UPDATE public.user_goals SET target_basis = NULL WHERE id = '00000000-0000-4000-8000-00000000f311'$$,
    '23502',
    NULL,
    'target_basis cannot be NULL after the migration'
);

SELECT * FROM finish();
ROLLBACK;
