// Paddle.js v2 client integration for subscription billing.
// The script is loaded dynamically at checkout time (not on every page visit)
// to comply with GDPR ePrivacy requirements — no third-party scripts are
// loaded until the user explicitly initiates a billing action.

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
// Dynamic script loading
// ---------------------------------------------------------------------------

const PADDLE_SCRIPT_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";

let scriptLoadPromise: Promise<void> | null = null;

/**
 * Dynamically injects the Paddle.js v2 script tag and waits for it to load.
 * Idempotent: the script is only injected once; subsequent calls return the
 * same resolved promise. If the script is already present on the page (e.g.
 * from a previous load), resolves immediately.
 */
function loadPaddleScript(): Promise<void> {
	// Already loaded (e.g. from a prior call or a pre-existing tag)
	if (window.Paddle) return Promise.resolve();

	// Loading in progress from a prior call — deduplicate
	if (scriptLoadPromise) return scriptLoadPromise;

	scriptLoadPromise = new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = PADDLE_SCRIPT_URL;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () =>
			reject(new Error("[Paddle] Failed to load Paddle.js from CDN."));
		document.head.appendChild(script);
	});

	return scriptLoadPromise;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false;

/**
 * Dynamically loads Paddle.js (if not yet present) and initializes the SDK
 * with the client-side token from env vars. In development mode, Paddle is
 * set to sandbox environment.
 * Safe to call multiple times -- subsequent calls are no-ops.
 */
export async function initializePaddle(
	eventCallback?: (event: PaddleEvent) => void,
): Promise<void> {
	if (initialized) return;

	const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;

	if (!token) {
		console.warn(
			"[Paddle] VITE_PADDLE_CLIENT_TOKEN is not set. Billing features will be unavailable.",
		);
		return;
	}

	// Load the Paddle.js script dynamically
	await loadPaddleScript();

	if (!window.Paddle) {
		console.warn(
			"[Paddle] Paddle.js SDK not available after script load.",
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
 * Automatically loads and initializes the SDK if it hasn't been already.
 * Passes user_id as custom_data so webhook handlers can associate the
 * subscription with the correct Supabase user.
 */
export async function openCheckout({
	priceId,
	userId,
	userEmail,
	onSuccess,
	onClose,
}: OpenCheckoutOptions): Promise<void> {
	// Ensure SDK is loaded and initialized before opening checkout
	if (!initialized) {
		await initializePaddle((event) => {
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
