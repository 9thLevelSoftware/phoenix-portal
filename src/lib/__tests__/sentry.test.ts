import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }));

vi.mock("@sentry/react", () => ({
	init: initMock,
	browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
	reactErrorHandler: vi.fn(() => vi.fn()),
}));

import {
	initSentry,
	scrubBreadcrumb,
	scrubEvent,
	scrubText,
	scrubUrl,
} from "@/lib/sentry";

const ACCESS = "eyJhbGciOiJIUzI1NiJ9.access-secret";
const REFRESH = "refresh-secret-123";

function initOptions(): BrowserOptions {
	vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
	initSentry();
	expect(initMock).toHaveBeenCalledTimes(1);
	return initMock.mock.calls[0][0] as BrowserOptions;
}

describe("scrubUrl", () => {
	it("drops the fragment carrying implicit-flow tokens", () => {
		expect(
			scrubUrl(
				`https://portal.example/reset#access_token=${ACCESS}&refresh_token=${REFRESH}&type=recovery`,
			),
		).toBe("https://portal.example/reset");
	});

	it("removes sensitive query params and keeps the rest", () => {
		expect(
			scrubUrl(
				"/integrations/callback?provider=strava&code=abc&state=xyz&Token=t&tab=1",
			),
		).toBe("/integrations/callback?provider=strava&tab=1");
		expect(scrubUrl("/cb?access_token=a&refresh_token=b")).toBe("/cb");
		expect(scrubUrl("/cb?code%5F=1&%63ode=2")).toBe("/cb?code%5F=1");
	});

	it("keeps a malformed percent-escaped name and still drops tokens", () => {
		expect(scrubUrl("/cb?%E0%A4%A=1&access_token=x")).toBe("/cb?%E0%A4%A=1");
	});

	it("removes PKCE token_hash and provider tokens", () => {
		expect(
			scrubUrl(
				"/auth/confirm?token_hash=h&type=recovery&provider_token=p&provider_refresh_token=r&id_token=i",
			),
		).toBe("/auth/confirm?type=recovery");
	});

	it("leaves clean URLs untouched", () => {
		expect(scrubUrl("https://portal.example/dashboard?range=30d")).toBe(
			"https://portal.example/dashboard?range=30d",
		);
		expect(scrubUrl("/workouts")).toBe("/workouts");
	});
});

