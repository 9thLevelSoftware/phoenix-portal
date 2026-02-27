import { AlertCircle } from "lucide-react";
import type { FallbackProps } from "react-error-boundary";
import { Button } from "@/app/components/ui/button";

export function PageErrorFallback({
	error,
	resetErrorBoundary,
}: FallbackProps) {
	return (
		<div className="min-h-[50vh] flex items-center justify-center p-8">
			<div className="text-center max-w-md">
				<AlertCircle className="w-12 h-12 text-chart-2 mx-auto mb-4" />
				<h2 className="text-xl font-semibold text-white mb-2">
					Something went wrong
				</h2>
				<p className="text-muted-foreground mb-6 text-sm">{error.message}</p>
				<Button onClick={resetErrorBoundary}>Try Again</Button>
			</div>
		</div>
	);
}
