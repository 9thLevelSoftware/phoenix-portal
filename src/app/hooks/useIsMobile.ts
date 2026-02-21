import { useEffect, useState } from "react";

export function useIsMobile(breakpoint: number = 768) {
	const [isMobile, setIsMobile] = useState(
		() => typeof window !== "undefined" && window.innerWidth < breakpoint,
	);

	useEffect(() => {
		// Check on mount
		const checkIsMobile = () => {
			setIsMobile(window.innerWidth < breakpoint);
		};

		// Initial check
		checkIsMobile();

		// Listen for resize
		window.addEventListener("resize", checkIsMobile);

		return () => window.removeEventListener("resize", checkIsMobile);
	}, [breakpoint]);

	return isMobile;
}
