// Paddle.js v2 client integration for subscription billing.
// Paddle.js is loaded via <script> tag in index.html; this module
// provides typed helpers for initialization and checkout.

// ---------------------------------------------------------------------------
// Global type declarations for the Paddle.js SDK (v2)
// ---------------------------------------------------------------------------

interface PaddleCheckoutItem {
	priceId: string;
	quantity: number;
}

interface PaddleCheckoutCustomData {
	user_id: string;
}

interface PaddleCheckoutCustomer {
	email: string;
}

interface PaddleCheckoutSettings {
	theme: "light" | "dark";
	displayMode?: "inline" | "overlay";
	successUrl?: string;
}

interface PaddleCheckoutOpenConfig {
	items: PaddleCheckoutItem[];
	customData: PaddleCheckoutCustomData;
	customer: PaddleCheckoutCustomer;
	settings?: PaddleCheckoutSettings;
}

interface PaddleEventData {
	status?: string;
	transaction_id?: string;
	[key: string]: unknown;
}

export interface PaddleEvent {
	name: string;
	data?: PaddleEventData;
}

interface PaddleInitConfig {
	token: string;
	eventCallback?: (event: PaddleEvent) => void;
}

interface PaddleSDK {
	Initialize: (config: PaddleInitConfig) => void;
	Environment: {
		set: (env: "sandbox" | "production") => void;
	};
	Checkout: {
		open: (config: PaddleCheckoutOpenConfig) => void;
	};
}

declare global {
	interface Window {
		Paddle?: PaddleSDK;
	}
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false;

/**
 * Lazily initializes the Paddle SDK with the client-side token from env vars.
 * In development mode, Paddle is set to sandbox environment.
 * Safe to call multiple times -- subsequent calls are no-ops.
 */
export function initializePaddle(
	eventCallback?: (event: PaddleEvent) => void,
): void {
	if (initialized) return;

	const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;

	if (!token) {
		console.warn(
			"[Paddle] VITE_PADDLE_CLIENT_TOKEN is not set. Billing features will be unavailable.",
		);
		return;
	}

	if (!window.Paddle) {
		console.warn(
			"[Paddle] Paddle.js SDK not found on window. Ensure the script tag is in index.html.",
		);
		return;
	}

	// Use sandbox environment when explicitly configured
	const paddleEnv = import.meta.env.VITE_PADDLE_ENVIRONMENT as
		| string
		| undefined;
	if (paddleEnv === "sandbox") {
		window.Paddle.Environment.set("sandbox");
	}

	window.Paddle.Initialize({
		token,
		eventCallback,
	});

	initialized = true;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface OpenCheckoutOptions {
	priceId: string;
	userId: string;
	userEmail: string;
	onSuccess?: (event: PaddleEvent) => void;
	onClose?: () => void;
}

/**
 * Opens a Paddle checkout overlay for the given price.
 *
 * Automatically initializes the SDK if it hasn't been initialized yet.
 * Passes user_id as custom_data so webhook handlers can associate the
 * subscription with the correct Supabase user.
 */
export function openCheckout({
	priceId,
	userId,
	userEmail,
	onSuccess,
	onClose,
}: OpenCheckoutOptions): void {
	// Ensure SDK is initialized before opening checkout
	if (!initialized) {
		initializePaddle((event) => {
			if (event.name === "checkout.completed" && onSuccess) {
				onSuccess(event);
			}
			if (event.name === "checkout.closed" && onClose) {
				onClose();
			}
		});
	}

	if (!window.Paddle) {
		console.error(
			"[Paddle] Cannot open checkout: Paddle SDK is not available.",
		);
		return;
	}

	window.Paddle.Checkout.open({
		items: [{ priceId, quantity: 1 }],
		customData: { user_id: userId },
		customer: { email: userEmail },
		settings: {
			theme: "dark",
			displayMode: "overlay",
		},
	});
}
