import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  billingAction,
  type BillingActionName,
  classifySubscriptionEventTarget,
  ENTITLEMENT_KEEPING_STATUSES,
  mayOpenNewCheckout,
  PADDLE_LIVE_STATUS_FILTER,
} from './billingAction.ts';

// The shared entitlement fixture (PR 8). Every state the portal recognises is
// driven through billingAction here, so the routing predicate cannot drift
// from the entitlement predicate it is built on.
interface EntitlementCase {
  id: string;
  status: string;
  tier: string;
  periodEndOffsetSeconds: number | null;
  cancelAtPeriodEnd?: boolean;
  expectedTier: string;
}

const fixtureUrl = new URL(
  '../../../tests/fixtures/entitlement-cases.json',
  import.meta.url,
);
const fixture = JSON.parse(await Deno.readTextFile(fixtureUrl)) as {
  cases: EntitlementCase[];
};

const NOW = new Date('2026-05-17T12:00:00Z');
const SUBSCRIPTION_ID = 'sub_01';

function rowFor(testCase: EntitlementCase, paddleSubscriptionId: string | null) {
  return {
    paddle_subscription_id: paddleSubscriptionId,
    tier: testCase.tier,
    status: testCase.status,
    current_period_end: testCase.periodEndOffsetSeconds === null
      ? null
      : new Date(NOW.getTime() + testCase.periodEndOffsetSeconds * 1000).toISOString(),
    cancel_at_period_end: Boolean(testCase.cancelAtPeriodEnd),
  };
}

Deno.test('billingAction: every fixture state maps to exactly one action', () => {
  const allowed: BillingActionName[] = ['manage', 'refresh', 'checkout'];

  for (const testCase of fixture.cases) {
    const withSubscription = billingAction(rowFor(testCase, SUBSCRIPTION_ID), NOW);
    assert(
      allowed.includes(withSubscription.action),
      `${testCase.id}: unexpected action ${withSubscription.action}`,
    );

    // `manage` is exactly the entitled set, and entitlement is the shared
    // fixture's own verdict — tier included. A live-looking row whose tier
    // grants nothing must NOT be `manage`, or the user would have no access
    // and, via the 409 on signing, no way to buy any (general-2 R-5).
    assertEquals(
      withSubscription.action === 'manage',
      withSubscription.entitled,
      `${testCase.id}: manage must equal entitled`,
    );
    assertEquals(
      withSubscription.entitled,
      testCase.expectedTier !== 'FREE',
      `${testCase.id}: entitled must match the shared entitlement fixture`,
    );
    assertEquals(
      withSubscription.needsPaymentUpdate,
      testCase.status === 'past_due' && testCase.expectedTier !== 'FREE',
      `${testCase.id}: only an entitled past_due row asks for a new card`,
    );

    // Without a stored Paddle subscription id there is nothing to manage or
    // refresh, so every state is a checkout.
    assertEquals(
      billingAction(rowFor(testCase, null), NOW).action,
      'checkout',
      `${testCase.id}: no subscription id must be checkout`,
    );
  }
});

Deno.test('billingAction: no state both demands a checkout and is refused one', () => {
  for (const testCase of fixture.cases) {
    for (const subscriptionId of [SUBSCRIPTION_ID, null]) {
      const result = billingAction(rowFor(testCase, subscriptionId), NOW);

      // paddle-update-subscription answers `checkout_required` exactly when
      // the action is `checkout`; paddle-checkout-custom-data answers 409
      // `existing_subscription` exactly when it is not.
      const updateSaysCheckoutRequired = result.action === 'checkout';
      const signingRefusesWith409 = !mayOpenNewCheckout(result);

      assert(
        !(updateSaysCheckoutRequired && signingRefusesWith409),
        `${testCase.id} (${subscriptionId ?? 'no id'}): checkout_required AND 409`,
      );
      // ...and they are exact complements, so a user is never left with no
      // route at all either.
      assertEquals(
        updateSaysCheckoutRequired,
        !signingRefusesWith409,
        `${testCase.id} (${subscriptionId ?? 'no id'}): routes disagree`,
      );
    }
  }
});

