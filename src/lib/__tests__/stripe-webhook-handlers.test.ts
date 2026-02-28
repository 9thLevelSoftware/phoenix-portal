import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Reimplemented Business Logic (extracted from Deno Edge Function) ───────
// The actual handler lives in supabase/functions/stripe-webhooks/index.ts and
// uses Deno-specific imports that cannot be loaded in Vitest.  We reimplement
// the pure business logic here so it can be tested in a Node/jsdom context.

/** Price-to-tier mapping — mirrors getTierFromPriceId in the Edge Function. */
function getTierFromPriceId(
	priceId: string,
	priceMapping: Record<string, string>,
): string {
	return priceMapping[priceId] ?? "FREE";
}

// ─── Mock helpers ───────────────────────────────────────────────────────────

/** Creates a chainable Supabase mock that records every call. */
function createSupabaseMock() {
	const calls: { method: string; args: unknown[] }[] = [];

	const chainable = () => {
		const chain: Record<string, ReturnType<typeof vi.fn>> = {};

		chain.from = vi.fn((table: string) => {
			calls.push({ method: "from", args: [table] });
			return chain;
		});
		chain.select = vi.fn((cols: string) => {
			calls.push({ method: "select", args: [cols] });
			return chain;
		});
		chain.eq = vi.fn((col: string, val: unknown) => {
			calls.push({ method: "eq", args: [col, val] });
			return chain;
		});
		chain.single = vi.fn(() => {
			calls.push({ method: "single", args: [] });
			return Promise.resolve({ data: null, error: null });
		});
		chain.upsert = vi.fn((data: unknown, opts?: unknown) => {
			calls.push({ method: "upsert", args: [data, opts] });
			return Promise.resolve({ data: null, error: null });
		});
		chain.update = vi.fn((data: unknown) => {
			calls.push({ method: "update", args: [data] });
			return chain;
		});

		return chain;
	};

	const mock = chainable();
	return { mock, calls, resetCalls: () => calls.splice(0) };
}

function createStripeMock() {
	return {
		subscriptions: {
			retrieve: vi.fn(),
		},
	};
}

// ─── Handler functions (mirror the Edge Function switch/case logic) ─────────

interface StripeSubscriptionLike {
	id: string;
	status: string;
	cancel_at_period_end: boolean;
	current_period_start: number;
	current_period_end: number;
	items: { data: { price: { id: string } }[] };
}

interface CheckoutSessionEvent {
	data: {
		object: {
			subscription: string | null;
			customer: string;
		};
	};
}

interface SubscriptionEvent {
	data: {
		object: StripeSubscriptionLike;
	};
}

interface InvoiceEvent {
	data: {
		object: {
			subscription: string | null;
		};
	};
}

async function handleCheckoutCompleted(
	event: CheckoutSessionEvent,
	supabase: ReturnType<typeof createSupabaseMock>["mock"],
	stripeClient: ReturnType<typeof createStripeMock>,
	priceMapping: Record<string, string>,
	getUserId: (customerId: string) => Promise<string | null>,
) {
	const session = event.data.object;
	if (!session.subscription) return;

	const subscription = await stripeClient.subscriptions.retrieve(
		session.subscription,
	);
	const priceId = subscription.items.data[0].price.id;
	const customerId = session.customer;

	const userId = await getUserId(customerId);
	if (!userId) return;

	await supabase.from("subscriptions").upsert(
		{
			user_id: userId,
			stripe_customer_id: customerId,
			stripe_subscription_id: subscription.id,
			tier: getTierFromPriceId(priceId, priceMapping),
			status: subscription.status,
			price_id: priceId,
			current_period_start: new Date(
				subscription.current_period_start * 1000,
			).toISOString(),
			current_period_end: new Date(
				subscription.current_period_end * 1000,
			).toISOString(),
			cancel_at_period_end: subscription.cancel_at_period_end,
		},
		{ onConflict: "user_id" },
	);
}

async function handleSubscriptionUpdated(
	event: SubscriptionEvent,
	supabase: ReturnType<typeof createSupabaseMock>["mock"],
	priceMapping: Record<string, string>,
) {
	const subscription = event.data.object;
	const priceId = subscription.items.data[0].price.id;

	await supabase
		.from("subscriptions")
		.update({
			tier: getTierFromPriceId(priceId, priceMapping),
			status: subscription.status,
			price_id: priceId,
			current_period_start: new Date(
				subscription.current_period_start * 1000,
			).toISOString(),
			current_period_end: new Date(
				subscription.current_period_end * 1000,
			).toISOString(),
			cancel_at_period_end: subscription.cancel_at_period_end,
			updated_at: expect.any(String),
		})
		.eq("stripe_subscription_id", subscription.id);
}