describe("initSentry scrubbing hooks", () => {
	beforeEach(() => {
		initMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("emits an error event without the access or refresh token", () => {
		const { beforeSend } = initOptions();
		expect(beforeSend).toBeTypeOf("function");

		const event: ErrorEvent = {
			type: undefined,
			message: "boom",
			transaction: `/reset#access_token=${ACCESS}&refresh_token=${REFRESH}`,
			request: {
				url: `https://portal.example/reset#access_token=${ACCESS}&refresh_token=${REFRESH}&type=recovery`,
				query_string: "code=abc&tab=1",
				headers: {
					Referer: "https://portal.example/cb?code=abc&token=t",
					"User-Agent": "test",
				},
			},
			breadcrumbs: [
				{
					category: "navigation",
					data: {
						from: `/login#access_token=${ACCESS}`,
						to: `/reset?refresh_token=${REFRESH}`,
					},
				},
			],
		};

		const sent = beforeSend?.(event, {}) as ErrorEvent;
		const serialized = JSON.stringify(sent);

		expect(serialized).not.toContain(ACCESS);
		expect(serialized).not.toContain(REFRESH);
		expect(serialized).not.toContain("access_token");
		expect(serialized).not.toContain("refresh_token");
		expect(sent.request?.url).toBe("https://portal.example/reset");
		expect(sent.request?.query_string).toBe("tab=1");
		expect(sent.request?.headers?.Referer).toBe("https://portal.example/cb");
		expect(sent.request?.headers?.["User-Agent"]).toBe("test");
		expect(sent.transaction).toBe("/reset");
		expect(sent.message).toBe("boom");
	});

	it("scrubs transaction events via beforeSendTransaction", () => {
		const { beforeSendTransaction } = initOptions();
		const sent = beforeSendTransaction?.(
			{
				type: "transaction",
				transaction: `/auth/callback?code=abc#access_token=${ACCESS}`,
				request: { url: `https://portal.example/#refresh_token=${REFRESH}` },
			},
			{},
		) as { transaction?: string; request?: { url?: string } };

		expect(sent.transaction).toBe("/auth/callback");
		expect(sent.request?.url).toBe("https://portal.example/");
	});

	it("scrubs http.client span URL attributes and trace context data", () => {
		const { beforeSendTransaction } = initOptions();
		const signed = `https://storage.example/object/sign/a.png?token=${ACCESS}&download=1#access_token=${ACCESS}`;
		const sent = beforeSendTransaction?.(
			{
				type: "transaction",
				transaction: "/profile",
				contexts: {
					trace: {
						trace_id: "t",
						span_id: "s",
						data: { url: signed, "http.fragment": `#refresh_token=${REFRESH}` },
					},
				},
				spans: [
					{
						span_id: "1",
						trace_id: "t",
						start_timestamp: 0,
						description: `GET ${signed}`,
						data: {
							url: signed,
							"http.url": signed,
							"http.query": `?token=${ACCESS}&download=1`,
							"http.fragment": `#access_token=${ACCESS}`,
							"http.method": "GET",
						},
					},
					{
						span_id: "2",
						trace_id: "t",
						start_timestamp: 0,
						description: "GET /rest/v1/x",
						data: { url: "/rest/v1/x", "http.query": "?code=abc" },
					},
				],
			},
			{},
		) as
			| {
					spans?: Array<{
						data?: Record<string, unknown>;
						description?: string;
					}>;
					contexts?: { trace?: { data?: Record<string, unknown> } };
			  }
			| undefined;

		expect(JSON.stringify(sent)).not.toContain(ACCESS);
		expect(JSON.stringify(sent)).not.toContain(REFRESH);
		const [span, codeOnly] = sent?.spans ?? [];
		const clean = "https://storage.example/object/sign/a.png?download=1";
		expect(span.data).toEqual({
			url: clean,
			"http.url": clean,
			"http.query": "?download=1",
			"http.method": "GET",
		});
		expect(span.description).toContain("token=[Filtered]");
		expect(codeOnly.data).toEqual({ url: "/rest/v1/x" });
		expect(sent?.contexts?.trace?.data).toEqual({ url: clean });
	});

	it("scrubs messages, exception values and stack-frame paths", () => {
		const { beforeSend } = initOptions();
		const href = `https://portal.example/reset#access_token=${ACCESS}&refresh_token=${REFRESH}&type=recovery`;
		const sent = beforeSend?.(
			{
				type: undefined,
				message: `failed at ${href}`,
				exception: {
					values: [
						{
							type: "Error",
							value: `Script error at ${href} (code%3Dabc)`,
							stacktrace: {
								frames: [
									{ filename: href, abs_path: href, lineno: 1 },
									{ filename: "app:///assets/index.js" },
								],
							},
						},
					],
				},
				breadcrumbs: [{ category: "console", message: `location ${href}` }],
			},
			{},
		) as ErrorEvent;

		const serialized = JSON.stringify(sent);
		expect(serialized).not.toContain(ACCESS);
		expect(serialized).not.toContain(REFRESH);
		expect(serialized).not.toContain("abc");
		const [value] = sent.exception?.values ?? [];
		expect(value.stacktrace?.frames?.[0]).toEqual({
			filename: "https://portal.example/reset",
			abs_path: "https://portal.example/reset",
			lineno: 1,
		});
		expect(value.stacktrace?.frames?.[1].filename).toBe(
			"app:///assets/index.js",
		);
		expect(sent.message).toBe(
			"failed at https://portal.example/reset#access_token=[Filtered]&refresh_token=[Filtered]&type=recovery",
		);
	});

	it("scrubs breadcrumb url/from/to via beforeBreadcrumb", () => {
		const { beforeBreadcrumb } = initOptions();
		const crumb: Breadcrumb = {
			category: "fetch",
			data: {
				url: `https://api.example/auth/v1/token?refresh_token=${REFRESH}&grant_type=refresh`,
				method: "POST",
				status_code: 200,
			},
		};

		const sent = beforeBreadcrumb?.(crumb) as Breadcrumb;
		expect(sent.data?.url).toBe(
			"https://api.example/auth/v1/token?grant_type=refresh",
		);
		expect(sent.data?.method).toBe("POST");

		const nav = beforeBreadcrumb?.(
			{
				category: "navigation",
				data: {
					from: `/login#access_token=${ACCESS}`,
					to: `/integrations/callback?code=abc&state=xyz&provider=strava`,
				},
			},
			undefined,
		) as Breadcrumb;
		expect(nav.data).toEqual({
			from: "/login",
			to: "/integrations/callback?provider=strava",
		});
		expect(scrubBreadcrumb({ message: "no data" })).toEqual({
			message: "no data",
			data: undefined,
		});
	});

	it("does not initialise without a DSN", () => {
		vi.stubEnv("VITE_SENTRY_DSN", "");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		initSentry();
		expect(initMock).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("scrubEvent", () => {
	it("tolerates events without request or breadcrumbs", () => {
		expect(scrubEvent({ message: "x" })).toEqual({ message: "x" });
	});

	it("scrubText only redacts delimited sensitive names", () => {
		expect(scrubText("barcode=123 unicode=x")).toBe("barcode=123 unicode=x");
		expect(scrubText("see ?token_hash=abc&type=signup")).toBe(
			"see ?token_hash=[Filtered]&type=signup",
		);
	});

	it("matches the Referer header case-insensitively", () => {
		expect(
			scrubEvent({
				request: { headers: { referer: "https://portal.example/cb?code=abc" } },
			}).request?.headers,
		).toEqual({ referer: "https://portal.example/cb" });
	});

	it("scrubs object and array query_string forms", () => {
		expect(
			scrubEvent({ request: { query_string: { code: "a", tab: "1" } } }).request
				?.query_string,
		).toEqual({ tab: "1" });
		expect(
			scrubEvent({
				request: {
					query_string: [
						["token", "a"],
						["tab", "1"],
					],
				},
			}).request?.query_string,
		).toEqual([["tab", "1"]]);
	});
});