Deno.test('billingAction: past_due keeps access and asks for a new card', () => {
  const result = billingAction(
    {
      paddle_subscription_id: SUBSCRIPTION_ID,
      tier: 'FLAME',
      status: 'past_due',
      // 10 days past the period end: Paddle is still retrying.
      current_period_end: '2026-05-07T12:00:00Z',
      cancel_at_period_end: false,
    },
    NOW,
  );

  assertEquals(result.action, 'manage');
  assertEquals(result.entitled, true);
  assertEquals(result.needsPaymentUpdate, true);
  assertEquals(result.reason, 'payment_past_due');
  assertEquals(mayOpenNewCheckout(result), false);
});

Deno.test('billingAction: active with the period ended refreshes, never checks out', () => {
  const result = billingAction(
    {
      paddle_subscription_id: SUBSCRIPTION_ID,
      tier: 'FLAME',
      status: 'active',
      // Past the 48h renewal grace: the renewal webhook is very late.
      current_period_end: '2026-05-01T00:00:00Z',
      cancel_at_period_end: false,
    },
    NOW,
  );

  assertEquals(result.action, 'refresh');
  assertEquals(result.entitled, false);
  assertEquals(result.paddleSubscriptionId, SUBSCRIPTION_ID);
  assertEquals(mayOpenNewCheckout(result), false);
});

Deno.test('billingAction: a canceled subscription is the only stored state that may check out', () => {
  for (const status of ['canceled', 'active', 'trialing', 'past_due', 'incomplete', 'none']) {
    const result = billingAction(
      {
        paddle_subscription_id: SUBSCRIPTION_ID,
        tier: 'FLAME',
        status,
        current_period_end: '2026-06-01T00:00:00Z',
        cancel_at_period_end: false,
      },
      NOW,
    );
    assertEquals(
      result.action === 'checkout',
      status === 'canceled',
      `${status}: only canceled may open a new checkout`,
    );
  }
});

Deno.test('classifySubscriptionEventTarget: an untracked subscription cannot revoke access', () => {
  const trackedActive = {
    paddle_subscription_id: 'sub_new',
    status: 'active',
    current_period_end: '2026-06-01T00:00:00Z',
    cancel_at_period_end: false,
  };

  // The old subscription's cancellation must not touch the row.
  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_old',
      incomingStatus: 'canceled',
      storedRow: trackedActive,
      now: NOW,
    }),
    'ignore_untracked_subscription',
  );

  // Nor may a second live subscription steal an entitled row.
  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_other',
      incomingStatus: 'active',
      storedRow: trackedActive,
      now: NOW,
    }),
    'ignore_untracked_subscription',
  );

  // The tracked subscription always writes its own row.
  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_new',
      incomingStatus: 'canceled',
      storedRow: trackedActive,
      now: NOW,
    }),
    'apply',
  );
});

Deno.test('classifySubscriptionEventTarget: a resubscribe is adopted when the stored row is dead', () => {
  for (const storedStatus of ['canceled', 'incomplete', 'none']) {
    assertEquals(
      classifySubscriptionEventTarget({
        incomingSubscriptionId: 'sub_new',
        incomingStatus: 'active',
        storedRow: {
          paddle_subscription_id: 'sub_old',
          status: storedStatus,
          current_period_end: '2026-06-01T00:00:00Z',
          cancel_at_period_end: false,
        },
        now: NOW,
      }),
      'apply',
      `${storedStatus}: a live subscription must be adopted`,
    );
  }

  // past_due stays entitled, so an untracked subscription may not replace it.
  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_new',
      incomingStatus: 'active',
      storedRow: {
        paddle_subscription_id: 'sub_old',
        status: 'past_due',
        current_period_end: '2026-04-01T00:00:00Z',
        cancel_at_period_end: false,
      },
      now: NOW,
    }),
    'ignore_untracked_subscription',
  );
});

