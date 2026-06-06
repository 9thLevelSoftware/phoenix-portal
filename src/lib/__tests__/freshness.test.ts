import { describe, expect, it } from "vitest";
import { buildFreshnessState } from "@/lib/freshness";

describe("buildFreshnessState", () => {
	it("reports live state when data is recent", () => {
		const state = buildFreshnessState({
			dataUpdatedAt: Date.parse("2026-06-05T12:00:00Z"),
			nowMs: Date.parse("2026-06-05T12:01:00Z"),
			staleAfterMs: 5 * 60 * 1000,
			isFetching: false,
			hasError: false,
		});

		expect(state.status).toBe("live");
		expect(state.label).toBe("Up to date");
	});

	it("preserves stale data while marking it stale", () => {
		const state = buildFreshnessState({
			dataUpdatedAt: Date.parse("2026-06-05T11:00:00Z"),
			nowMs: Date.parse("2026-06-05T12:00:00Z"),
			staleAfterMs: 30 * 60 * 1000,
			isFetching: false,
			hasError: false,
		});

		expect(state.status).toBe("stale");
		expect(state.label).toContain("Stale");
		expect(state.description).toContain("Last updated");
	});

	it("surfaces reconnecting, partial telemetry, and processing unavailable states", () => {
		const reconnecting = buildFreshnessState({
			dataUpdatedAt: Date.parse("2026-06-05T12:00:00Z"),
			nowMs: Date.parse("2026-06-05T12:01:00Z"),
			staleAfterMs: 5 * 60 * 1000,
			isFetching: true,
			hasError: true,
		});
		const partial = buildFreshnessState({
			nowMs: Date.parse("2026-06-05T12:01:00Z"),
			isFetching: false,
			hasError: false,
			partialTelemetry: true,
			processingAvailable: false,
		});

		expect(reconnecting.status).toBe("reconnecting");
		expect(partial.status).toBe("partial");
		expect(partial.flags).toContain("Processing unavailable");
	});
});