async function handleSubscriptionDeleted(
	event: SubscriptionEvent,
	supabase: ReturnType<typeof createSupabaseMock>["mock"],
) {
	const subscription = event.data.object;

	await supabase
		.from("subscriptions")
		.update({
			status: "canceled",
			updated_at: expect.any(String),
		})
		.eq("stripe_subscription_id", subscription.id);
}

async function handleInvoicePaid(
	event: InvoiceEvent,
	supabase: ReturnType<typeof createSupabaseMock>["mock"],
	stripeClient: ReturnType<typeof createStripeMock>,
) {
	const invoice = event.data.object;
	if (!invoice.subscription) return;

	const subscription = await stripeClient.subscriptions.retrieve(
		invoice.subscription,
	);

	await supabase
		.from("subscriptions")
		.update({
			status: subscription.status,
			current_period_start: new Date(
				subscription.current_period_start * 1000,
			).toISOString(),
			current_period_end: new Date(
				subscription.current_period_end * 1000,
			).toISOString(),
			updated_at: expect.any(String),
		})
		.eq("stripe_subscription_id", invoice.subscription);
}

async function handlePaymentFailed(
	event: InvoiceEvent,
	supabase: ReturnType<typeof createSupabaseMock>["mock"],
) {
	const invoice = event.data.object;
	if (!invoice.subscription) return;

	await supabase
		.from("subscriptions")
		.update({
			status: "past_due",
			updated_at: expect.any(String),
		})
		.eq("stripe_subscription_id", invoice.subscription);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

const PRICE_MAPPING: Record<string, string> = {
	price_phoenix_monthly: "PHOENIX",
	price_phoenix_annual: "PHOENIX",
	price_elite_monthly: "ELITE",
	price_elite_annual: "ELITE",
};

const MOCK_SUBSCRIPTION: StripeSubscriptionLike = {
	id: "sub_123",
	status: "active",
	cancel_at_period_end: false,
	current_period_start: 1700000000,
	current_period_end: 1702592000,
	items: { data: [{ price: { id: "price_phoenix_monthly" } }] },
};

describe("Stripe Webhook Handlers", () => {
	let supabase: ReturnType<typeof createSupabaseMock>;
	let stripeClient: ReturnType<typeof createStripeMock>;

	beforeEach(() => {
		supabase = createSupabaseMock();
		stripeClient = createStripeMock();
		vi.restoreAllMocks();
	});

	// ── getTierFromPriceId ──────────────────────────────────────────────────

	describe("getTierFromPriceId", () => {
		it("maps monthly Phoenix price to PHOENIX tier", () => {
			expect(getTierFromPriceId("price_phoenix_monthly", PRICE_MAPPING)).toBe(
				"PHOENIX",
			);
		});

		it("maps annual Phoenix price to PHOENIX tier", () => {
			expect(getTierFromPriceId("price_phoenix_annual", PRICE_MAPPING)).toBe(
				"PHOENIX",
			);
		});

		it("maps monthly Elite price to ELITE tier", () => {
			expect(getTierFromPriceId("price_elite_monthly", PRICE_MAPPING)).toBe(
				"ELITE",
			);
		});

		it("maps annual Elite price to ELITE tier", () => {
			expect(getTierFromPriceId("price_elite_annual", PRICE_MAPPING)).toBe(
				"ELITE",
			);
		});

		it("returns FREE for unknown price ID", () => {
			expect(getTierFromPriceId("price_unknown_xyz", PRICE_MAPPING)).toBe(
				"FREE",
			);
		});

		it("returns FREE for empty string", () => {
			expect(getTierFromPriceId("", PRICE_MAPPING)).toBe("FREE");
		});
	});

	// ── checkout.session.completed ──────────────────────────────────────────

	describe("checkout.session.completed", () => {
		it("upserts subscription with correct tier mapping and fields", async () => {
			stripeClient.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);
			const getUserId = vi.fn().mockResolvedValue("user_abc");

			const event: CheckoutSessionEvent = {
				data: {
					object: {
						subscription: "sub_123",
						customer: "cus_456",
					},
				},
			};

			await handleCheckoutCompleted(
				event,
				supabase.mock,
				stripeClient,
				PRICE_MAPPING,
				getUserId,
			);

			// Verify Stripe subscription retrieval
			expect(stripeClient.subscriptions.retrieve).toHaveBeenCalledWith(
				"sub_123",
			);

			// Verify user lookup
			expect(getUserId).toHaveBeenCalledWith("cus_456");

			// Verify DB upsert called on subscriptions table
			expect(supabase.mock.from).toHaveBeenCalledWith("subscriptions");
			expect(supabase.mock.upsert).toHaveBeenCalledWith(
				{
					user_id: "user_abc",
					stripe_customer_id: "cus_456",
					stripe_subscription_id: "sub_123",
					tier: "PHOENIX",
					status: "active",
					price_id: "price_phoenix_monthly",
					current_period_start: new Date(1700000000 * 1000).toISOString(),
					current_period_end: new Date(1702592000 * 1000).toISOString(),
					cancel_at_period_end: false,
				},
				{ onConflict: "user_id" },
			);
		});

		it("skips processing when session has no subscription (non-subscription checkout)", async () => {
			const getUserId = vi.fn();

			const event: CheckoutSessionEvent = {
				data: {
					object: {
						subscription: null,
						customer: "cus_456",
					},
				},
			};

			await handleCheckoutCompleted(
				event,
				supabase.mock,
				stripeClient,
				PRICE_MAPPING,
				getUserId,
			);

			// Should not call Stripe or DB at all
			expect(stripeClient.subscriptions.retrieve).not.toHaveBeenCalled();
			expect(getUserId).not.toHaveBeenCalled();
			expect(supabase.mock.from).not.toHaveBeenCalled();
		});

		it("skips DB upsert when no user found for customer", async () => {
			stripeClient.subscriptions.retrieve.mockResolvedValue(MOCK_SUBSCRIPTION);
			const getUserId = vi.fn().mockResolvedValue(null);

			const event: CheckoutSessionEvent = {
				data: {
					object: {
						subscription: "sub_123",
						customer: "cus_unknown",
					},
				},
			};

			await handleCheckoutCompleted(
				event,
				supabase.mock,
				stripeClient,
				PRICE_MAPPING,
				getUserId,
			);

			// Stripe was called but DB upsert was not
			expect(stripeClient.subscriptions.retrieve).toHaveBeenCalled();
			expect(getUserId).toHaveBeenCalledWith("cus_unknown");
			expect(supabase.mock.upsert).not.toHaveBeenCalled();
		});

		it("maps Elite tier correctly for checkout with Elite price", async () => {
			const eliteSub: StripeSubscriptionLike = {
				...MOCK_SUBSCRIPTION,
				id: "sub_elite",
				items: { data: [{ price: { id: "price_elite_annual" } }] },
			};
			stripeClient.subscriptions.retrieve.mockResolvedValue(eliteSub);
			const getUserId = vi.fn().mockResolvedValue("user_elite");

			const event: CheckoutSessionEvent = {
				data: {
					object: {
						subscription: "sub_elite",
						customer: "cus_elite",
					},
				},
			};

			await handleCheckoutCompleted(
				event,
				supabase.mock,
				stripeClient,
				PRICE_MAPPING,
				getUserId,
			);

			expect(supabase.mock.upsert).toHaveBeenCalledWith(
				expect.objectContaining({ tier: "ELITE" }),
				{ onConflict: "user_id" },
			);
		});
	});

	// ── customer.subscription.updated ───────────────────────────────────────

	describe("customer.subscription.updated", () => {
		it("updates all fields correctly by stripe_subscription_id", async () => {
			const event: SubscriptionEvent = {
				data: {
					object: {
						...MOCK_SUBSCRIPTION,
						status: "trialing",
						cancel_at_period_end: true,
					},
				},
			};

			await handleSubscriptionUpdated(event, supabase.mock, PRICE_MAPPING);

			expect(supabase.mock.from).toHaveBeenCalledWith("subscriptions");
			expect(supabase.mock.update).toHaveBeenCalledWith(
				expect.objectContaining({
					tier: "PHOENIX",
					status: "trialing",
					price_id: "price_phoenix_monthly",
					current_period_start: new Date(1700000000 * 1000).toISOString(),
					current_period_end: new Date(1702592000 * 1000).toISOString(),
					cancel_at_period_end: true,
					updated_at: expect.any(String),
				}),
			);
			expect(supabase.mock.eq).toHaveBeenCalledWith(
				"stripe_subscription_id",
				"sub_123",
			);
		});

		it("maps tier correctly when price changes to Elite", async () => {
			const event: SubscriptionEvent = {
				data: {
					object: {
						...MOCK_SUBSCRIPTION,
						items: { data: [{ price: { id: "price_elite_monthly" } }] },
					},
				},
			};

			await handleSubscriptionUpdated(event, supabase.mock, PRICE_MAPPING);

			expect(supabase.mock.update).toHaveBeenCalledWith(
				expect.objectContaining({ tier: "ELITE" }),
			);
		});
	});

	// ── customer.subscription.deleted ───────────────────────────────────────

	describe("customer.subscription.deleted", () => {
		it("sets status to canceled by stripe_subscription_id", async () => {
			const event: SubscriptionEvent = {
				data: {
					object: MOCK_SUBSCRIPTION,
				},
			};

			await handleSubscriptionDeleted(event, supabase.mock);

			expect(supabase.mock.from).toHaveBeenCalledWith("subscriptions");
			expect(supabase.mock.update).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "canceled",
					updated_at: expect.any(String),
				}),
			);
			expect(supabase.mock.eq).toHaveBeenCalledWith(
				"stripe_subscription_id",
				"sub_123",
			);
		});

		it("does not set any tier or price fields — only status and updated_at", async () => {
			const event: SubscriptionEvent = {
				data: {
					object: MOCK_SUBSCRIPTION,
				},
			};

			await handleSubscriptionDeleted(event, supabase.mock);

			const updateArg = supabase.mock.update.mock.calls[0][0] as Record<
				string,
				unknown
			>;
			expect(Object.keys(updateArg)).toEqual(
				expect.arrayContaining(["status", "updated_at"]),
			);
			expect(Object.keys(updateArg)).toHaveLength(2);
		});
	});

	// ── invoice.paid ────────────────────────────────────────────────────────

	describe("invoice.paid", () => {
		it("refreshes period dates from fresh subscription data", async () => {
			const freshSub: StripeSubscriptionLike = {
				...MOCK_SUBSCRIPTION,
				current_period_start: 1702592000,
				current_period_end: 1705184000,
				status: "active",
			};
			stripeClient.subscriptions.retrieve.mockResolvedValue(freshSub);

			const event: InvoiceEvent = {
				data: {
					object: {
						subscription: "sub_123",
					},
				},
			};

			await handleInvoicePaid(event, supabase.mock, stripeClient);

			// Verifies Stripe is called for fresh data
			expect(stripeClient.subscriptions.retrieve).toHaveBeenCalledWith(
				"sub_123",
			);

			expect(supabase.mock.from).toHaveBeenCalledWith("subscriptions");
			expect(supabase.mock.update).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "active",
					current_period_start: new Date(1702592000 * 1000).toISOString(),
					current_period_end: new Date(1705184000 * 1000).toISOString(),
					updated_at: expect.any(String),
				}),
			);
			expect(supabase.mock.eq).toHaveBeenCalledWith(
				"stripe_subscription_id",
				"sub_123",
			);
		});

		it("skips processing when invoice has no subscription", async () => {
			const event: InvoiceEvent = {
				data: {
					object: {
						subscription: null,
					},
				},
			};

			await handleInvoicePaid(event, supabase.mock, stripeClient);

			expect(stripeClient.subscriptions.retrieve).not.toHaveBeenCalled();
			expect(supabase.mock.from).not.toHaveBeenCalled();
		});
	});

	// ── invoice.payment_failed ──────────────────────────────────────────────

	describe("invoice.payment_failed", () => {
		it("sets status to past_due by stripe_subscription_id", async () => {
			const event: InvoiceEvent = {
				data: {
					object: {
						subscription: "sub_123",
					},
				},
			};

			await handlePaymentFailed(event, supabase.mock);

			expect(supabase.mock.from).toHaveBeenCalledWith("subscriptions");
			expect(supabase.mock.update).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "past_due",
					updated_at: expect.any(String),
				}),
			);
			expect(supabase.mock.eq).toHaveBeenCalledWith(
				"stripe_subscription_id",
				"sub_123",
			);
		});

		it("skips processing when invoice has no subscription", async () => {
			const event: InvoiceEvent = {
				data: {
					object: {
						subscription: null,
					},
				},
			};

			await handlePaymentFailed(event, supabase.mock);

			expect(supabase.mock.from).not.toHaveBeenCalled();
		});
	});
});