Deno.test('classifySubscriptionEventTarget: a scheduled cancellation is not entitled to the renewal grace', () => {
  // Pins the pass-through at billingAction.ts:236
  // (`cancelAtPeriodEnd: Boolean(input.storedRow?.cancel_at_period_end)`).
  // The predicate itself is pinned by the entitlement fixture; what was
  // unpinned is that the classifier hands the column over at all — every
  // other row here left it `false`, so dropping the pass-through changed no
  // outcome.
  //
  // The two stored rows differ only in `cancel_at_period_end`. One hour past
  // the period end is inside the 48h renewal grace for a row that will renew
  // (still entitled → the untracked subscription may not replace it) and
  // outside it for one scheduled to cancel (dead → adopt).
  const justEnded = '2026-05-17T11:00:00Z';

  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_new',
      incomingStatus: 'active',
      storedRow: {
        paddle_subscription_id: 'sub_old',
        status: 'active',
        current_period_end: justEnded,
        cancel_at_period_end: false,
      },
      now: NOW,
    }),
    'ignore_untracked_subscription',
    'renewing: inside the grace window, the stored row is still entitled',
  );

  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_new',
      incomingStatus: 'active',
      storedRow: {
        paddle_subscription_id: 'sub_old',
        status: 'active',
        current_period_end: justEnded,
        cancel_at_period_end: true,
      },
      now: NOW,
    }),
    'apply',
    'scheduled to cancel: no renewal grace, so the row is dead and adoptable',
  );
});

Deno.test('classifySubscriptionEventTarget: past_due keeps access, so it is adoptable', () => {
  // The R-34 handler tests never reach this branch (they short-circuit on a
  // matching subscription id), so without this the classifier could silently
  // drop past_due from its allowed set and strand a paying user on FREE —
  // exactly the bug the past_due round fixed.
  const deadStoredRow = {
    paddle_subscription_id: 'sub_old',
    tier: 'EMBER',
    status: 'canceled',
    current_period_end: '2026-06-01T00:00:00Z',
    cancel_at_period_end: false,
  };

  for (const incomingStatus of [...ENTITLEMENT_KEEPING_STATUSES]) {
    assertEquals(
      classifySubscriptionEventTarget({
        incomingSubscriptionId: 'sub_new',
        incomingStatus,
        storedRow: deadStoredRow,
        now: NOW,
      }),
      'apply',
      `${incomingStatus}: an entitlement-keeping sibling must be adoptable`,
    );
  }
  // Named explicitly so removing 'past_due' from the set fails here even if
  // the set itself is what regressed.
  assertEquals(ENTITLEMENT_KEEPING_STATUSES.has('past_due'), true);
  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_new',
      incomingStatus: 'past_due',
      storedRow: deadStoredRow,
      now: NOW,
    }),
    'apply',
  );

  // ...while a state that would NOT keep access is still refused.
  for (const incomingStatus of ['canceled', 'incomplete', 'none']) {
    assertEquals(
      classifySubscriptionEventTarget({
        incomingSubscriptionId: 'sub_new',
        incomingStatus,
        storedRow: deadStoredRow,
        now: NOW,
      }),
      'ignore_untracked_subscription',
      `${incomingStatus}: must never be adopted from an untracked subscription`,
    );
  }
});

Deno.test('billingAction: the Paddle status filter is derived from the adoptable set', () => {
  // One source of truth: a listing that asks Paddle for a status the
  // adoption path would refuse (or vice versa) is what made a past-due
  // sibling un-adoptable.
  assertEquals(
    PADDLE_LIVE_STATUS_FILTER.split(',').sort(),
    [...ENTITLEMENT_KEEPING_STATUSES].sort(),
  );
  assertEquals(PADDLE_LIVE_STATUS_FILTER.includes('past_due'), true);
});

Deno.test('classifySubscriptionEventTarget: a first event with no stored id is applied', () => {
  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_new',
      incomingStatus: 'active',
      storedRow: null,
      now: NOW,
    }),
    'apply',
  );
  assertEquals(
    classifySubscriptionEventTarget({
      incomingSubscriptionId: 'sub_new',
      incomingStatus: 'canceled',
      storedRow: { paddle_subscription_id: null, status: 'none' },
      now: NOW,
    }),
    'apply',
  );
});
