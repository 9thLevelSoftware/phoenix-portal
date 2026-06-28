import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useLocation, useOutlet } from "react-router";
import { AppSidebar } from "@/app/components/AppSidebar";
import { PageErrorFallback } from "@/app/components/ErrorFallback";
import { MobileBottomNav } from "@/app/components/MobileBottomNav";
import { OfflineBanner } from "@/app/components/OfflineBanner";
import { OnboardingOverlay } from "@/app/components/OnboardingOverlay";
import { PageLoading } from "@/app/components/PageLoading";
import { SkipToContent } from "@/app/components/SkipToContent";
import { SidebarInset, SidebarProvider } from "@/app/components/ui/sidebar";
import { Toaster } from "@/app/components/ui/sonner";
import { WhatsNewBanner } from "@/app/components/WhatsNewBanner";
import { useNotificationSync } from "@/hooks/useNotificationSync";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useStreakSync } from "@/hooks/useStreakSync";
import { pageTransition } from "@/lib/animations";

/**
 * Authenticated shell layout.
 * Renders AppSidebar (desktop left nav) + page content (Outlet) + MobileBottomNav + Toaster.
 * useRealtimeSync is mounted here so it only runs when authenticated
 * and persists across route changes.
 *
 * Onboarding flow:
 * - New users (no workouts, no onboarding row) see OnboardingOverlay (3-step Dialog)
 * - Returning users (v1.0 mobile/web) see WhatsNewBanner above page content
 * - v1.1 users who completed onboarding see nothing
 *
 * SidebarProvider must live inside AppLayout (inside ProtectedRoute), NOT at router root.
 * AppSidebar and SidebarInset must be direct children of SidebarProvider's inner wrapper
 * for CSS peer selectors to work correctly.
 */
export function AppLayout() {
	useRealtimeSync();
	useNotificationSync();
	useStreakSync();
	const outlet = useOutlet();
	const location = useLocation();
	const {
		needsOnboarding,
		needsWhatsNew,
		completeOnboarding,
		dismissWhatsNew,
	} = useOnboarding();

	return (
		<SidebarProvider defaultOpen={true}>
			<MotionConfig reducedMotion="user">
				<div className="min-h-screen relative z-[10] flex w-full">
					<SkipToContent />
					<OfflineBanner />

					<div data-print-hide>
						<AppSidebar />
					</div>

					<SidebarInset className="bg-transparent">
						{needsOnboarding && (
							<OnboardingOverlay
								onComplete={() => completeOnboarding.mutate()}
							/>
						)}

						{needsWhatsNew && (
							<WhatsNewBanner onDismiss={() => dismissWhatsNew.mutate()} />
						)}

						<ErrorBoundary
							FallbackComponent={PageErrorFallback}
							resetKeys={[location.pathname]}
						>
							<Suspense fallback={<PageLoading />}>
								<AnimatePresence mode="wait">
									<motion.main
										key={location.pathname}
										id="main-content"
										{...pageTransition}
									>
										{outlet}
									</motion.main>
								</AnimatePresence>
							</Suspense>
						</ErrorBoundary>

						<div data-print-hide>
							<MobileBottomNav />
						</div>
					</SidebarInset>

					<Toaster />
				</div>
			</MotionConfig>
		</SidebarProvider>
	);
}
