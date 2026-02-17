import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Outlet } from "react-router";
import { PageErrorFallback } from "@/app/components/ErrorFallback";
import { MobileBottomNav } from "@/app/components/MobileBottomNav";
import { Navigation } from "@/app/components/Navigation";
import { OnboardingOverlay } from "@/app/components/OnboardingOverlay";
import { PageLoading } from "@/app/components/PageLoading";
import { WhatsNewBanner } from "@/app/components/WhatsNewBanner";
import { Toaster } from "@/app/components/ui/sonner";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

/**
 * Authenticated shell layout.
 * Renders Navigation + page content (Outlet) + MobileBottomNav + Toaster.
 * useRealtimeSync is mounted here so it only runs when authenticated
 * and persists across route changes.
 *
 * Onboarding flow:
 * - New users (no workouts, no onboarding row) see OnboardingOverlay (3-step Dialog)
 * - Returning users (v1.0 mobile/web) see WhatsNewBanner above page content
 * - v1.1 users who completed onboarding see nothing
 *
 * Navigation and MobileBottomNav use NavLink + Zustand internally (no props needed).
 */
export function AppLayout() {
	useRealtimeSync();
	const {
		needsOnboarding,
		needsWhatsNew,
		completeOnboarding,
		dismissWhatsNew,
	} = useOnboarding();

	return (
		<div className="min-h-screen bg-[#0D0D0D]">
			<Navigation />

			{needsOnboarding && (
				<OnboardingOverlay
					onComplete={() => completeOnboarding.mutate()}
				/>
			)}

			{needsWhatsNew && (
				<WhatsNewBanner onDismiss={() => dismissWhatsNew.mutate()} />
			)}

			<ErrorBoundary FallbackComponent={PageErrorFallback}>
				<Suspense fallback={<PageLoading />}>
					<Outlet />
				</Suspense>
			</ErrorBoundary>

			<MobileBottomNav />

			<Toaster />
		</div>
	);
}
