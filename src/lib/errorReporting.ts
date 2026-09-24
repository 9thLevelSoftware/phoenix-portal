/**
 * The one path from React's root error hooks to Sentry.
 *
 * Sentry is only fetched after cookie consent, which can be given at boot or
 * mid-session. Both routes go through enableErrorReporting(), so the React 19
 * root callbacks (onCaughtError / onUncaughtError / onRecoverableError) start
 * forwarding to Sentry as soon as it loads, not only after the next reload.
 * Until then errors are logged to the console: supplying those callbacks
 * replaces React's own logging, so a no-op would swallow them.
 */

type ReactErrorHandler = (error: unknown, errorInfo: unknown) => void;
type SentryModule = typeof import("./sentry");

let sentryModule: SentryModule | null = null;
let loading: Promise<void> | null = null;

/** Load and initialise Sentry once; later calls share the first load. */
export function enableErrorReporting(
	load: () => Promise<SentryModule> = () => import("./sentry"),
): Promise<void> {
	loading ??= load()
		.then((module) => {
			module.initSentry();
			sentryModule = module;
		})
		.catch((error: unknown) => {
			// Chunk failed to load (offline, deploy skew): allow a later retry.
			loading = null;
			console.warn("[error reporting] Sentry could not be loaded", error);
		});
	return loading;
}

/** Passed to createRoot's error callbacks. */
export const forwardReactError: ReactErrorHandler = (error, errorInfo) => {
	if (sentryModule) {
		sentryModule.sentryErrorHandler(error, errorInfo as never);
	} else {
		console.error(error);
	}
};

/** The id of the last event sent to Sentry, when Sentry is running. */
export function lastReportedErrorId(): string | undefined {
	return sentryModule?.lastSentryEventId();
}

/** Test seam: forget the loaded module. */
export function resetErrorReportingForTests(): void {
	sentryModule = null;
	loading = null;
}
