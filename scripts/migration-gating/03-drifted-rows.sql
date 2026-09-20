-- Rows that only exist on a drifted database: NULL timestamps and a TEXT
-- per_set_echo_levels. The pgTAP suite runs against an empty database, so
-- section 2's backfill and section 1's USING clause are never exercised there.
--
-- Run immediately after 01-drift.sql. 20260920007600 is then applied on top.
BEGIN;

-- Re-runnable: drop anything a previous run of this script left behind
-- (routines, routine_exercises and training_cycles cascade from the user).
DELETE FROM auth.users WHERE id = '9a170000-0000-4000-8000-00000000a171'::uuid;

INSERT INTO auth.users (id, email)
VALUES ('9a170000-0000-4000-8000-00000000a171'::uuid, 'migration-gating@example.test')
ON CONFLICT (id) DO NOTHING;

-- A: created_at NULL, updated_at set. The backfill must copy updated_at into
-- created_at and must NOT move updated_at -- updated_at is the delta-pull
-- cursor, so re-stamping it re-pulls the routine on every device.
INSERT INTO public.routines (id, user_id, name, created_at, updated_at)
VALUES ('9a170000-1111-4000-8000-00000000a171'::uuid,
        '9a170000-0000-4000-8000-00000000a171'::uuid,
        'gating routine A',
        NULL,
        '2020-01-01 00:00:00+00'::timestamptz);

-- B: both NULL. Nothing to copy from, so both become now().
INSERT INTO public.routines (id, user_id, name, created_at, updated_at)
VALUES ('9a170000-1111-4000-8000-00000000a172'::uuid,
        '9a170000-0000-4000-8000-00000000a171'::uuid,
        'gating routine B',
        NULL,
        NULL);

-- C: fully populated. Must be left completely alone, updated_at included.
INSERT INTO public.routines (id, user_id, name, created_at, updated_at)
VALUES ('9a170000-1111-4000-8000-00000000a173'::uuid,
        '9a170000-0000-4000-8000-00000000a171'::uuid,
        'gating routine C',
        '2019-06-01 00:00:00+00'::timestamptz,
        '2019-06-02 00:00:00+00'::timestamptz);

INSERT INTO public.training_cycles (id, user_id, name, updated_at)
VALUES ('9a170000-3333-4000-8000-00000000a171'::uuid,
        '9a170000-0000-4000-8000-00000000a171'::uuid,
        'gating cycle',
        NULL);

-- The three inputs that tell to_jsonb(text) and text::jsonb apart:
--   a JSON-array string -> to_jsonb: string scalar "[...]"; ::jsonb: an array
--   a non-JSON string   -> to_jsonb: string scalar;        ::jsonb: 22P02
--   NULL                -> NULL under both
INSERT INTO public.routine_exercises (id, routine_id, name, per_set_echo_levels)
VALUES
    ('9a170000-2222-4000-8000-00000000a171'::uuid,
     '9a170000-1111-4000-8000-00000000a171'::uuid,
     'json array string',
     '["LEVEL_1","LEVEL_2"]'),
    ('9a170000-2222-4000-8000-00000000a172'::uuid,
     '9a170000-1111-4000-8000-00000000a171'::uuid,
     'non json string',
     'not json'),
    ('9a170000-2222-4000-8000-00000000a173'::uuid,
     '9a170000-1111-4000-8000-00000000a171'::uuid,
     'null echo levels',
     NULL);

COMMIT;
