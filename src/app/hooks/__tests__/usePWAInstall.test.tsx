import { renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePWAInstall } from "../usePWAInstall";

describe("usePWAInstall", () => {
	beforeEach(() => {
		window.localStorage.removeItem("phoenix-install-dismissed");
	});

	it("shows the install prompt when beforeinstallprompt fires after the first render and before the effect subscribes", () => {
		const { result } = renderHook(() => {
			const install = usePWAInstall({ workoutCount: 3 });
			// useLayoutEffect runs after commit and before useEffect. That is the
			// gap between the initial deferredPrompt read and the effect subscription.
			useLayoutEffect(() => {
				window.dispatchEvent(
					new Event("beforeinstallprompt", { cancelable: true }),
				);
			}, []);
			return install;
		});

		expect(result.current.isIOSSafari).toBe(false);
		expect(result.current.canInstall).toBe(true);
	});
});
