import {
	focusManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	boundaryTimerStep,
	type SubscriptionStatus,
	type SubscriptionTier,
	useSubscription,
} from "../useSubscription";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Holds the row that the fake Supabase client returns for `subscriptions`. */
let mockSubscriptionRow: {
	tier: SubscriptionTier;
	status: SubscriptionStatus;
	price_id: string | null;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
	updated_at?: string | null;
	paddle_subscription_id?: string | null;
} | null = null;
let mockSubscriptionError: { message: string } | null = null;

const mockChannel = {
	on: vi.fn(() => mockChannel),
	subscribe: vi.fn(() => mockChannel),
};

vi.mock("@/lib/supabase", () => ({
	supabase: {
		from: () => ({
			select: () => ({
				eq: () => ({
					maybeSingle: () =>
						Promise.resolve({
							data: mockSubscriptionError ? null : mockSubscriptionRow,
							error: mockSubscriptionError,
						}),
				}),
			}),
		}),
		channel: vi.fn(() => mockChannel),
		removeChannel: vi.fn(),
	},
}));

vi.mock("@/providers/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/queries/keys", () => ({
	queryKeys: {
		subscription: { byUser: (id: string) => ["subscription", id] },
	},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSubscription effective tier", () => {
	beforeEach(() => {
		mockSubscriptionError = null;
		mockSubscriptionRow = null;
	});

	it("returns the stored tier when status is 'active'", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "active",
			price_id: "pri_flame_monthly",
			current_period_end: "2999-04-01T00:00:00Z",
			cancel_at_period_end: false,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("FLAME");
		expect(result.current.rawTier).toBe("FLAME");
		expect(result.current.priceId).toBe("pri_flame_monthly");
		expect(result.current.isEntitled).toBe(true);
		expect(result.current.isPremium).toBe(true);
		expect(result.current.isFlame).toBe(true);
	});

	it("returns the stored tier when status is 'trialing'", async () => {
		mockSubscriptionRow = {
			tier: "INFERNO",
			status: "trialing",
			price_id: "pri_inferno_monthly",
			current_period_end: "2999-04-01T00:00:00Z",
			cancel_at_period_end: false,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("INFERNO");
		expect(result.current.rawTier).toBe("INFERNO");
		expect(result.current.isEntitled).toBe(true);
		expect(result.current.isPremium).toBe(true);
		expect(result.current.isInferno).toBe(true);
	});

	it("downgrades active subscriptions to FREE when the period end is past", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "active",
			price_id: "pri_flame_monthly",
			current_period_end: "2026-04-01T00:00:00Z",
			cancel_at_period_end: true,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("FREE");
		expect(result.current.rawTier).toBe("FLAME");
		expect(result.current.isEntitled).toBe(false);
		expect(result.current.isStale).toBe(true);
	});

	it("keeps scheduled cancellations entitled until the future period end", async () => {
		mockSubscriptionRow = {
			tier: "EMBER",
			status: "active",
			price_id: "pri_ember_monthly",
			current_period_end: "2999-04-01T00:00:00Z",
			cancel_at_period_end: true,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("EMBER");
		expect(result.current.isEntitled).toBe(true);
		expect(result.current.isStale).toBe(false);
	});

	it("downgrades effective tier to FREE when status is 'canceled'", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "canceled",
			price_id: "pri_flame_monthly",
			current_period_end: "2026-03-01",
			cancel_at_period_end: true,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		// Effective tier for access control is FREE
		expect(result.current.tier).toBe("FREE");
		expect(result.current.isPremium).toBe(false);
		expect(result.current.isFlame).toBe(false);

		// Raw tier preserves the database value for display
		expect(result.current.rawTier).toBe("FLAME");
	});

	it("keeps the paid tier while status is 'past_due' (Paddle retry window)", async () => {
		mockSubscriptionRow = {
			tier: "EMBER",
			status: "past_due",
			price_id: "pri_ember_monthly",
			current_period_end: "2026-03-15",
			cancel_at_period_end: false,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("EMBER");
		expect(result.current.isPremium).toBe(true);
		expect(result.current.rawTier).toBe("EMBER");
		// Period ended long ago: stale, so the portal asks Paddle for a refresh
		// (heals a lost cancel/pause webhook) while access keeps the past_due rule.
		expect(result.current.isStale).toBe(true);
	});

	it("is not stale for a recent past_due row with no period end", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "past_due",
			price_id: "pri_flame_monthly",
			current_period_end: null,
			cancel_at_period_end: false,
			updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("FLAME");
		expect(result.current.isStale).toBe(false);
	});

	it("is stale for a past_due row with no period end unchanged for over 3 days", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "past_due",
			price_id: "pri_flame_monthly",
			current_period_end: null,
			cancel_at_period_end: false,
			updated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("FLAME");
		expect(result.current.isStale).toBe(true);
	});

	it("gives a scheduled cancellation no renewal grace", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "active",
			price_id: "pri_flame_monthly",
			current_period_end: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
			cancel_at_period_end: true,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("FREE");
	});

	it("downgrades effective tier to FREE when status is 'incomplete'", async () => {
		mockSubscriptionRow = {
			tier: "INFERNO",
			status: "incomplete",
			price_id: "pri_inferno_monthly",
			current_period_end: null,
			cancel_at_period_end: false,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("FREE");
		expect(result.current.isPremium).toBe(false);
		expect(result.current.isInferno).toBe(false);
		expect(result.current.rawTier).toBe("INFERNO");
	});

	it("returns FREE tier when no subscription row exists", async () => {
		mockSubscriptionRow = null;

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.tier).toBe("FREE");
		expect(result.current.rawTier).toBe("FREE");
		expect(result.current.status).toBe("none");
		expect(result.current.isPremium).toBe(false);
	});

	it("reports isError without treating a failed fetch as an entitled FREE plan", async () => {
		mockSubscriptionRow = null;
		mockSubscriptionError = { message: "network down" };

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		expect(result.current.isError).toBe(true);
		expect(result.current.isEntitled).toBe(false);
		expect(result.current.isPremium).toBe(false);
		expect(result.current.isFlame).toBe(false);
		expect(result.current.isInferno).toBe(false);
		expect(result.current.tier).toBe("FREE");
	});

	it("subscribes without crashing when global crypto is unavailable", async () => {
		mockSubscriptionRow = null;
		mockSubscriptionError = null;
		mockChannel.subscribe.mockClear();
		vi.stubGlobal("crypto", undefined);

		try {
			const { result } = renderHook(() => useSubscription(), {
				wrapper: createWrapper(),
			});

			await waitFor(() => expect(result.current.isLoading).toBe(false));

			expect(mockChannel.subscribe).toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// ---------------------------------------------------------------------------
// Billing action derivation (tests review R-1)
//
// PricingPlans.test.tsx mocks this whole hook and feeds `billingAction` in as
// a literal, so nothing there exercises the derivation: replacing it with a
// hardcoded `"checkout"` left the entire vitest suite green while a past_due
// user's pricing page called openCheckout — the headline bug this PR exists
// to prevent. These drive the REAL hook against stored rows.
// ---------------------------------------------------------------------------

// NF-35: a period that runs out writes nothing, so no Realtime event arrives.
describe("useSubscription entitlement boundary", () => {
	beforeEach(() => {
		mockSubscriptionError = null;
		mockSubscriptionRow = null;
	});

	it("drops to FREE when a trial ends, with no refetch or Realtime event", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "trialing",
			price_id: "pri_flame_monthly",
			current_period_end: new Date(Date.now() + 1500).toISOString(),
			cancel_at_period_end: false,
		};

		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});

		await waitFor(() => expect(result.current.tier).toBe("FLAME"));
		await waitFor(() => expect(result.current.tier).toBe("FREE"), {
			timeout: 6000,
		});
		expect(result.current.isEntitled).toBe(false);
	}, 10_000);
});

