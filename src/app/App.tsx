import { useState, lazy, Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { Navigation } from '@/app/components/Navigation';
import { MobileBottomNav } from '@/app/components/MobileBottomNav';
import { Toaster } from '@/app/components/ui/sonner';
import { PageLoading } from '@/app/components/PageLoading';
import { PageErrorFallback } from '@/app/components/ErrorFallback';

// Lazy-load all page components for code splitting
const LandingPage = lazy(() => import('@/app/components/LandingPage').then(m => ({ default: m.LandingPage })));
const Dashboard = lazy(() => import('@/app/components/Dashboard').then(m => ({ default: m.Dashboard })));
const Analytics = lazy(() => import('@/app/components/Analytics').then(m => ({ default: m.Analytics })));
const Challenges = lazy(() => import('@/app/components/Challenges').then(m => ({ default: m.Challenges })));
const Community = lazy(() => import('@/app/components/Community').then(m => ({ default: m.Community })));
const Profile = lazy(() => import('@/app/components/Profile').then(m => ({ default: m.Profile })));
const PrivacyPolicy = lazy(() => import('@/app/components/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })));
const WorkoutHistory = lazy(() => import('@/app/components/WorkoutHistory').then(m => ({ default: m.WorkoutHistory })));
const SessionDetail = lazy(() => import('@/app/components/SessionDetail').then(m => ({ default: m.SessionDetail })));
const PersonalRecords = lazy(() => import('@/app/components/PersonalRecords').then(m => ({ default: m.PersonalRecords })));
const RoutinesEnhanced = lazy(() => import('@/app/components/RoutinesEnhanced').then(m => ({ default: m.RoutinesEnhanced })));
const RoutineBuilder = lazy(() => import('@/app/components/RoutineBuilder').then(m => ({ default: m.RoutineBuilder })));
const TrainingCycles = lazy(() => import('@/app/components/TrainingCycles').then(m => ({ default: m.TrainingCycles })));
const CelebrationDemo = lazy(() => import('@/app/components/CelebrationDemo').then(m => ({ default: m.CelebrationDemo })));

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [showRoutineBuilder, setShowRoutineBuilder] = useState(false);
  const [showCycleBuilder, setShowCycleBuilder] = useState(false);
  const [streak, setStreak] = useState(7);
  const isMobile = useIsMobile();

  const handleGetStarted = () => {
    setIsAuthenticated(true);
    setCurrentPage('dashboard');
  };

  const handleNavigate = (page: string) => {
    setCurrentPage(page);
    setSelectedSessionId(null); // Reset session detail when navigating
    setShowRoutineBuilder(false);
    setShowCycleBuilder(false);
    setSelectedRoutineId(null);
  };

  const handleNavigateToPrivacy = () => {
    setShowPrivacyPolicy(true);
  };

  const handleBackFromPrivacy = () => {
    setShowPrivacyPolicy(false);
  };

  const handleViewSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
  };

  const handleBackFromSession = () => {
    setSelectedSessionId(null);
  };

  const handleCreateRoutine = () => {
    setShowRoutineBuilder(true);
    setSelectedRoutineId(null);
  };

  const handleEditRoutine = (id: string) => {
    setShowRoutineBuilder(true);
    setSelectedRoutineId(id);
  };

  const handleBackFromRoutineBuilder = () => {
    setShowRoutineBuilder(false);
    setSelectedRoutineId(null);
  };

  const handleSaveRoutine = (routine: any) => {
    console.log('Saving routine:', routine);
    setShowRoutineBuilder(false);
    setSelectedRoutineId(null);
  };

  const handleCreateCycle = () => {
    setShowCycleBuilder(true);
  };

  const handleEditCycle = (id: string) => {
    setShowCycleBuilder(true);
  };

  if (showPrivacyPolicy) {
    return (
      <ErrorBoundary FallbackComponent={PageErrorFallback} onReset={() => setShowPrivacyPolicy(false)}>
        <Suspense fallback={<PageLoading />}>
          <PrivacyPolicy onBack={handleBackFromPrivacy} />
          <Toaster />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary FallbackComponent={PageErrorFallback} onReset={() => setIsAuthenticated(false)}>
        <Suspense fallback={<PageLoading />}>
          <LandingPage onGetStarted={handleGetStarted} onNavigateToPrivacy={handleNavigateToPrivacy} />
          <Toaster />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0D0D]">
      <Navigation currentPage={currentPage} onNavigate={handleNavigate} streak={streak} />

      <ErrorBoundary FallbackComponent={PageErrorFallback} onReset={() => setCurrentPage('dashboard')}>
        <Suspense fallback={<PageLoading />}>
          {currentPage === 'dashboard' && <Dashboard />}
          {currentPage === 'history' && selectedSessionId && <SessionDetail sessionId={selectedSessionId} onBack={handleBackFromSession} />}
          {currentPage === 'history' && !selectedSessionId && <WorkoutHistory onViewSession={handleViewSession} />}
          {currentPage === 'records' && <PersonalRecords />}
          {currentPage === 'analytics' && <Analytics />}
          {currentPage === 'challenges' && <Challenges />}
          {currentPage === 'community' && <Community />}

          {/* Routines Page */}
          {currentPage === 'routines' && !showRoutineBuilder && (
            <RoutinesEnhanced onCreateRoutine={handleCreateRoutine} onEditRoutine={handleEditRoutine} />
          )}
          {currentPage === 'routines' && showRoutineBuilder && (
            <RoutineBuilder
              routineId={selectedRoutineId || undefined}
              onBack={handleBackFromRoutineBuilder}
              onSave={handleSaveRoutine}
            />
          )}

          {/* Cycles Page */}
          {currentPage === 'cycles' && <TrainingCycles onCreateCycle={handleCreateCycle} onEditCycle={handleEditCycle} />}

          {/* Celebration Demo Page (hidden - access via /celebrations) */}
          {currentPage === 'celebrations' && <CelebrationDemo />}

          {currentPage === 'profile' && <Profile />}
        </Suspense>
      </ErrorBoundary>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        currentPage={currentPage}
        onNavigate={handleNavigate}
        streak={streak}
        notifications={{
          challenges: 3,
          community: 5,
        }}
      />

      <Toaster />
    </div>
  );
}
