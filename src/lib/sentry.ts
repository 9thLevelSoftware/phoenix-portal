import * as Sentry from "@sentry/react";

export function initSentry() {
	if (!import.meta.env.VITE_SENTRY_DSN) {
		console.warn("[Sentry] No DSN configured — error tracking disabled");
		return;
	}

	Sentry.init({
		dsn: import.meta.env.VITE_SENTRY_DSN,
		integrations: [Sentry.browserTracingIntegration()],
		tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
		environment: import.meta.env.MODE,
		enabled: import.meta.env.PROD,
	});
}

/**
 * React 19 error hook handler for createRoot.
 * Wire these into createRoot options:
 *   onUncaughtError, onCaughtError, onRecoverableError
 */
export const sentryErrorHandler = Sentry.reactErrorHandler();
