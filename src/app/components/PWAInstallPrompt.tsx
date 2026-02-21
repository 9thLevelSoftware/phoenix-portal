import { Download, Share, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { usePWAInstall } from "@/app/hooks/usePWAInstall";

interface PWAInstallPromptProps {
	workoutCount: number;
}

/**
 * Dismissible PWA install banner.
 *
 * Renders when:
 * - The browser has fired `beforeinstallprompt` (Chrome/Edge/etc.), OR
 * - The user is on iOS Safari (which never fires that event).
 *
 * AND the user has completed 3+ workouts AND the prompt has not been dismissed.
 */
export function PWAInstallPrompt({ workoutCount }: PWAInstallPromptProps) {
	const { canInstall, isIOSSafari, promptInstall, dismiss } = usePWAInstall({
		workoutCount,
	});

	if (!canInstall) return null;

	return (
		<Card
			className="p-4 bg-gradient-to-r from-primary/10 to-accent/10 border-primary/30"
			data-print-hide
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					{isIOSSafari ? (
						<Share className="w-5 h-5 text-primary" />
					) : (
						<Download className="w-5 h-5 text-primary" />
					)}
					<div>
						<p className="text-sm font-medium text-white">
							Install Phoenix Portal
						</p>
						{isIOSSafari ? (
							<p className="text-xs text-muted-foreground">
								Tap <Share className="w-3 h-3 inline-block mx-0.5" /> then
								&ldquo;Add to Home Screen&rdquo;
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								Add to home screen for quick access
							</p>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2">
					{!isIOSSafari && (
						<Button
							size="sm"
							onClick={promptInstall}
							className="bg-primary hover:bg-primary/90"
						>
							Install
						</Button>
					)}
					<Button size="sm" variant="ghost" onClick={dismiss}>
						<X className="w-4 h-4" />
					</Button>
				</div>
			</div>
		</Card>
	);
}
