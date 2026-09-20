import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({
	loadBodyMuscleAnalytics: vi.fn(),
}));

vi.mock("@/lib/body-muscle-analytics-loader", () => loader);

import { useBodyMuscleAnalytics } from "@/hooks/useBodyMuscleAnalytics";

describe("useBodyMuscleAnalytics", () => {
	beforeEach(() => {
		loader.loadBodyMuscleAnalytics.mockReset();
	});

	it("does not fetch the body-muscle map until enabled", async () => {
		const analytics = { buildBodyMuscleFocusModel: vi.fn() };
		loader.loadBodyMuscleAnalytics.mockResolvedValue(analytics);

		const { result, rerender } = renderHook(
			({ enabled }) => useBodyMuscleAnalytics(enabled),
			{ initialProps: { enabled: false } },
		);
		expect(loader.loadBodyMuscleAnalytics).not.toHaveBeenCalled();
		expect(result.current).toEqual({ analytics: null, failed: false });

		rerender({ enabled: true });
		await waitFor(() => expect(result.current.analytics).toBe(analytics));
		expect(loader.loadBodyMuscleAnalytics).toHaveBeenCalledTimes(1);

		// Leaving the tab keeps the loaded module.
		rerender({ enabled: false });
		expect(result.current.analytics).toBe(analytics);
	});

	it("reports failure and retries when re-enabled", async () => {
		loader.loadBodyMuscleAnalytics.mockRejectedValueOnce(
			new Error("chunk load failed"),
		);
		const { result, rerender } = renderHook(
			({ enabled }) => useBodyMuscleAnalytics(enabled),
			{ initialProps: { enabled: true } },
		);
		await waitFor(() => expect(result.current.failed).toBe(true));

		const analytics = { buildBodyMuscleFocusModel: vi.fn() };
		loader.loadBodyMuscleAnalytics.mockResolvedValue(analytics);
		rerender({ enabled: false });
		rerender({ enabled: true });
		await waitFor(() =>
			expect(result.current).toEqual({ analytics, failed: false }),
		);
	});
});
