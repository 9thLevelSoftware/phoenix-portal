import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "../use-mobile";

describe("useIsMobile", () => {
	const originalMatchMedia = window.matchMedia;
	const originalInnerWidth = window.innerWidth;

	afterEach(() => {
		window.matchMedia = originalMatchMedia;
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: originalInnerWidth,
		});
	});

	it("follows matchMedia.matches when it disagrees with innerWidth", () => {
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 1200,
		});

		let matches = true;
		const listeners = new Set<() => void>();
		window.matchMedia = vi.fn((query: string) => ({
			get matches() {
				return matches;
			},
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: (_event: string, listener: () => void) => {
				listeners.add(listener);
			},
			removeEventListener: (_event: string, listener: () => void) => {
				listeners.delete(listener);
			},
			dispatchEvent: vi.fn(),
		})) as unknown as typeof window.matchMedia;

		const { result } = renderHook(() => useIsMobile());

		expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
		expect(result.current).toBe(true);

		act(() => {
			matches = false;
			for (const listener of listeners) listener();
		});

		expect(result.current).toBe(false);
	});
});
