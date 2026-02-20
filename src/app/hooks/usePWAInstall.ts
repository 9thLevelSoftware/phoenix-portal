import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

// Module-level listener -- captures event even before React mounts
if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (e) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
	});
}

const DISMISS_KEY = "phoenix-install-dismissed";

interface UsePWAInstallOptions {
	workoutCount: number;
	minWorkouts?: number;
}

interface UsePWAInstallResult {
	canInstall: boolean;
	promptInstall: () => Promise<void>;
	dismiss: () => void;
}

/**
 * PWA install prompt hook.
 *
 * Captures the browser's `beforeinstallprompt` event and exposes an install
 * prompt gated behind a minimum workout count. The dismissed state is
 * persisted in localStorage so users are not re-prompted.
 */
export function usePWAInstall({
	workoutCount,
	minWorkouts = 3,
}: UsePWAInstallOptions): UsePWAInstallResult {
	const [promptAvailable, setPromptAvailable] = useState(
		() => deferredPrompt !== null,
	);
	const [dismissed, setDismissed] = useState(() => {
		if (typeof window === "undefined") return false;
		return localStorage.getItem(DISMISS_KEY) === "true";
	});

	// Listen for late-arriving beforeinstallprompt events
	useEffect(() => {
		const handler = (e: Event) => {
			e.preventDefault();
			deferredPrompt = e as BeforeInstallPromptEvent;
			setPromptAvailable(true);
		};

		window.addEventListener("beforeinstallprompt", handler);
		return () => window.removeEventListener("beforeinstallprompt", handler);
	}, []);

	const canInstall =
		promptAvailable && workoutCount >= minWorkouts && !dismissed;

	const promptInstall = useCallback(async () => {
		if (!deferredPrompt) return;

		await deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;

		if (outcome === "dismissed") {
			localStorage.setItem(DISMISS_KEY, "true");
			setDismissed(true);
		}

		deferredPrompt = null;
		setPromptAvailable(false);
	}, []);

	const dismiss = useCallback(() => {
		localStorage.setItem(DISMISS_KEY, "true");
		setDismissed(true);
	}, []);

	return { canInstall, promptInstall, dismiss };
}
