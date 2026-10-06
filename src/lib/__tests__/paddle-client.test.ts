import { afterEach, describe, expect, it, vi } from "vitest";

const BILLING_CHECKOUT_UNAVAILABLE =
	"Billing checkout is unavailable. Please try again.";

/**
 * Simulate a Paddle.js script tag that finishes loading without defining
 * `window.Paddle` — the CDN never delivers the SDK.
 */
function installScriptThatNeverDefinesPaddle() {
	vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
		if (node instanceof HTMLScriptElement) {
			node.onload?.(new Event("load"));
		}
		return node;
	});
}

async function loadPaddleClient() {
	vi.resetModules();
	vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_token");
	window.Paddle = undefined;
	installScriptThatNeverDefinesPaddle();
	return import("@/lib/paddle-client");
}

describe("openCheckout when Paddle.js never loads", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		window.Paddle = undefined;
	});

	it("throws the same error as openUpdatePaymentMethodCheckout", async () => {
		const checkout = await loadPaddleClient();
		await expect(
			checkout.openCheckout({
				priceId: "pri_test",
				userId: "user-1",
				userEmail: "user@example.com",
			}),
		).rejects.toThrow(BILLING_CHECKOUT_UNAVAILABLE);

		const update = await loadPaddleClient();
		await expect(
			update.openUpdatePaymentMethodCheckout({
				transactionId: "txn_update_card",
			}),
		).rejects.toThrow(BILLING_CHECKOUT_UNAVAILABLE);
	});
});
