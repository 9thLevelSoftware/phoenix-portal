import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { ErrorBoundary } from 'react-error-boundary';
import { Navigation } from '@/app/components/Navigation';
import { MobileBottomNav } from '@/app/components/MobileBottomNav';
import { Toaster } from '@/app/components/ui/sonner';
import { PageLoading } from '@/app/components/PageLoading';
import { PageErrorFallback } from '@/app/components/ErrorFallback';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

/**
 * Authenticated shell layout.
 * Renders Navigation + page content (Outlet) + MobileBottomNav + Toaster.
 * useRealtimeSync is mounted here so it only runs when authenticated
 * and persists across route changes.
 *
 * Navigation and MobileBottomNav use NavLink + Zustand internally (no props needed).
 */
export function AppLayout() {
  useRealtimeSync();

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      <Navigation />

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
