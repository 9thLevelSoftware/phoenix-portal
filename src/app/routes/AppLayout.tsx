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
 * NOTE: Navigation and MobileBottomNav still receive hardcoded props.
 * Plan 02-02 will migrate them to use NavLink + Zustand, removing these props.
 */
export function AppLayout() {
  useRealtimeSync();

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      <Navigation currentPage="" onNavigate={() => {}} streak={7} />

      <ErrorBoundary FallbackComponent={PageErrorFallback}>
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>

      <MobileBottomNav
        currentPage=""
        onNavigate={() => {}}
        streak={7}
        notifications={{ challenges: 3, community: 5 }}
      />

      <Toaster />
    </div>
  );
}
