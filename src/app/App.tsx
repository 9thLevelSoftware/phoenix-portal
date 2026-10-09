import { MotionConfig } from "motion/react";
import { ErrorBoundary } from "react-error-boundary";
import { PageErrorFallback } from "@/app/components/ErrorFallback";
import { Toaster } from "@/app/components/ui/sonner";
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
			{/*
			 * One toaster for the whole app, outside the boundary and the routes:
			 * public flows (sign-in, sign-up, password reset) and the app-level
			 * error fallback report through toasts too.
			 */}
			<Toaster />
		</MotionConfig>
	);
}
