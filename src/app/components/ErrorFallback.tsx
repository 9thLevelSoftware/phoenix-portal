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

const RELOAD_KEY = "phoenix-chunk-reload";

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
		// Prevent infinite reload loops: only auto-reload once per session
		const lastReload = sessionStorage.getItem(RELOAD_KEY);
		const now = Date.now();
		if (lastReload && now - Number(lastReload) < 30_000) return;
		if (hasAutoReloaded.current) return;

		hasAutoReloaded.current = true;
		sessionStorage.setItem(RELOAD_KEY, String(now));
		window.location.reload();
	}, [error]);

	const chunkError = isChunkLoadError(error);

	return (
		<div className="min-h-[50vh] flex items-center justify-center p-8">
			<div className="text-center max-w-md">
				<AlertCircle className="w-12 h-12 text-chart-2 mx-auto mb-4" />
				<h2 className="text-xl font-semibold text-foreground mb-2">
					{chunkError ? "New version available" : "Something went wrong"}
				</h2>
				<p className="text-muted-foreground mb-6 text-sm">
					{chunkError
						? "The app has been updated. Reloading to get the latest version..."
						: errorMessage}
				</p>
				<div className="flex flex-wrap justify-center gap-2">
					<Button
						onClick={() => {
							if (chunkError) {
								sessionStorage.removeItem(RELOAD_KEY);
								window.location.reload();
							} else {
								resetErrorBoundary();
							}
						}}
					>
						{chunkError ? (
							<>
								<RefreshCw className="w-4 h-4 mr-2" />
								Reload
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
