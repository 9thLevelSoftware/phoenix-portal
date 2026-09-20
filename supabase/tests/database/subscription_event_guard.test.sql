-- apply_subscription_event: ordering guard + untracked-subscription guard.
--
-- The SQL copy of _shared/billingAction.ts#classifySubscriptionEventTarget
-- (migration 20260920004400). paddle-webhooks applies the same rule in app
-- code; this one closes the read-then-decide race between two concurrent
-- deliveries, so it must stay in step with the TypeScript rule.
--
-- Runs in CI with the rest of the suite (`supabase test db` in
-- .github/workflows/migrations.yml); locally: `npm run test:db`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT no_plan();

INSERT INTO auth.users (id, email)
VALUES ('5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'sub-guard@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- ---------------------------------------------------------------------------
-- Tracked subscription sub_new, active and entitled.
-- ---------------------------------------------------------------------------
DELETE FROM public.subscriptions
WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid;

INSERT INTO public.subscriptions (
    user_id, paddle_customer_id, paddle_subscription_id, tier, status,
    current_period_end, cancel_at_period_end, last_event_id,
    last_event_occurred_at
)
VALUES (
    '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_new',
    'EMBER', 'active', now() + INTERVAL '30 days', false, 'evt_new_active',
    now() - INTERVAL '1 hour'
);

-- The old subscription's cancellation must not revoke the new one's access.
SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_old',
        'FREE', 'canceled', NULL, NULL, NULL, false, 'evt_old_canceled', now()
    ),
    false,
    'an untracked subscription''s cancellation is ignored'
);

SELECT is(
    (
        SELECT status || ':' || paddle_subscription_id
        FROM public.subscriptions
        WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid
    ),
    'active:sub_new',
    'the tracked subscription is left active'
);

SELECT is(
    (
        SELECT count(*)::int
        FROM public.subscription_events
        WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid
          AND note = 'untracked_subscription'
          AND paddle_subscription_id = 'sub_old'
    ),
    1,
    'the ignored event is audited as note=untracked_subscription'
);

-- A second live subscription may not steal an entitled row either.
SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_other',
        'INFERNO', 'active', NULL, now(), now() + INTERVAL '30 days', false,
        'evt_other_active', now()
    ),
    false,
    'an untracked live subscription cannot take over an entitled row'
);

-- ---------------------------------------------------------------------------
-- Once the tracked subscription is dead, a resubscribe is adopted.
-- ---------------------------------------------------------------------------
UPDATE public.subscriptions
   SET status = 'canceled', tier = 'FREE'
 WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid;

SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_other',
        'FLAME', 'active', NULL, now(), now() + INTERVAL '30 days', false,
        'evt_other_active_2', now()
    ),
    true,
    'a live subscription is adopted when the stored row is not entitled'
);

SELECT is(
    (
        SELECT paddle_subscription_id || ':' || tier
        FROM public.subscriptions
        WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid
    ),
    'sub_other:FLAME',
    'the row follows the adopted subscription'
);

-- past_due keeps access, so it is NOT an adoption window.
UPDATE public.subscriptions
   SET status = 'past_due', current_period_end = now() - INTERVAL '10 days'
 WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid;

SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_third',
        'EMBER', 'active', NULL, now(), now() + INTERVAL '30 days', false,
        'evt_third_active', now()
    ),
    false,
    'past_due is entitled, so an untracked subscription is still ignored'
);

-- ---------------------------------------------------------------------------
-- The tracked subscription always writes its own row, and the pre-existing
-- ordering guard still holds.
-- ---------------------------------------------------------------------------
SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_other',
        'FREE', 'canceled', NULL, NULL, NULL, false, 'evt_other_canceled',
        now() + INTERVAL '1 minute'
    ),
    true,
    'the tracked subscription may cancel itself'
);

SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_other',
        'EMBER', 'active', NULL, now(), now() + INTERVAL '30 days', false,
        'evt_stale', now() - INTERVAL '1 day'
    ),
    false,
    'a stale event is still rejected by the ordering guard'
);

-- A user with no row at all is unaffected by the guard.
DELETE FROM public.subscriptions
WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid;

SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_first',
        'EMBER', 'active', NULL, now(), now() + INTERVAL '30 days', false,
        'evt_first', now()
    ),
    true,
    'the first event for a user is applied'
);

SELECT * FROM finish();
ROLLBACK;
