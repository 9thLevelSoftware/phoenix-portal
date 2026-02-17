import { Download, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { usePWAInstall } from "@/app/hooks/usePWAInstall";

interface PWAInstallPromptProps {
	workoutCount: number;
}

/**
 * Dismissible PWA install banner.
 *
 * Only renders when the browser has fired `beforeinstallprompt` AND the
 * user has completed 3+ workouts AND the prompt has not been dismissed.
 */
export function PWAInstallPrompt({ workoutCount }: PWAInstallPromptProps) {
	const { canInstall, promptInstall, dismiss } = usePWAInstall({
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
					<Download className="w-5 h-5 text-primary" />
					<div>
						<p className="text-sm font-medium text-white">
							Install Phoenix Portal
						</p>
						<p className="text-xs text-muted-foreground">
							Add to home screen for quick access
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						onClick={promptInstall}
						className="bg-primary hover:bg-primary/90"
					>
						Install
					</Button>
					<Button size="sm" variant="ghost" onClick={dismiss}>
						<X className="w-4 h-4" />
					</Button>
				</div>
			</div>
		</Card>
	);
}
