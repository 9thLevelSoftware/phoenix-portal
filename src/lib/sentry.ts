import * as Sentry from "@sentry/react";

/**
 * Query parameters that can carry credentials: Supabase auth tokens
 * (implicit-flow / recovery links), OAuth authorization codes and the OAuth
 * `state` nonce. Matched case-insensitively.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
	"access_token",
	"refresh_token",
	"code",
	"token",
	"state",
]);

/**
 * Remove the fragment and any sensitive query parameters from a URL (absolute
 * or relative). Supabase implicit-flow links arrive as
 * `#access_token=…&refresh_token=…`, so the whole fragment is dropped.
 */
export function scrubUrl(url: string): string {
	const withoutFragment = url.split("#", 1)[0];
	const queryStart = withoutFragment.indexOf("?");
	if (queryStart === -1) return withoutFragment;

	const base = withoutFragment.slice(0, queryStart);
	const kept = withoutFragment
		.slice(queryStart + 1)
		.split("&")
		.filter((pair) => {
			if (pair === "") return false;
			const rawName = pair.split("=", 1)[0];
			let name = rawName;
			try {
				name = decodeURIComponent(rawName.replace(/\+/g, " "));
			} catch {
				// Malformed escape: fall back to the raw name.
			}
			return !isSensitiveParam(name);
		});

	return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

type QueryString = NonNullable<Sentry.Event["request"]>["query_string"];

function isSensitiveParam(name: string): boolean {
	return SENSITIVE_QUERY_PARAMS.has(name.toLowerCase());
}

function scrubQueryString(query: QueryString): QueryString {
	if (typeof query === "string") {
		return scrubUrl(`?${query}`).replace(/^\?/, "");
	}
	if (Array.isArray(query)) {
		return query.filter(([name]) => !isSensitiveParam(name));
	}
	if (query && typeof query === "object") {
		return Object.fromEntries(
			Object.entries(query).filter(([name]) => !isSensitiveParam(name)),
		);
	}
	return query;
}

function scrubBreadcrumbData(
	data: Sentry.Breadcrumb["data"],
): Sentry.Breadcrumb["data"] {
	if (!data) return data;
	const next = { ...data };
	for (const key of ["url", "from", "to"] as const) {
		if (typeof next[key] === "string") {
			next[key] = scrubUrl(next[key] as string);
		}
	}
	return next;
}

/** `beforeBreadcrumb` hook: scrub navigation / fetch / xhr URLs. */
export function scrubBreadcrumb(
	breadcrumb: Sentry.Breadcrumb,
): Sentry.Breadcrumb {
	return { ...breadcrumb, data: scrubBreadcrumbData(breadcrumb.data) };
}

/**
 * `beforeSend` / `beforeSendTransaction` hook: scrub the request URL, the
 * Referer header, the transaction name and any attached breadcrumbs.
 */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
	if (event.request) {
		const request = { ...event.request };
		if (typeof request.url === "string") request.url = scrubUrl(request.url);
		if (request.query_string !== undefined) {
			request.query_string = scrubQueryString(request.query_string);
		}
		if (request.headers) {
			const headers = { ...request.headers };
			for (const name of Object.keys(headers)) {
				if (name.toLowerCase() === "referer") {
					headers[name] = scrubUrl(headers[name]);
				}
			}
			request.headers = headers;
		}
		event.request = request;
	}
	if (typeof event.transaction === "string") {
		event.transaction = scrubUrl(event.transaction);
	}
	if (event.breadcrumbs) {
		event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
	}
	return event;
}

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
		beforeSend: (event) => scrubEvent(event),
		beforeSendTransaction: (event) => scrubEvent(event),
		beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
	});
}

/**
 * React 19 error hook handler for createRoot.
 * Wire these into createRoot options:
 *   onUncaughtError, onCaughtError, onRecoverableError
 */
export const sentryErrorHandler = Sentry.reactErrorHandler();
