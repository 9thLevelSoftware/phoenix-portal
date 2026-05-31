import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
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
} | null = null;

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
						Promise.resolve({ data: mockSubscriptionRow, error: null }),
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

	it("downgrades effective tier to FREE when status is 'past_due'", async () => {
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

		expect(result.current.tier).toBe("FREE");
		expect(result.current.isPremium).toBe(false);
		expect(result.current.rawTier).toBe("EMBER");
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
});
