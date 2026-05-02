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

function readDismissedState(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.localStorage?.getItem !== "function"
	) {
		return false;
	}

	try {
		return window.localStorage.getItem(DISMISS_KEY) === "true";
	} catch {
		return false;
	}
}

function writeDismissedState(): void {
	if (
		typeof window === "undefined" ||
		typeof window.localStorage?.setItem !== "function"
	) {
		return;
	}

	try {
		window.localStorage.setItem(DISMISS_KEY, "true");
	} catch {
		// Ignore storage failures; the in-memory React state still dismisses.
	}
}

interface UsePWAInstallOptions {
	workoutCount: number;
	minWorkouts?: number;
}

/** Detect iOS Safari (which never fires beforeinstallprompt) */
function isIOSSafari(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	const isIOS =
		/iPad|iPhone|iPod/.test(ua) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	const isStandalone =
		"standalone" in navigator &&
		(navigator as unknown as { standalone: boolean }).standalone;
	return isIOS && !isStandalone;
}

interface UsePWAInstallResult {
	canInstall: boolean;
	isIOSSafari: boolean;
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
	const [dismissed, setDismissed] = useState(readDismissedState);

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

	const iosSafari = isIOSSafari();
	const canInstall =
		(promptAvailable || iosSafari) && workoutCount >= minWorkouts && !dismissed;

	const promptInstall = useCallback(async () => {
		if (!deferredPrompt) return;

		await deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;

		if (outcome === "dismissed") {
			writeDismissedState();
			setDismissed(true);
		}

		deferredPrompt = null;
		setPromptAvailable(false);
	}, []);

	const dismiss = useCallback(() => {
		writeDismissedState();
		setDismissed(true);
	}, []);

	return { canInstall, isIOSSafari: iosSafari, promptInstall, dismiss };
}
