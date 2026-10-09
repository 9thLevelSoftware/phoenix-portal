import { afterEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke } } }));
afterEach(() => {
	vi.unstubAllEnvs();
	delete window.Paddle;
	vi.resetModules();
	invoke.mockReset();
});

it("opens only the server-created transaction and requests its price", async () => {
	vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_client");
	const open = vi.fn();
	window.Paddle = {
		Initialize: vi.fn(),
		Environment: { set: vi.fn() },
		Checkout: { open },
	};
	invoke.mockResolvedValue({
		data: {
			transaction_id: "txn_reserved",
			custom_data: { user_id: "user", cd_sig: "bound" },
		},
		error: null,
	});
	const { openCheckout } = await import("../paddle-client");
	await openCheckout({
		priceId: "pri_plan",
		userId: "user",
		userEmail: "user@example.test",
	});
	expect(invoke).toHaveBeenCalledWith("paddle-checkout-custom-data", {
		method: "POST",
		body: { price_id: "pri_plan" },
	});
	expect(open).toHaveBeenCalledWith({
		transactionId: "txn_reserved",
		customer: { email: "user@example.test" },
		settings: { theme: "dark", displayMode: "overlay" },
	});
});

it("refuses the old custom-data-only response without opening an item checkout", async () => {
	vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_client");
	const open = vi.fn();
	window.Paddle = {
		Initialize: vi.fn(),
		Environment: { set: vi.fn() },
		Checkout: { open },
	};
	invoke.mockResolvedValue({
		data: { custom_data: { user_id: "user", cd_sig: "timeless" } },
		error: null,
	});
	const { openCheckout } = await import("../paddle-client");
	await expect(
		openCheckout({
			priceId: "pri_plan",
			userId: "user",
			userEmail: "user@example.test",
		}),
	).rejects.toThrow();
	expect(open).not.toHaveBeenCalled();
});
