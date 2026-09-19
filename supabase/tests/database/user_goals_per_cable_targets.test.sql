BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(14);

-- ---------------------------------------------------------------------------
-- Shape after 20260920003000_user_goals_per_cable_targets.sql
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'user_goals', 'target_basis', 'user_goals.target_basis exists');
SELECT col_not_null('public', 'user_goals', 'target_basis', 'target_basis is NOT NULL');
SELECT col_default_is('public', 'user_goals', 'target_basis', 'per_cable', 'new goals default to per_cable');
SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_goals_target_basis_check'
          AND conrelid = 'public.user_goals'::regclass
    ),
    'target_basis check constraint exists'
);

-- ---------------------------------------------------------------------------
-- Data conversion. Rebuild the pre-migration state (legacy rows have
-- target_basis NULL), then run the migration's data statements twice.
-- The statements below mirror the migration file exactly; keep them in sync.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-4000-8000-00000000f301', 'goals-pr30@example.test')
ON CONFLICT (id) DO NOTHING;

-- The goal-limit trigger depends on a subscription; it is not under test.
ALTER TABLE public.user_goals DISABLE TRIGGER enforce_goal_limit;

-- A goal created after the migration (default basis) must never be halved.
INSERT INTO public.user_goals (id, user_id, goal_type, target_value, target_unit, exercise_name)
VALUES ('00000000-0000-4000-8000-00000000f311', '00000000-0000-4000-8000-00000000f301', 'pr', 60, 'kg', 'Bench Press');

SELECT is(
    (SELECT target_basis FROM public.user_goals WHERE id = '00000000-0000-4000-8000-00000000f311'),
    'per_cable',
    'a new goal gets target_basis per_cable by default'
);

-- Recreate the legacy state.
ALTER TABLE public.user_goals DROP CONSTRAINT user_goals_target_basis_check;
ALTER TABLE public.user_goals ALTER COLUMN target_basis DROP NOT NULL;
ALTER TABLE public.user_goals ALTER COLUMN target_basis DROP DEFAULT;

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
ALTER TABLE public.user_goals ALTER COLUMN target_basis SET DEFAULT 'per_cable';
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