describe("boundaryTimerStep", () => {
	const MAX = 2_147_483_647;
	it("never schedules a final delay past the setTimeout cap", () => {
		// Within the slack of the cap: re-arm, never a final timer over the cap.
		expect(boundaryTimerStep(MAX - 500)).toEqual({
			rearm: true,
			delay: MAX - 1000,
		});
		expect(boundaryTimerStep(MAX - 1000)).toEqual({ rearm: false, delay: MAX });
		expect(boundaryTimerStep(5000)).toEqual({ rearm: false, delay: 6000 });
		expect(boundaryTimerStep(-10)).toEqual({ rearm: false, delay: 1000 });
	});
});

// NF-35 review: returning from Paddle must refetch even while the row is fresh.
describe("useSubscription window focus", () => {
	beforeEach(() => {
		mockSubscriptionError = null;
		mockSubscriptionRow = null;
	});

	it("refetches a still-fresh subscription when the window regains focus", async () => {
		mockSubscriptionRow = {
			tier: "EMBER",
			status: "active",
			price_id: "pri_ember_monthly",
			current_period_end: "2999-04-01T00:00:00Z",
			cancel_at_period_end: false,
		};
		// Mirror the app's QueryProvider, which turns focus refetch off globally.
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false, refetchOnWindowFocus: false },
			},
		});
		const { result } = renderHook(() => useSubscription(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queryClient}>
					{children}
				</QueryClientProvider>
			),
		});
		await waitFor(() => expect(result.current.tier).toBe("EMBER"));

		// The upgrade landed while the user was on Paddle's page; the cached row
		// is well inside its 5-minute staleTime.
		mockSubscriptionRow = {
			...mockSubscriptionRow,
			tier: "INFERNO",
			price_id: "pri_inferno_monthly",
		};
		try {
			act(() => {
				focusManager.setFocused(false);
			});
			act(() => {
				focusManager.setFocused(true);
			});
			await waitFor(() => expect(result.current.tier).toBe("INFERNO"));
		} finally {
			focusManager.setFocused(undefined);
		}
	});
});

