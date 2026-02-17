import { useEffect, useState } from "react";

/**
 * Displays a fixed banner at the top of the viewport when the user loses
 * network connectivity. Listens for online/offline events and checks
 * navigator.onLine on mount.
 */
export function OfflineBanner() {
	const [isOffline, setIsOffline] = useState(
		typeof navigator !== "undefined" ? !navigator.onLine : false,
	);

	useEffect(() => {
		const handleOnline = () => setIsOffline(false);
		const handleOffline = () => setIsOffline(true);

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []);

	if (!isOffline) return null;

	return (
		<div
			className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground text-center py-2 text-sm font-medium"
			data-print-hide
		>
			You are offline. Some features may be unavailable.
		</div>
	);
}
