import * as Sentry from "@sentry/react";

/**
 * Query parameters that can carry credentials: Supabase auth tokens
 * (implicit-flow / recovery links, PKCE `token_hash`), third-party provider
 * tokens, OAuth authorization codes and the OAuth `state` nonce. Matched
 * case-insensitively.
 */
const SENSITIVE_PARAM_NAMES = [
	"access_token",
	"refresh_token",
	"provider_token",
	"provider_refresh_token",
	"id_token",
	"token_hash",
	"token",
	"code",
	"state",
] as const;

const SENSITIVE_QUERY_PARAMS = new Set<string>(SENSITIVE_PARAM_NAMES);

/**
 * Matches `name=value` (or `name%3Dvalue`) for a sensitive name inside free
 * text such as error messages, where a URL cannot be parsed out reliably.
 * The name must follow a URL/text delimiter, so e.g. `barcode=` is left alone.
 */
const SENSITIVE_PAIR_IN_TEXT = new RegExp(
	`(^|[?&#;,\\s"'(/]|%3F|%26|%23)(${SENSITIVE_PARAM_NAMES.join("|")})(=|%3D)[^&#\\s"'<>)]*`,
	"gi",
);

/** Redact sensitive `name=value` pairs that appear anywhere in free text. */
export function scrubText(text: string): string {
	return text.replace(SENSITIVE_PAIR_IN_TEXT, "$1$2=[Filtered]");
}

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

/** `beforeBreadcrumb` hook: scrub navigation / fetch / xhr URLs and messages. */
export function scrubBreadcrumb(
	breadcrumb: Sentry.Breadcrumb,
): Sentry.Breadcrumb {
	const next = { ...breadcrumb, data: scrubBreadcrumbData(breadcrumb.data) };
	if (typeof next.message === "string") next.message = scrubText(next.message);
	return next;
}

type SpanData = Record<string, unknown>;

/**
 * Scrub the URL attributes the SDK puts on http.client spans (`url`,
 * `http.url`, `http.query`, `http.fragment`).
 */
function scrubSpanData<D extends SpanData | undefined>(data: D): D {
	if (!data) return data;
	const next: SpanData = { ...data };
	for (const key of ["url", "http.url"]) {
		const value = next[key];
		if (typeof value === "string") next[key] = scrubUrl(value);
	}
	delete next["http.fragment"];
	const query = next["http.query"];
	if (typeof query === "string") {
		const scrubbed = scrubUrl(`?${query.replace(/^\?/, "")}`);
		if (scrubbed === "") delete next["http.query"];
		else next["http.query"] = scrubbed;
	}
	return next as D;
}

function scrubSpans(spans: Sentry.Event["spans"]): Sentry.Event["spans"] {
	return spans?.map((span) => ({
		...span,
		description:
			typeof span.description === "string"
				? scrubText(span.description)
				: span.description,
		data: scrubSpanData(span.data),
	}));
}

function scrubPath(path: string | undefined): string | undefined {
	return typeof path === "string" ? scrubUrl(path) : path;
}

function scrubException(
	exception: Sentry.Event["exception"],
): Sentry.Event["exception"] {
	if (!exception?.values) return exception;
	return {
		...exception,
		values: exception.values.map((value) => {
			const next = { ...value };
			if (typeof next.value === "string") next.value = scrubText(next.value);
			if (next.stacktrace?.frames) {
				next.stacktrace = {
					...next.stacktrace,
					frames: next.stacktrace.frames.map((frame) => ({
						...frame,
						filename: scrubPath(frame.filename),
						abs_path: scrubPath(frame.abs_path),
					})),
				};
			}
			return next;
		}),
	};
}

/**
 * `beforeSend` / `beforeSendTransaction` hook: scrub the request URL, the
 * Referer header, the transaction name, span URL attributes, the message,
 * exception values, stack-frame paths and any attached breadcrumbs.
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
	if (typeof event.message === "string") {
		event.message = scrubText(event.message);
	}
	if (event.exception) event.exception = scrubException(event.exception);
	if (event.spans) event.spans = scrubSpans(event.spans);
	const trace = event.contexts?.trace;
	if (trace?.data) {
		event.contexts = {
			...event.contexts,
			trace: { ...trace, data: scrubSpanData(trace.data) },
		};
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

/** The id of the last event captured, for correlating a user's report. */
export function lastSentryEventId(): string | undefined {
	return Sentry.lastEventId();
}
