import { MotionConfig } from "motion/react";
import { ErrorBoundary } from "react-error-boundary";
import { PageErrorFallback } from "@/app/components/ErrorFallback";
import { AppRoutes } from "@/app/routes";

export default function App() {
	return (
		<MotionConfig reducedMotion="user">
			{/*
			 * App-level boundary so a crash in a public route (landing, privacy,
			 * terms, FAQ, auth callback) or a post-throttle lazy-import failure
			 * shows the recovery UI instead of unmounting the whole tree.
			 * AppLayout adds its own location-keyed boundary for authenticated pages.
			 */}
			<ErrorBoundary FallbackComponent={PageErrorFallback}>
				<AppRoutes />
			</ErrorBoundary>
		</MotionConfig>
	);
}
