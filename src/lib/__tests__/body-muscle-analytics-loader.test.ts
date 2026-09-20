import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => ({ calls: 0, failFirst: false }));

describe("loadBodyMuscleAnalytics", () => {
	beforeEach(() => {
		factory.calls = 0;
		factory.failFirst = false;
		vi.resetModules();
		vi.doMock("@/lib/body-muscle-analytics", () => {
			factory.calls++;
			if (factory.failFirst && factory.calls === 1) {
				throw new Error("Failed to fetch dynamically imported module");
			}
			return { buildBodyMuscleFocusModel: () => "model" };
		});
	});

	afterEach(() => {
		vi.doUnmock("@/lib/body-muscle-analytics");
	});

	it("shares one import between concurrent and repeated callers", async () => {
		const { loadBodyMuscleAnalytics } = await import(
			"@/lib/body-muscle-analytics-loader"
		);
		const first = loadBodyMuscleAnalytics();
		const second = loadBodyMuscleAnalytics();
		expect(second).toBe(first);

		const module = await first;
		expect(await loadBodyMuscleAnalytics()).toBe(module);
		expect(factory.calls).toBe(1);
	});

	it("forgets a failed import so the next call retries", async () => {
		factory.failFirst = true;
		const { loadBodyMuscleAnalytics } = await import(
			"@/lib/body-muscle-analytics-loader"
		);

		// (Vitest wraps the factory error, so only assert that it rejects.)
		await expect(loadBodyMuscleAnalytics()).rejects.toBeInstanceOf(Error);

		const module = await loadBodyMuscleAnalytics();
		expect(
			(module.buildBodyMuscleFocusModel as unknown as () => string)(),
		).toBe("model");
		expect(factory.calls).toBe(2);
	});
});