describe("useSubscription billing action", () => {
	beforeEach(() => {
		mockSubscriptionError = null;
		mockSubscriptionRow = null;
	});

	async function derive() {
		const { result } = renderHook(() => useSubscription(), {
			wrapper: createWrapper(),
		});
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		return result;
	}

	it("routes a past_due subscriber to manage, never to a checkout", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "past_due",
			price_id: "pri_flame_monthly",
			// 10 days past the period end: Paddle is still retrying.
			current_period_end: "2020-01-01T00:00:00Z",
			cancel_at_period_end: false,
			paddle_subscription_id: "sub_1",
		};

		const result = await derive();

		// Access is kept (binding user decision, R-33)...
		expect(result.current.isEntitled).toBe(true);
		expect(result.current.tier).toBe("FLAME");
		// ...and the CTA must not be a checkout: paddle-checkout-custom-data
		// would refuse to sign it with 409.
		expect(result.current.billingAction).toBe("manage");
		expect(result.current.needsPaymentUpdate).toBe(true);
	});

	it("routes an active subscription whose period ended to refresh, not checkout", async () => {
		mockSubscriptionRow = {
			tier: "FLAME",
			status: "active",
			price_id: "pri_flame_monthly",
			current_period_end: "2020-01-01T00:00:00Z",
			cancel_at_period_end: false,
			paddle_subscription_id: "sub_1",
		};

		const result = await derive();

		expect(result.current.billingAction).toBe("refresh");
		expect(result.current.needsPaymentUpdate).toBe(false);
		expect(result.current.isEntitled).toBe(false);
	});

	it("only allows a checkout with no subscription, or a canceled one", async () => {
		for (const [row, expected] of [
			[null, "checkout"],
			[
				{
					tier: "FLAME" as SubscriptionTier,
					status: "canceled" as SubscriptionStatus,
					price_id: "pri_flame_monthly",
					current_period_end: "2999-04-01T00:00:00Z",
					cancel_at_period_end: false,
					paddle_subscription_id: "sub_1",
				},
				"checkout",
			],
			[
				{
					tier: "FLAME" as SubscriptionTier,
					status: "active" as SubscriptionStatus,
					price_id: "pri_flame_monthly",
					current_period_end: "2999-04-01T00:00:00Z",
					cancel_at_period_end: false,
					paddle_subscription_id: "sub_1",
				},
				"manage",
			],
			[
				// A live subscription id whose tier grants nothing: no access,
				// but a checkout would be refused, so it must be a refresh.
				{
					tier: "FREE" as SubscriptionTier,
					status: "active" as SubscriptionStatus,
					price_id: null,
					current_period_end: "2999-04-01T00:00:00Z",
					cancel_at_period_end: false,
					paddle_subscription_id: "sub_1",
				},
				"refresh",
			],
			[
				// A paid row that Paddle never linked: nothing to manage.
				{
					tier: "FLAME" as SubscriptionTier,
					status: "active" as SubscriptionStatus,
					price_id: "pri_flame_monthly",
					current_period_end: "2999-04-01T00:00:00Z",
					cancel_at_period_end: false,
					paddle_subscription_id: null,
				},
				"checkout",
			],
		] as const) {
			mockSubscriptionRow = row;
			const result = await derive();
			expect(
				result.current.billingAction,
				`${row?.status ?? "no row"} / ${row?.tier ?? "-"} / ${
					row?.paddle_subscription_id ?? "no id"
				}`,
			).toBe(expected);
		}
	});

	it("never offers a checkout while billing status is unavailable", async () => {
		// An outage must not read as "no subscription, go buy one".
		mockSubscriptionError = { message: "network down" };

		const result = await derive();

		expect(result.current.isError).toBe(true);
		expect(result.current.billingAction).not.toBe("checkout");
	});
});
