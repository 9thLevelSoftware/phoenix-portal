import { useEffect, useState } from "react";

/**
 * Returns true when the user has enabled "Reduce motion" in their OS settings.
 *
 * Use this for non-Framer-Motion animations (CSS class toggles, custom JS).
 * Framer Motion components are handled globally by <MotionConfig reducedMotion="user">
 * in App.tsx — they respect the preference automatically.
 */
export function useReducedMotion(): boolean {
	const [prefersReduced, setPrefersReduced] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	});

	useEffect(() => {
		const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
		const handler = (e: MediaQueryListEvent) =>
			setPrefersReduced(e.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	return prefersReduced;
}
