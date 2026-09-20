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

-- A pause is stored as 'canceled' too, and must not revoke access either.
SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_old',
        'FREE', 'none', NULL, NULL, NULL, false, 'evt_old_none', now()
    ),
    false,
    'any untracked state that would not keep the user entitled is ignored'
);

-- A live untracked subscription IS allowed through by this function: the
-- "don't let a second live subscription take over an entitled row"
-- preference lives in app code (classifySubscriptionEventTarget), which runs
-- first. This copy exists to block the dangerous direction only, so that the
-- R-34 rescue can adopt a sibling in ONE write without first having to
-- cancel the tracked row.
SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_other',
        'INFERNO', 'active', NULL, now(), now() + INTERVAL '30 days', false,
        'evt_other_active', now() + INTERVAL '1 minute'
    ),
    true,
    'an untracked subscription that KEEPS the user entitled is allowed'
);

-- Restore the tracked-subscription fixture for the checks below.
UPDATE public.subscriptions
   SET paddle_subscription_id = 'sub_new', tier = 'EMBER', status = 'active',
       current_period_end = now() + INTERVAL '30 days'
 WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid;

-- past_due keeps access (R-33), so the rescue must be able to adopt a
-- past-due sibling. Rejecting it here would 500 the webhook and strand a
-- paying customer on FREE.
SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_dunning',
        'FLAME', 'past_due', NULL, now() - INTERVAL '40 days',
        now() - INTERVAL '10 days', false, 'evt_dunning', now() + INTERVAL '2 minutes'
    ),
    true,
    'a past_due untracked subscription can be adopted'
);

SELECT is(
    (
        SELECT paddle_subscription_id || ':' || status
        FROM public.subscriptions
        WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid
    ),
    'sub_dunning:past_due',
    'the row follows the adopted past_due subscription'
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
        'evt_other_active_2', now() + INTERVAL '3 minutes'
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

-- A cancellation from an untracked subscription is refused whatever the
-- stored row looks like — that is the F-022 money bug this guard exists for.
UPDATE public.subscriptions
   SET paddle_subscription_id = 'sub_other', status = 'past_due',
       current_period_end = now() - INTERVAL '10 days'
 WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid;

SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_third',
        'FREE', 'canceled', NULL, NULL, NULL, false, 'evt_third_canceled',
        now() + INTERVAL '4 minutes'
    ),
    false,
    'an untracked cancellation cannot revoke a past_due (entitled) row'
);

SELECT is(
    (
        SELECT status FROM public.subscriptions
        WHERE user_id = '5b5b5b5b-0000-4000-8000-00000000005b'::uuid
    ),
    'past_due',
    'the past_due row keeps its access'
);

-- ---------------------------------------------------------------------------
-- The tracked subscription always writes its own row, and the pre-existing
-- ordering guard still holds.
-- ---------------------------------------------------------------------------
SELECT is(
    public.apply_subscription_event(
        '5b5b5b5b-0000-4000-8000-00000000005b'::uuid, 'ctm_01', 'sub_other',
        'FREE', 'canceled', NULL, NULL, NULL, false, 'evt_other_canceled',
        now() + INTERVAL '5 minutes'
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
        'evt_first', now() + INTERVAL '6 minutes'
    ),
    true,
    'the first event for a user is applied'
);

-- ---------------------------------------------------------------------------
-- One Paddle subscription backs at most one portal user (security R-1).
-- ---------------------------------------------------------------------------
SELECT has_index(
    'public', 'subscriptions', 'subscriptions_paddle_subscription_id_key',
    'subscriptions has a unique paddle_subscription_id index'
);

INSERT INTO auth.users (id, email)
VALUES ('6c6c6c6c-0000-4000-8000-00000000006c'::uuid, 'sub-guard-2@example.test')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

DELETE FROM public.subscriptions
WHERE user_id = '6c6c6c6c-0000-4000-8000-00000000006c'::uuid;

-- The attack the index backstops: binding a subscription another user
-- already holds. 'sub_first' belongs to the user above.
SELECT throws_ok(
    $$
      INSERT INTO public.subscriptions (user_id, paddle_subscription_id, tier, status)
      VALUES ('6c6c6c6c-0000-4000-8000-00000000006c'::uuid, 'sub_first', 'FLAME', 'active')
    $$,
    '23505',
    NULL,
    'a second user cannot be bound to an already-bound Paddle subscription'
);

-- NULL ids are exempt: users who never subscribed all share "no subscription".
SELECT lives_ok(
    $$
      INSERT INTO public.subscriptions (user_id, paddle_subscription_id, tier, status)
      VALUES ('6c6c6c6c-0000-4000-8000-00000000006c'::uuid, NULL, 'FREE', 'none')
    $$,
    'the unique index is partial, so multiple NULL subscription ids coexist'
);

SELECT * FROM finish();
ROLLBACK;
