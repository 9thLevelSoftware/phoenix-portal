import { afterEach, describe, expect, it, vi } from "vitest";
import {
	enableErrorReporting,
	forwardReactError,
	lastReportedErrorId,
	resetErrorReportingForTests,
} from "../errorReporting";

type SentryModule = typeof import("../sentry");

function fakeSentry() {
	const initSentry = vi.fn();
	const sentryErrorHandler = vi.fn();
	const module = {
		initSentry,
		sentryErrorHandler,
		lastSentryEventId: () => "sentry-event-1",
	} as unknown as SentryModule;
	return { module, initSentry, sentryErrorHandler };
}

describe("error reporting", () => {
	afterEach(() => {
		resetErrorReportingForTests();
		vi.restoreAllMocks();
	});

	it("logs React root errors to the console until Sentry is enabled", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const error = new Error("before consent");
		forwardReactError(error, {});
		expect(consoleError).toHaveBeenCalledWith(error);
		expect(lastReportedErrorId()).toBeUndefined();
	});

	it("forwards root errors to Sentry as soon as consent loads it mid-session", async () => {
		const { module, initSentry, sentryErrorHandler } = fakeSentry();
		await enableErrorReporting(() => Promise.resolve(module));

		const error = new Error("after consent");
		forwardReactError(error, { componentStack: "" });

		expect(initSentry).toHaveBeenCalledTimes(1);
		expect(sentryErrorHandler).toHaveBeenCalledWith(error, {
			componentStack: "",
		});
		expect(lastReportedErrorId()).toBe("sentry-event-1");
	});

	it("loads and initialises Sentry once however often consent is given", async () => {
		const { module, initSentry } = fakeSentry();
		const load = vi.fn(() => Promise.resolve(module));
		await Promise.all([enableErrorReporting(load), enableErrorReporting(load)]);
		expect(load).toHaveBeenCalledTimes(1);
		expect(initSentry).toHaveBeenCalledTimes(1);
	});
});
