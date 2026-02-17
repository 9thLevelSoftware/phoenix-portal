import { AlertCircle } from "lucide-react";
import type { FallbackProps } from "react-error-boundary";

export function PageErrorFallback({
	error,
	resetErrorBoundary,
}: FallbackProps) {
	return (
		<div className="min-h-[50vh] flex items-center justify-center p-8">
			<div className="text-center max-w-md">
				<AlertCircle className="w-12 h-12 text-[#DC2626] mx-auto mb-4" />
				<h2 className="text-xl font-semibold text-white mb-2">
					Something went wrong
				</h2>
				<p className="text-[#9CA3AF] mb-6 text-sm">{error.message}</p>
				<button
					onClick={resetErrorBoundary}
					className="px-4 py-2 bg-gradient-to-r from-[#FF6B35] to-[#DC2626] text-white rounded-lg hover:opacity-90 transition-opacity"
				>
					Try Again
				</button>
			</div>
		</div>
	);
}
