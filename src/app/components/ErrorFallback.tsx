import { AlertCircle, Copy, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FallbackProps } from "react-error-boundary";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/app/components/ui/button";

/**
 * Detects chunk/module load failures caused by a new deployment
 * invalidating previously-hashed asset filenames.
 */
function isChunkLoadError(error: unknown): boolean {
	const msg =
		error instanceof Error
			? (error.message?.toLowerCase() ?? "")
			: String(error).toLowerCase();
	const errorName = error instanceof Error ? error.name : "";
	return (
		msg.includes("failed to fetch dynamically imported module") ||
		msg.includes("loading chunk") ||
		msg.includes("loading css chunk") ||
		(errorName === "TypeError" && msg.includes("failed to fetch"))
	);
}

function isOffline(): boolean {
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

const RELOAD_KEY = "phoenix-chunk-reload";

// sessionStorage can throw in private/blocked-storage contexts. This error UI
// must never throw while already handling an error, so all access is best-effort.
function safeSessionGet(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSessionSet(key: string, value: string): void {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		// ignore storage failure
	}
}

function safeSessionRemove(key: string): void {
	try {
		sessionStorage.removeItem(key);
	} catch {
		// ignore storage failure
	}
}

export function PageErrorFallback({
	error,
	resetErrorBoundary,
}: FallbackProps) {
	const navigate = useNavigate();
	const [errorId] = useState(() => crypto.randomUUID());
	const hasAutoReloaded = useRef(false);
	const errorMessage =
		error instanceof Error ? error.message : "Unknown application error";

	useEffect(() => {
		if (!isChunkLoadError(error)) return;
		// Offline, the chunk simply hasn't been cached yet; reloading would fail
		// the same way and burn the one auto-reload meant for new deploys.
		if (isOffline()) return;
		// Prevent infinite reload loops: only auto-reload once per session
		const lastReload = safeSessionGet(RELOAD_KEY);
		const now = Date.now();
		if (lastReload && now - Number(lastReload) < 30_000) return;
		if (hasAutoReloaded.current) return;

		hasAutoReloaded.current = true;
		safeSessionSet(RELOAD_KEY, String(now));
		window.location.reload();
	}, [error]);

	const chunkError = isChunkLoadError(error);
	const offlineChunkError = chunkError && isOffline();

	return (
		<div className="min-h-[50vh] flex items-center justify-center p-8">
			<div className="text-center max-w-md">
				<AlertCircle className="w-12 h-12 text-chart-2 mx-auto mb-4" />
				<h2 className="text-xl font-semibold text-foreground mb-2">
					{offlineChunkError
						? "You're offline"
						: chunkError
							? "New version available"
							: "Something went wrong"}
				</h2>
				<p className="text-muted-foreground mb-6 text-sm">
					{offlineChunkError
						? "This page hasn't been downloaded for offline use yet. Reconnect and try again."
						: chunkError
							? "The app has been updated. Reloading to get the latest version..."
							: errorMessage}
				</p>
				<div className="flex flex-wrap justify-center gap-2">
					<Button
						onClick={() => {
							if (chunkError) {
								safeSessionRemove(RELOAD_KEY);
								window.location.reload();
							} else {
								resetErrorBoundary();
							}
						}}
					>
						{chunkError ? (
							<>
								<RefreshCw className="w-4 h-4 mr-2" />
								{offlineChunkError ? "Try again" : "Reload"}
							</>
						) : (
							"Try Again"
						)}
					</Button>
					<Button
						variant="outline"
						onClick={() => {
							void navigator.clipboard?.writeText(errorId);
							toast.error("Something went wrong — error id copied");
						}}
					>
						<Copy className="w-4 h-4" />
						Copy error id
					</Button>
					<Button variant="ghost" onClick={() => navigate("/dashboard")}>
						Back to dashboard
					</Button>
				</div>
			</div>
		</div>
	);
}
